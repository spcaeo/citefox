import type { SetupContext, SetupRow, SetupSectionResult } from '@shared/ipc'
import { settleRows } from '../../helpfill/merge'
import { NO_ANSWER, readReply } from '../../helpfill/reader'
import { NO_TEXT, readTextReply } from '../../helpfill/text'
import { isNotAnAnswer, NOT_AN_ANSWER } from '../../assist/answer-guard'
import type { HelpFillContext, HelpFillKindDef, HelpFillSection } from '../../helpfill/types'
import { cutAtSentence, groundSummary, isSitePath, siteCheckOf } from '../../engine/site-grounding'
import type { SiteOutline } from '../../engine/site-outline'
import { pathOrNull } from './rows'
import type { ListSectionDef, SectionDef, SiteGround, TextSectionDef } from './types'

/**
 * A reply (Claude's, or a chatbot answer pasted back) as section rows: the help-fill
 * reader finds the table or list (`helpfill/reader.ts`), each row is tidied and
 * guarded by the section (`toRow`), then the help-fill merge (`helpfill/merge.ts`)
 * drops near-duplicates of the rows the section holds and of each other, and sets
 * aside questions that name the brand. A text section keeps the answer without the
 * chatbot's words around it (`helpfill/text.ts`). Pure: nothing is saved.
 */

export const NOTHING_NEW = 'Nothing new came back. Try other words, or edit the prompt.'
/** An in-app run with no rows: Claude answered, it had nothing to add (not a bad paste). */
export const CLAUDE_NOTHING_NEW = 'Claude found nothing new to add.'
export const CLAUDE_NO_TEXT = 'Claude sent no text back. Try again, or edit the prompt.'

/**
 * `run`: Claude's own reply in the app. `paste`: a chatbot answer pasted back, where
 * "no table or list found" is the right advice.
 */
export type ReplySource = 'run' | 'paste'

export function settleReply(
  def: SectionDef,
  context: SetupContext,
  current: readonly SetupRow[],
  text: string,
  source: ReplySource,
  site: SiteOutline | null = null
): SetupSectionResult {
  const ground = groundOf(site)
  const result =
    def.kind === 'text'
      ? settleText(def, text, ground)
      : settleList(def, context, current, text, ground)
  if (source === 'paste') return result
  return {
    ...result,
    warnings: result.warnings.map((warning) =>
      warning === NO_ANSWER ? CLAUDE_NOTHING_NEW : warning === NO_TEXT ? CLAUDE_NO_TEXT : warning
    )
  }
}

/** The site's checks and the read's finds; nothing when the site is not known. */
export function groundOf(site: SiteOutline | null): SiteGround {
  return { check: siteCheckOf(site), facts: site?.facts ?? null }
}

/** Characters read from a text reply before it is cut at a sentence end. */
const TEXT_READ_MAX = 4000

function settleText(def: TextSectionDef, text: string, ground: SiteGround): SetupSectionResult {
  const read = readTextReply(text, TEXT_READ_MAX)
  const warnings = read.warnings.filter((warning) => !warning.startsWith('Only the first'))
  let flat: string
  if (def.id === 'topic') {
    const topic = topicReply(read.text)
    flat = topic.name.slice(0, def.maxChars).trim()
    if (topic.path !== null && ground.check !== null && ground.check.paths.size > 0) {
      if (!isSitePath(ground.check, topic.path)) {
        warnings.push(`The topic's page ${topic.path} is not on the site. Check the topic.`)
      }
    }
  } else {
    // A label or number the pages never use comes out; the text ends at a sentence end.
    flat = cutAtSentence(groundSummary(read.text, ground.check), def.maxChars)
  }
  if (isNotAnAnswer(flat)) {
    return { section: def.id, rows: [], text: null, warnings: [NOT_AN_ANSWER] }
  }
  return {
    section: def.id,
    rows: [],
    text: flat.length > 0 ? flat : null,
    warnings
  }
}

