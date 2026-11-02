import { TOPIC_STAGES, type IntentStage, type TopicStage } from '@shared/domain'
import { foldWord, IMPORT_FIELDS, translateStage } from '@shared/import-fields'
import { guessStage } from '../../topics/wizard/utils/importParse'
import type { DraftRow, RowCheck, RowCounts, RowOrigin, TargetKind } from '../types'

/**
 * The grid's rows (AddQuestions.dc.html), pure: a paste split into cells, the
 * values each row sends to the importer, the footer counts, and the stage and
 * page fill. Every row is checked in main (`import:validate`); nothing here
 * decides what is added.
 */

/** Rows the grid holds; more go through Import a file. */
export const MAX_GRID_ROWS = 1000

let sequence = 0

export function rowKey(): string {
  sequence += 1
  return `r${sequence}`
}

export function emptyRow(origin: RowOrigin = 'typed'): DraftRow {
  return {
    key: rowKey(),
    question: '',
    stage: '',
    page: '',
    market: '',
    tags: '',
    topic: '',
    createTopic: false,
    addMarket: false,
    keep: false,
    origin
  }
}

export function isBlank(row: Pick<DraftRow, 'question'>): boolean {
  return row.question.trim().length === 0
}

/** The rows with exactly one empty row at the end, to type the next question in. */
export function withTail(rows: readonly DraftRow[]): DraftRow[] {
  const filled = [...rows]
  while (
    filled.length > 1 &&
    isBlank(filled.at(-1) ?? emptyRow()) &&
    isBlank(filled.at(-2) ?? emptyRow())
  ) {
    filled.pop()
  }
  if (filled.length === 0 || !isBlank(filled.at(-1) ?? emptyRow())) filled.push(emptyRow())
  return filled
}

/** What a row sends to `import:validate` and `import:commit`. */
export function rowValues(
  row: DraftRow,
  kind: TargetKind,
  defaultPage: string | null
): Record<string, string> {
  const values: Record<string, string> = { question: row.question.trim() }
  if (row.stage) values.stage = row.stage
  // A page's questions are cited on the page itself; a topic's go to a page each.
  const page = kind === 'topic' ? row.page.trim() || (defaultPage ?? '') : ''
  if (page) values.page = page
  if (row.market) values.market = row.market
  if (row.market && row.addMarket) values.addMarket = '1'
  if (row.tags.trim()) values.tags = row.tags.trim()
  // A file's Topic column: main adds the row there (or creates it on "Create it").
  if (row.topic.trim()) values.topic = row.topic.trim()
  if (row.topic.trim() && row.createTopic) values.createTopic = '1'
  return values
}

const URLISH = /^(?:https?:\/\/|www\.|\/)\S*$/iu
const MARKETISH = /^[a-z]{2}(?:[-_ ·]+[a-z]{2})?$/iu

type PasteField = 'question' | 'stage' | 'page' | 'market' | 'tags' | 'topic' | null

/**
 * A paste of several lines or cells (a block from Sheets or Excel is TSV) as
 * rows; null for plain text that belongs in the one cell. A header row is read
 * by its names; without one the columns are guessed (stage words, URLs, market
 * codes). Market cells keep the code: main resolves it.
 */
export function splitPaste(text: string): Partial<DraftRow>[] | null {
  const lines = text.split(/\r\n|\n|\r/u).filter((line) => line.trim().length > 0)
  if (lines.length < 2 && !text.includes('\t')) return null
  const cells = lines.map((line) => line.split('\t').map((cell) => cell.trim()))
  const width = cells.reduce((most, row) => Math.max(most, row.length), 0)
  const named = headerFields(cells[0] ?? [])
  const fields = named ?? guessFields(cells, width)
  const body = named === null ? cells : cells.slice(1)
  return body
    .map((row) => {
      const out: Partial<DraftRow> = {}
      row.forEach((cell, index) => {
        const field = fields[index] ?? null
        if (field === null || cell.length === 0) return
        if (field === 'stage') {
          const stage = translateStage(cell, {})
          if (stage !== 'unknown' && stage !== '') out.stage = stage
        } else if (field === 'question') {
          out.question = cell.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/u, '')
        } else out[field] = cell
      })
      return out
    })
    .filter((row) => (row.question ?? '').length > 0)
}

function headerFields(first: readonly string[]): PasteField[] | null {
  const specs = IMPORT_FIELDS.questions
  const fields = first.map((cell): PasteField => {
    const key = foldWord(cell)
    const spec = specs.find((item) => item.synonyms.includes(key) || foldWord(item.label) === key)
    return spec === undefined ? null : (spec.id as PasteField)
  })
  return fields.includes('question') ? fields : null
}

