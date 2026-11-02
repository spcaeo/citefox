import type { IntentStage, PromptCheckStatus } from '@shared/domain'
import type { AssistantContextInput } from '@shared/ipc'
import { askCompetitors } from '../ask/context'
import { bareDomain, readAskScope, type AskScope, type StoredAskRow } from '../ask/query'
import { STAGE_WORDS, STATUS_WORDS } from '../ask/vocabulary'
import type { SqliteDatabase } from '../storage/database'
import type { ProjectRecord } from '../storage/records'

/**
 * The context packet (deep audit crosscut §3.3 step 2): everything an Ask
 * CiteFox answer may use, read from the project's stored checks for the ids
 * the screen sent, and counted here in code. Claude explains these numbers;
 * it never counts. Every row, number and page has a ref (R1, N1, P1) that an
 * answer cites, so the drawer can link each claim to the data behind it.
 * Reading the packet never searches and never calls Claude.
 */

/** Rows listed in a prompt. Focus rows come first, then misses, then the rest. */
export const PACKET_ROW_LIMIT = 40

/** Tracked pages listed (for a target page). */
const PACKET_PAGE_LIMIT = 30

/** Sites listed as cited instead. */
const RIVAL_LIMIT = 8

/** The goal band every score screen shows. */
export const GOAL_BAND = { low: 50, high: 70 } as const

const MISSES: ReadonlySet<PromptCheckStatus> = new Set([
  'not_cited',
  'brand_mentioned',
  'other_own_page'
])

export interface PacketRow {
  ref: string
  pageId: string
  pageLabel: string
  pageKind: 'page' | 'topic'
  pageUrl: string | null
  marketId: string
  marketLabel: string
  promptId: string
  text: string
  stage: IntentStage
  status: PromptCheckStatus
  position: number | null
  movement: StoredAskRow['movement']
  cited: readonly string[]
  checkedAt: string | null
  /** A row the question is about (the picked question, the selection). */
  focus: boolean
}

export interface PacketNumber {
  ref: string
  label: string
  value: number
  /** `%` for a share; otherwise a count. */
  unit: '' | '%'
}

export interface PacketPage {
  ref: string
  id: string
  label: string
  url: string | null
  kind: 'page' | 'topic'
}

export interface ContextPacket {
  project: { name: string; domain: string }
  /** "Topic: Replacing a carrier gateway · US · EN", or "Whole project". */
  scopeLabel: string
  pageIds: readonly string[]
  marketIds: readonly string[]
  checkedThrough: string | null
  numbers: readonly PacketNumber[]
  rows: readonly PacketRow[]
  /** Rows in scope before the row limit. */
  scopeRows: number
  rivals: readonly { domain: string; rows: number }[]
  competitors: readonly { name: string; domain: string | null }[]
  pages: readonly PacketPage[]
  context: AssistantContextInput
}

/** Reads the stored checks and builds the packet for the screen's ids. */
export function buildContextPacket(
  db: SqliteDatabase,
  project: ProjectRecord,
  context: AssistantContextInput,
  now: Date
): ContextPacket {
  const scope = readAskScope(db, project, now)
  return packetFromScope(scope, project, context, askCompetitors(db))
}

/** The pure half, exported for tests. */
export function packetFromScope(
  scope: AskScope,
  project: Pick<ProjectRecord, 'name' | 'domain'>,
  context: AssistantContextInput,
  competitors: readonly { name: string; domain: string | null }[] = []
): ContextPacket {
  const subjectId = context.topicId ?? context.pageId
  const subject = subjectId ? scope.pages.find((page) => page.id === subjectId) : undefined
  let rows = subject ? scope.rows.filter((row) => row.pageId === subject.id) : [...scope.rows]
  const market = context.marketId
    ? scope.markets.find((item) => item.id === context.marketId)
    : undefined
  // A market with no stored checks on this subject keeps every market (nothing to narrow to).
  if (market && rows.some((row) => row.marketId === market.id)) {
    rows = rows.filter((row) => row.marketId === market.id)
  }
  const focusIds = focusPromptIds(context)
  const own = bareDomain(project.domain)

  const ordered = [...rows].sort((left, right) => rank(left, focusIds) - rank(right, focusIds))
  const listed = ordered.slice(0, PACKET_ROW_LIMIT).map((row, index) => ({
    ref: `R${index + 1}`,
    pageId: row.pageId,
    pageLabel: row.pageLabel,
    pageKind: row.pageKind ?? 'page',
    pageUrl: row.pageUrl,
    marketId: row.marketId,
    marketLabel: row.marketLabel,
    promptId: row.promptId,
    text: row.promptText,
    stage: row.intentStage,
    status: row.status,
    position: row.position,
    movement: row.movement,
    cited: row.citedDomains.slice(0, 5),
    checkedAt: row.checkedAt,
    focus: focusIds.has(row.promptId)
  }))

  const scopeLabel = [
    subject ? `${subject.kind === 'topic' ? 'Topic' : 'Page'}: ${subject.label}` : 'Whole project',
    market && rows.some((row) => row.marketId === market.id) ? market.label : null
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    project: { name: project.name, domain: project.domain },
    scopeLabel,
    pageIds: [...new Set(rows.map((row) => row.pageId))],
    marketIds: [...new Set(rows.map((row) => row.marketId))],
    checkedThrough: newest(rows.map((row) => row.checkedAt)),
    numbers: countNumbers(rows, focusIds),
    rows: listed,
    scopeRows: rows.length,
    rivals: rivalsOf(rows, own),
    competitors: competitors.slice(0, 20),
    pages: scope.pages
      .filter((page) => page.kind !== 'topic')
      .slice(0, PACKET_PAGE_LIMIT)
      .map((page, index) => ({
        ref: `P${index + 1}`,
        id: page.id,
        label: page.label,
        url: page.url,
        kind: page.kind ?? 'page'
      })),
    context
  }
}

