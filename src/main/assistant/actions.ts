import type {
  AssistantAction,
  AssistantActionKind,
  AssistantContextInput,
  AssistantIntent,
  AssistantSource
} from '@shared/ipc'
import { formatMoment } from '@shared/moment'
import { HELP_SCREENS } from './intent'
import { isMiss, type ContextPacket, type PacketRow } from './packet'
import type { RawAction } from './reply'

/**
 * Sources and action cards for an answer (deep audit crosscut §3.4). Claude
 * only proposes: every proposal is checked here against the packet (each ref
 * must be a listed row or page) and against what the screen allows, then
 * written as a card that says exactly what changes and what it costs. Removing
 * or deleting is never offered. Nothing here runs an action.
 */

/** The live search cap (owner decision): a check proposed here never spends more. */
export const ACTION_SEARCH_CAP = 60

const DEFAULT_CAPABILITIES: readonly AssistantActionKind[] = [
  'add-questions',
  'create-topic',
  'draft-fix',
  'set-target',
  'open-drill',
  'start-check'
]

/** What the screen allows; a screen that says nothing allows every action, help screens none. */
export function capabilitiesOf(context: AssistantContextInput): ReadonlySet<AssistantActionKind> {
  if (context.capabilities.length > 0) return new Set(context.capabilities)
  return new Set(HELP_SCREENS.has(context.screen) ? [] : DEFAULT_CAPABILITIES)
}

/** Links for the refs an answer cites: rows open their check, pages their read. */
export function sourcesFor(refs: readonly string[], packet: ContextPacket): AssistantSource[] {
  const out: AssistantSource[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const row = packet.rows.find((item) => item.ref === ref)
    if (row) {
      out.push(rowSource(row))
      continue
    }
    const page = packet.pages.find((item) => item.ref === ref)
    if (page) {
      out.push({
        kind: 'page-read',
        label: `Page read: ${page.label}`,
        pageId: page.id,
        promptId: null,
        marketId: null,
        runId: null,
        drill: null,
        domain: null
      })
    }
  }
  return out.slice(0, 8)
}

export function rowSource(row: PacketRow): AssistantSource {
  return {
    kind: row.pageKind === 'topic' ? 'topic' : 'check',
    label: `${shortDay(row.checkedAt)} check · “${short(row.text, 60)}” · ${row.marketLabel}`,
    pageId: row.pageId,
    promptId: row.promptId,
    marketId: row.marketId,
    runId: null,
    drill: null,
    domain: null
  }
}

/** A screen number with a drill the question was about ("Explain this number"). */
export function drillSource(context: AssistantContextInput): AssistantSource | null {
  const number = aboutNumber(context)
  if (!number?.drill) return null
  return {
    kind: 'drill',
    label: `Rows behind “${number.label}”`,
    pageId: null,
    promptId: null,
    marketId: null,
    runId: null,
    drill: number.drill,
    domain: null
  }
}

function aboutNumber(
  context: AssistantContextInput
): AssistantContextInput['numbers'][number] | null {
  if (context.about?.kind !== 'kpi') return null
  return context.numbers.find((item) => item.label === context.about?.label) ?? null
}

/** The checked cards for an answer: Claude's proposals first, then the ones code adds. */
export function actionsFor(input: {
  intent: AssistantIntent
  proposed: readonly RawAction[]
  questions: readonly string[]
  packet: ContextPacket
}): AssistantAction[] {
  const { intent, packet } = input
  const allowed = capabilitiesOf(packet.context)
  const out: AssistantAction[] = []
  const add = (action: AssistantAction | null): void => {
    if (action === null || !allowed.has(action.kind)) return
    if (out.some((item) => item.kind === action.kind)) return
    out.push({ ...action, id: `${action.kind}-${out.length + 1}` })
  }
  for (const raw of input.proposed) add(fromProposal(raw, input.questions, packet))
  const focus = packet.rows.find((row) => row.focus && isMiss(row.status)) ?? null
  if ((intent === 'why_not_cited' || intent === 'draft') && focus) add(draftFix(focus))
  if (intent === 'questions' && input.questions.length > 0) {
    add(addQuestions(input.questions, packet))
  }
  if (intent === 'explain') {
    const number = aboutNumber(packet.context)
    if (number?.drill) add(openDrill(number.label, number.drill))
  }
  return out.slice(0, 3)
}

function fromProposal(
  raw: RawAction,
  questions: readonly string[],
  packet: ContextPacket
): AssistantAction | null {
  const rows = raw.refs
    .map((ref) => packet.rows.find((row) => row.ref === ref))
    .filter((row): row is PacketRow => row !== undefined)
  switch (raw.kind) {
    case 'add-questions':
      return addQuestions(raw.questions.length > 0 ? raw.questions : questions, packet)
    case 'create-topic':
      return createTopic(rows, raw.name)
    case 'draft-fix': {
      const row = rows[0] ?? packet.rows.find((item) => item.focus) ?? null
      return row ? draftFix(row) : null
    }
    case 'set-target': {
      const page = raw.refs
        .map((ref) => packet.pages.find((item) => item.ref === ref))
        .find((item) => item !== undefined)
      return page ? setTarget(rows, page) : null
    }
    case 'open-drill': {
      const number = aboutNumber(packet.context)
      return number?.drill ? openDrill(number.label, number.drill) : null
    }
    case 'start-check':
      return startCheck(rows.length > 0 ? rows : packet.rows.filter((row) => row.focus))
  }
}

