import type { HelpFillResult } from '@shared/ipc'
import { normaliseQuestion } from '@shared/question-text'
import type { DraftRow } from '../types'
import { isBlank } from './rows'

/** The most questions one Match pages request sends (the helper's `items` limit). */
export const MATCH_ITEMS_MAX = 200

/** What ✦ Match pages did to the rows, for the line under it. */
export interface MatchOutcome {
  /** Row key → the tracked page's URL to set. */
  pages: ReadonlyMap<string, string>
  /** Rows the answer gave no tracked page (they keep theirs). */
  none: number
  /** Rows the answer gave a page that is not tracked: flagged, never set. */
  untracked: readonly { key: string; question: string; page: string }[]
  /** Answer rows that match no row in the grid (reworded by the chatbot). */
  unknown: number
}

/** The grid's questions, in order, for the helper's `items`. */
export function matchItems(rows: readonly DraftRow[]): string[] {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => row.question.trim())
    .slice(0, MATCH_ITEMS_MAX)
}

/**
 * The answer's rows matched back to the grid's rows by their question (case and
 * punctuation ignored). A tracked page is set; "none" leaves the row as it is; a
 * page that is not tracked (`untracked`, from main) is flagged, never set.
 */
export function matchOutcome(rows: readonly DraftRow[], result: HelpFillResult): MatchOutcome {
  const byQuestion = new Map<string, DraftRow[]>()
  for (const row of rows) {
    if (isBlank(row)) continue
    const key = normaliseQuestion(row.question)
    byQuestion.set(key, [...(byQuestion.get(key) ?? []), row])
  }
  const pages = new Map<string, string>()
  const untracked: { key: string; question: string; page: string }[] = []
  let none = 0
  let unknown = 0
  for (const answer of result.rows) {
    const matched = byQuestion.get(normaliseQuestion(answer.values.question ?? '')) ?? []
    if (matched.length === 0) {
      unknown += 1
      continue
    }
    const page = answer.values.page ?? ''
    const asked = answer.values.untracked ?? ''
    for (const row of matched) {
      if (page !== '') pages.set(row.key, page)
      else if (asked !== '') untracked.push({ key: row.key, question: row.question, page: asked })
      else none += 1
    }
  }
  return { pages, none, untracked, unknown }
}

/** "Set the page on 2 rows. 1 has no tracked page that fits and keeps its page." */
export function matchSummary(outcome: MatchOutcome): string {
  const rows = (n: number): string => `${n} ${n === 1 ? 'row' : 'rows'}`
  const parts = [
    outcome.pages.size === 0
      ? 'No page was set.'
      : `Set the page on ${rows(outcome.pages.size)}. You can still change each one.`
  ]
  if (outcome.none > 0) {
    parts.push(
      `${outcome.none} ${outcome.none === 1 ? 'has' : 'have'} no tracked page that fits and ${outcome.none === 1 ? 'keeps its' : 'keep their'} page.`
    )
  }
  if (outcome.unknown > 0) {
    parts.push(
      `${outcome.unknown} ${outcome.unknown === 1 ? 'answer row was' : 'answer rows were'} not a question in the rows.`
    )
  }
  return parts.join(' ')
}