/** Prompt ids the question is about: the route's prompt, the ✦ pick, the ticked rows. */
export function focusPromptIds(context: AssistantContextInput): Set<string> {
  const ids = new Set<string>()
  if (context.promptId) ids.add(context.promptId)
  if (context.about?.kind === 'question' && context.about.id) ids.add(context.about.id)
  for (const item of context.selection) {
    if (item.kind === 'question' && item.id) ids.add(item.id)
  }
  return ids
}

function rank(row: StoredAskRow, focus: ReadonlySet<string>): number {
  if (focus.has(row.promptId)) return 0
  if (MISSES.has(row.status)) return 1
  if (row.movement === 'lost' || row.movement === 'declined') return 1
  return 2
}

/**
 * The counts an answer may quote. Shares are whole percentages of the prompt
 * checks where an overview showed, as the score screens count them.
 */
export function countNumbers(
  rows: readonly StoredAskRow[],
  focus: ReadonlySet<string> = new Set()
): PacketNumber[] {
  const out: { label: string; value: number; unit: '' | '%' }[] = []
  const add = (label: string, value: number, unit: '' | '%' = ''): void => {
    out.push({ label, value, unit })
  }
  const status = (wanted: PromptCheckStatus): number =>
    rows.filter((row) => row.status === wanted).length
  const questions = new Set(rows.map((row) => row.promptId)).size
  const markets = new Set(rows.map((row) => row.marketId)).size
  const shown = rows.filter((row) => row.status !== 'no_aio' && row.status !== 'error').length
  const cited = status('page_cited')
  add('Questions in scope', questions)
  add('Markets in scope', markets)
  add('Prompt checks (question × market, latest check)', rows.length)
  add('Prompt checks where an AI Overview showed', shown)
  add(`Prompt checks where the page is cited (${STATUS_WORDS.page_cited.label})`, cited)
  add('Share cited, of the checks where an overview showed', percent(cited, shown), '%')
  add(`Prompt checks: ${STATUS_WORDS.not_cited.label}`, status('not_cited'))
  add(`Prompt checks: ${STATUS_WORDS.brand_mentioned.label}`, status('brand_mentioned'))
  add(`Prompt checks: ${STATUS_WORDS.other_own_page.label}`, status('other_own_page'))
  add(`Prompt checks: ${STATUS_WORDS.no_aio.label}`, status('no_aio'))
  add('Gained a citation since the check before', moved(rows, 'gained'))
  add('Lost a citation since the check before', moved(rows, 'lost'))
  add('Moved down since the check before', moved(rows, 'declined'))
  add('Moved up since the check before', moved(rows, 'improved'))
  add('Goal band, low end (share cited)', GOAL_BAND.low, '%')
  add('Goal band, high end (share cited)', GOAL_BAND.high, '%')
  for (const stage of Object.keys(STAGE_WORDS) as IntentStage[]) {
    const inStage = rows.filter((row) => row.intentStage === stage)
    if (inStage.length === 0) continue
    const label = STAGE_WORDS[stage].label
    add(`${label} stage: prompt checks`, inStage.length)
    add(`${label} stage: cited`, inStage.filter((row) => row.status === 'page_cited').length)
  }
  if (markets > 1) {
    for (const marketId of new Set(rows.map((row) => row.marketId))) {
      const inMarket = rows.filter((row) => row.marketId === marketId)
      const label = inMarket[0]?.marketLabel ?? marketId
      add(`${label}: prompt checks`, inMarket.length)
      add(`${label}: cited`, inMarket.filter((row) => row.status === 'page_cited').length)
    }
  }
  if (focus.size > 0) {
    const picked = rows.filter((row) => focus.has(row.promptId))
    add('Picked questions: prompt checks', picked.length)
    add('Picked questions: cited', picked.filter((row) => row.status === 'page_cited').length)
  }
  return out.map((item, index) => ({ ...item, ref: `N${index + 1}` }))
}

function moved(rows: readonly StoredAskRow[], movement: string): number {
  return rows.filter((row) => row.movement === movement).length
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100)
}

function rivalsOf(rows: readonly StoredAskRow[], own: string): { domain: string; rows: number }[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const seen = new Set<string>()
    for (const domain of row.citedDomains) {
      if (domain === own || domain.endsWith(`.${own}`) || seen.has(domain)) continue
      seen.add(domain)
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, RIVAL_LIMIT)
    .map(([domain, count]) => ({ domain, rows: count }))
}

function newest(values: readonly (string | null)[]): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (value !== null && (latest === null || value > latest)) latest = value
  }
  return latest
}

export function isMiss(status: PromptCheckStatus): boolean {
  return MISSES.has(status)
}