function blank(kind: AssistantActionKind, title: string, detail: string): AssistantAction {
  return {
    id: kind,
    kind,
    title,
    detail,
    pageId: null,
    topicId: null,
    promptIds: [],
    marketIds: [],
    questions: [],
    name: null,
    targetPageId: null,
    searches: null,
    drill: null
  }
}

/** New questions go to the topic or page in view, else to the one subject in scope. */
export function addQuestions(
  questions: readonly string[],
  packet: ContextPacket
): AssistantAction | null {
  const known = new Set(packet.rows.map((row) => row.text.trim().toLowerCase()))
  const fresh = [...new Set(questions.map((item) => item.trim()))]
    .filter((item) => item.length >= 3 && !known.has(item.toLowerCase()))
    .slice(0, 10)
  if (fresh.length === 0) return null
  const context = packet.context
  const targetId =
    context.topicId ??
    context.pageId ??
    packet.rows.find((row) => row.focus)?.pageId ??
    (packet.pageIds.length === 1 ? (packet.pageIds[0] ?? null) : null)
  if (targetId === null) return null
  const row = packet.rows.find((item) => item.pageId === targetId)
  const name =
    row?.pageLabel ?? context.entities.find((item) => item.id === targetId)?.label ?? 'this page'
  const topic = row?.pageKind === 'topic' || context.topicId === targetId
  return {
    ...blank(
      'add-questions',
      `Add ${fresh.length} ${fresh.length === 1 ? 'question' : 'questions'} to ${short(name, 60)}`,
      'Checked in the next run · no searches now'
    ),
    pageId: topic ? null : targetId,
    topicId: topic ? targetId : null,
    questions: fresh
  }
}

function createTopic(rows: readonly PacketRow[], name: string | null): AssistantAction | null {
  const ids = [...new Set(rows.map((row) => row.promptId))]
  if (ids.length === 0) return null
  return {
    ...blank(
      'create-topic',
      name
        ? `Create the topic “${short(name, 60)}”`
        : `Create a topic from ${ids.length} questions`,
      `Opens New topic with ${ids.length} ${ids.length === 1 ? 'question' : 'questions'} picked · nothing is searched`
    ),
    promptIds: ids,
    name
  }
}

export function draftFix(row: PacketRow): AssistantAction {
  return {
    ...blank(
      'draft-fix',
      `Draft a fix for “${short(row.text, 70)}”`,
      'CiteFox AI drafts it from the stored overview · no searches · you review it first'
    ),
    pageId: row.pageKind === 'topic' ? null : row.pageId,
    topicId: row.pageKind === 'topic' ? row.pageId : null,
    promptIds: [row.promptId],
    marketIds: [row.marketId]
  }
}

function setTarget(
  rows: readonly PacketRow[],
  page: ContextPacket['pages'][number]
): AssistantAction | null {
  const topicRows = rows.filter((row) => row.pageKind === 'topic')
  const topicId = topicRows[0]?.pageId ?? null
  if (topicId === null) return null
  const ids = [
    ...new Set(topicRows.filter((row) => row.pageId === topicId).map((row) => row.promptId))
  ]
  return {
    ...blank(
      'set-target',
      `Point ${ids.length} ${ids.length === 1 ? 'question' : 'questions'} at ${short(page.label, 60)}`,
      `Target page: ${page.url ?? page.label} · no searches`
    ),
    topicId,
    promptIds: ids,
    targetPageId: page.id
  }
}

function openDrill(label: string, drill: string): AssistantAction {
  return {
    ...blank(
      'open-drill',
      `Open the rows behind “${short(label, 60)}”`,
      'Opens the list · no searches'
    ),
    drill
  }
}

/** A re-check of the rows: one search per question per market, within the cap. */
export function startCheck(given: readonly PacketRow[]): AssistantAction | null {
  // One check is one page or topic: the first one's rows.
  const first = given[0]?.pageId
  const rows = given.filter((row) => row.pageId === first)
  if (rows.length === 0) return null
  const promptIds = [...new Set(rows.map((row) => row.promptId))]
  const marketIds = [...new Set(rows.map((row) => row.marketId))]
  // `checks:start` runs every picked question in every picked market.
  const searches = promptIds.length * marketIds.length
  if (searches > ACTION_SEARCH_CAP) return null
  const pageIds = [first]
  return {
    ...blank(
      'start-check',
      `Check ${promptIds.length === 1 ? 'this question' : `${promptIds.length} questions`} again`,
      `${promptIds.length} ${promptIds.length === 1 ? 'question' : 'questions'} in ${marketIds.length} ${marketIds.length === 1 ? 'market' : 'markets'} · results land in Check history`
    ),
    pageId: pageIds[0] ?? null,
    promptIds,
    marketIds,
    searches
  }
}

function short(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** "Oct 19, 3:12 PM" in the computer's zone and clock: a check always shows its time. */
function shortDay(iso: string | null): string {
  if (iso === null) return 'Stored'
  if (Number.isNaN(new Date(iso).getTime())) return 'Stored'
  return formatMoment(iso)
}