function settleList(
  def: ListSectionDef,
  context: SetupContext,
  current: readonly SetupRow[],
  text: string,
  ground: SiteGround
): SetupSectionResult {
  const section: HelpFillSection = {
    id: 'main',
    title: null,
    columns: def.columns,
    entity: def.entity,
    ...(def.fields !== undefined ? { fields: def.fields } : {}),
    neutral: def.neutral
  }
  const read = readReply(text, [section])
  // Each reply row becomes a SetupRow once; the merge compares the row's keys.
  const built = new Map<string, SetupRow>()
  const keyOf = (row: SetupRow): string => def.keys(row)[0] ?? row.name
  // A company row with a domain also matches a held row by its name (and the other way).
  const held = new Set(
    current
      .flatMap((row) => def.keys(row))
      .map(foldKey)
      .filter(Boolean)
  )
  const kind: HelpFillKindDef = {
    kind: `setup.${def.id}`,
    noun: def.noun,
    scope: 'project',
    sections: [section],
    neutral: def.neutral,
    defaultCount: def.count,
    maxCount: def.maxRows,
    chatbotCount: def.count,
    describeCost: { calls: 0, usd: 0 },
    role: () => '',
    task: () => [],
    tracked: () => ({ listed: [], merge: { main: current.flatMap((row) => def.keys(row)) } }),
    key: (values) => values.__key ?? '',
    clean(values) {
      const row = def.toRow(values, context, ground)
      if (row === null || def.keys(row).some((key) => held.has(foldKey(key) || '-'))) return null
      const key = keyOf(row)
      if (!built.has(key)) built.set(key, row)
      // The merge reads the main column and the key; the row itself is kept aside.
      return { [def.columns[0] ?? 'name']: row.name, __key: key }
    }
  }
  const settled = settleRows(kind, helpFillContext(context), read.rows, read.warnings)
  let rows: SetupRow[] = []
  for (const item of settled.rows) {
    const row = built.get(item.values.__key ?? '')
    if (row !== undefined) rows.push(row)
  }
  const warnings = [...settled.warnings]
  if (def.finish !== undefined) {
    const finished = def.finish(rows, context, ground)
    rows = finished.rows
    warnings.push(...finished.warnings)
  }
  // A finish may add rows back (the read's own brands): never one the section holds.
  rows = rows.filter((row) => !def.keys(row).some((key) => held.has(foldKey(key) || '-')))
  const kept = rows.length
  rows = rows.slice(0, def.maxRows)
  if (settled.setAside.length > 0) {
    const count = settled.setAside.length
    warnings.push(
      `${count} ${def.noun[count === 1 ? 0 : 1]} named the brand and ${count === 1 ? 'was' : 'were'} left out.`
    )
  }
  if (kept > rows.length) warnings.push(`Only the first ${def.maxRows} were kept.`)
  if (rows.length === 0 && read.rows.length > 0) warnings.push(NOTHING_NEW)
  return { section: def.id, rows, text: null, warnings }
}

/** The help-fill merge only reads the brand names from its context. */
function helpFillContext(context: SetupContext): HelpFillContext {
  return {
    projectId: 'setup',
    domain: context.domain,
    brands: [...context.brands],
    target: null,
    blocks: [],
    pagePaths: [],
    targetQuestions: [],
    projectQuestions: [],
    promptId: null,
    subject: null
  }
}

function foldKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The topic's name (its first line) and the path on the next line, when one is given. */
function topicReply(text: string): { name: string; path: string | null } {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const name = (lines[0] ?? '')
    .replace(/^(?:topic(?: name)?\s*[:–—-]\s*)/iu, '')
    .replace(/^["“'‘]|["”'’.]$/gu, '')
    .trim()
  const second = (lines[1] ?? '').replace(/^(?:(?:source|page|path)\s*[:–—-]\s*)/iu, '').trim()
  return { name, path: second.length > 0 ? pathOrNull(second.split(/\s/u)[0] ?? '') : null }
}
