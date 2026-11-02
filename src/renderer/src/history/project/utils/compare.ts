import type { PageResults, PromptCheckRow } from '@shared/domain'
import { aioLabel, hasAio } from '../../../m3/model'

/**
 * Compare checks, results first: two checks of the same page or topic, question
 * by question. Questions match by id (the same prompt set), else by their words
 * (a new prompt-set version that kept the question).
 */

/** How one question moved from the older check to the newer one. */
export type QuestionMove = 'gained' | 'lost' | 'moved-up' | 'moved-down' | 'same' | 'new' | 'gone'

export interface ComparedQuestion {
  key: string
  /** The question's place in the newer check (the older one when it is gone). */
  position: number
  label: string
  text: string
  before: PromptCheckRow | null
  after: PromptCheckRow | null
  move: QuestionMove
}

export interface CheckTotals {
  questions: number
  overviews: number
  cited: number
  named: number
  score: number | null
}

/**
 * Cited for this comparison: the page itself, or, for a topic, an AI Overview that
 * links any page of the site (the rule every screen uses, so Check history's Cited
 * count and its drill match the topic page).
 */
export function isCited(row: PromptCheckRow | null, topic: boolean): boolean {
  if (row === null) return false
  if (!topic) return row.status === 'page_cited'
  return (
    hasAio(row) &&
    row.references.some((ref) => ref.classification === 'target' || ref.classification === 'own')
  )
}

function wordsOf(row: PromptCheckRow): string {
  return row.text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The two checks' questions side by side, in the newer check's order, then the gone ones. */
export function pairQuestions(
  before: PageResults,
  after: PageResults,
  topic: boolean
): ComparedQuestion[] {
  const olderById = new Map(before.prompts.map((row) => [row.promptId, row]))
  const olderByWords = new Map(before.prompts.map((row) => [wordsOf(row), row]))
  const used = new Set<string>()
  const out: ComparedQuestion[] = []
  for (const row of after.prompts) {
    const match = olderById.get(row.promptId) ?? olderByWords.get(wordsOf(row)) ?? null
    const old = match !== null && !used.has(match.promptId) ? match : null
    if (old !== null) used.add(old.promptId)
    out.push({
      key: row.promptId,
      position: row.promptPosition,
      label: row.label,
      text: row.text,
      before: old,
      after: row,
      move: moveOf(old, row, topic)
    })
  }
  for (const row of before.prompts) {
    if (used.has(row.promptId)) continue
    out.push({
      key: `gone:${row.promptId}`,
      position: row.promptPosition,
      label: row.label,
      text: row.text,
      before: row,
      after: null,
      move: 'gone'
    })
  }
  return out
}

function moveOf(
  before: PromptCheckRow | null,
  after: PromptCheckRow,
  topic: boolean
): QuestionMove {
  if (before === null) return 'new'
  const was = isCited(before, topic)
  const now = isCited(after, topic)
  if (!was && now) return 'gained'
  if (was && !now) return 'lost'
  if (was && now && before.position !== null && after.position !== null) {
    if (after.position < before.position) return 'moved-up'
    if (after.position > before.position) return 'moved-down'
  }
  return 'same'
}

/** The headline numbers of one check, counted from its question rows as Results counts them. */
export function totalsOf(results: PageResults, topic: boolean): CheckTotals {
  const rows = results.prompts
  return {
    questions: rows.length,
    overviews: rows.filter(hasAio).length,
    cited: rows.filter((row) => isCited(row, topic)).length,
    named: rows.filter((row) => hasAio(row) && row.named === true).length,
    score: results.run?.visibilityScore ?? null
  }
}

/** Questions gained and lost between the two checks. */
export function moveCounts(questions: readonly ComparedQuestion[]): {
  gained: number
  lost: number
} {
  return {
    gained: questions.filter((item) => item.move === 'gained').length,
    lost: questions.filter((item) => item.move === 'lost').length
  }
}

/** "Yes", "No", "Unknown", or an em dash when the question was not in that check. */
export function overviewText(row: PromptCheckRow | null): string {
  return row === null ? '—' : aioLabel(row)
}

/** "Yes", "Other page", "No", "—". */
export function citedText(row: PromptCheckRow | null, topic: boolean): string {
  if (row === null) return '—'
  if (isCited(row, topic)) return 'Yes'
  if (row.status === 'other_own_page') return 'Other page'
  if (row.status === 'error') return 'Unknown'
  return 'No'
}

/** "#2", "#1.5", or an em dash when the page was not cited. */
export function positionText(row: PromptCheckRow | null, topic: boolean): string {
  if (row === null || !isCited(row, topic) || row.position === null) return '—'
  const rounded = Math.round(row.position * 10) / 10
  return `#${rounded}`
}

const MOVE_LABELS: Readonly<Record<QuestionMove, string>> = {
  gained: 'Gained',
  lost: 'Lost',
  'moved-up': 'Moved up',
  'moved-down': 'Moved down',
  same: 'No change',
  new: 'Only in newer',
  gone: 'Only in older'
}

export function moveLabel(move: QuestionMove): string {
  return MOVE_LABELS[move]
}

export function moveTone(move: QuestionMove): 'ok' | 'bad' | 'neutral' | 'info' {
  if (move === 'gained' || move === 'moved-up') return 'ok'
  if (move === 'lost' || move === 'moved-down') return 'bad'
  if (move === 'new' || move === 'gone') return 'info'
  return 'neutral'
}

/** The three counts a Check history row drills into. */
export type CountKind = 'aio' | 'cited' | 'named'

/** The questions of one check behind a count, as Results counts them. */
export function countRows(
  rows: readonly PromptCheckRow[],
  kind: CountKind,
  topic: boolean
): PromptCheckRow[] {
  if (kind === 'aio') return rows.filter(hasAio)
  if (kind === 'cited') return rows.filter((row) => isCited(row, topic))
  return rows.filter((row) => hasAio(row) && row.named === true)
}

/** What each count column counts, as its drill drawer's title. */
export const COUNT_TITLES: Readonly<Record<CountKind, string>> = {
  aio: 'Questions with an AI Overview',
  cited: 'Questions whose AI Overview cited you',
  named: 'Questions whose AI Overview named your brand'
}