function guessFields(rows: readonly (readonly string[])[], width: number): PasteField[] {
  const fields: PasteField[] = Array.from({ length: width }, () => null)
  fields[0] = 'question'
  const share = (index: number, test: (value: string) => boolean): boolean => {
    const values = rows.map((row) => row[index] ?? '').filter((value) => value.length > 0)
    return values.length > 0 && values.filter(test).length / values.length >= 0.6
  }
  for (let index = 1; index < width; index += 1) {
    if (
      !fields.includes('stage') &&
      share(index, (value) => translateStage(value, {}) !== 'unknown')
    )
      fields[index] = 'stage'
    else if (!fields.includes('page') && share(index, (value) => URLISH.test(value)))
      fields[index] = 'page'
    else if (!fields.includes('market') && share(index, (value) => MARKETISH.test(value)))
      fields[index] = 'market'
  }
  return fields
}

/** The footer's counts over the rows and their checks. */
export function countRows(
  rows: readonly DraftRow[],
  checks: ReadonlyMap<string, RowCheck>
): RowCounts {
  const counts: RowCounts = { add: 0, keywords: 0, duplicates: 0, decide: 0, fix: 0, pending: 0 }
  for (const row of rows) {
    if (isBlank(row)) continue
    const check = checks.get(row.key)
    if (check === undefined) counts.pending += 1
    else if (check.result === 'new' || check.result === 'keyword') {
      counts.add += 1
      if (check.result === 'keyword') counts.keywords += 1
    } else if (check.result === 'duplicate') counts.duplicates += 1
    else if (check.result === 'similar') counts.decide += 1
    else counts.fix += 1
  }
  return counts
}

/** A tracked page a row can name, with the words its address and title use. */
export interface PageOption {
  value: string
  label: string
  /** The page's title or label, matched against question words. */
  title?: string
}

const STOP = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'we',
  'what',
  'when',
  'which',
  'with',
  'you',
  'your'
])

function words(text: string): Set<string> {
  return new Set(
    foldWord(text)
      .split(' ')
      .filter((word) => word.length > 1 && !STOP.has(word))
  )
}

/**
 * "Match stages and pages by keywords" (plain word matching, no AI): each row
 * without a stage gets the stage its words
 * point to (price → Decide, vs → Compare…), and each row without a page the
 * tracked page whose address or title shares the most words with it. Rows that
 * already have them keep theirs.
 */
export function fillRows(
  rows: readonly DraftRow[],
  pages: readonly PageOption[],
  kind: TargetKind
): { rows: DraftRow[]; stages: number; pages: number } {
  let stages = 0
  let filledPages = 0
  const pageWords = pages.map((page) => ({
    page,
    words: words(`${page.value.replace(/[/_.-]+/gu, ' ')} ${page.title ?? page.label}`)
  }))
  const next = rows.map((row) => {
    if (isBlank(row)) return row
    let out = row
    if (!row.stage) {
      out = { ...out, stage: guessStage(row.question) }
      stages += 1
    }
    if (kind === 'topic' && !row.page && pageWords.length > 0) {
      const own = words(row.question)
      let best: { value: string; score: number } | null = null
      for (const item of pageWords) {
        let score = 0
        for (const word of own) if (item.words.has(word)) score += 1
        if (score > 0 && (best === null || score > best.score))
          best = { value: item.page.value, score }
      }
      if (best !== null) {
        out = { ...out, page: best.value }
        filledPages += 1
      }
    }
    return out
  })
  return { rows: next, stages, pages: filledPages }
}

/** A suggestion's page intent stage as a topic stage. */
export const INTENT_TO_TOPIC: Readonly<Record<IntentStage, TopicStage | ''>> = {
  problem: 'problem',
  solution: 'options',
  comparison: 'compare',
  objection: 'doubts',
  trigger: 'decide',
  unset: ''
}

/** Questions per stage: the tracked ones and the rows typed so far. */
export function stageCounts(
  tracked: readonly (TopicStage | null)[],
  rows: readonly DraftRow[]
): Record<TopicStage, number> {
  const counts = Object.fromEntries(TOPIC_STAGES.map((stage) => [stage, 0])) as Record<
    TopicStage,
    number
  >
  for (const stage of tracked) if (stage !== null) counts[stage] += 1
  for (const row of rows) if (!isBlank(row) && row.stage) counts[row.stage] += 1
  return counts
}

/** The two stages with the fewest questions, fewest first (journey order on a tie). */
export function thinStages(counts: Readonly<Record<TopicStage, number>>): TopicStage[] {
  return [...TOPIC_STAGES].sort((left, right) => counts[left] - counts[right]).slice(0, 2)
}
