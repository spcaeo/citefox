import type { PromptCheckRow } from '@shared/domain'
import { citesOwnDomain } from '@shared/report-copy'
import {
  coverageComparable,
  diffQuestions,
  measuredCount,
  type DiffSide,
  type QuestionDiff
} from '@shared/report/diff'

/**
 * Before vs after for two stored runs (Docs/REPORT-SPEC.md "What changed"): each prompt
 * in each market, gained / kept / lost / never cited. Pure: callers read the rows
 * (`runPromptRows`) and pass them in.
 *
 * Like for like: the same question in the same market. A pair from two markets is not
 * comparable, and neither is a pair where either run measured under 90% of the questions
 * it planned (failed searches, or a re-check of a few prompts). A partial run that
 * measured 90% or more is compared like any other. A failed search is never "not cited".
 */

/** One stored run's prompt rows, as `runPromptRows` returns them. */
export interface RunRows {
  runId: string
  marketId: string
  partial: boolean
  rows: readonly PromptCheckRow[]
  /**
   * Questions the run was meant to measure: the enabled prompts of its prompt set in its
   * market. Default: its rows. A partial run passes the full set's count, so a re-check
   * of a few prompts stays under 90%.
   */
  planned?: number
}

export interface RunDiffOptions {
  /**
   * The question a row belongs to. Default: the prompt id. Pass the lineage root (or a
   * topic's stable key) so a reworded prompt is still the same question.
   */
  keyOf?: (row: PromptCheckRow) => string
  /** Default: the overview links an own-domain page (`page_cited` or `other_own_page`). */
  isCited?: (row: PromptCheckRow) => boolean
}

export type RunDiff =
  | { comparable: true; diff: QuestionDiff<string> }
  | { comparable: false; reason: 'coverage' | 'market' | 'none'; diff: null }

/** How the diff reads one row. */
export function diffSide(row: PromptCheckRow, isCited = defaultCited): DiffSide {
  return { cited: row.status !== 'error' && isCited(row), failed: row.status === 'error' }
}

function defaultCited(row: PromptCheckRow): boolean {
  return citesOwnDomain(row.status)
}

/** Side keyed by `marketId|question`. */
export function runSides(
  run: RunRows,
  options: RunDiffOptions = {}
): Map<string, DiffSide & { row: PromptCheckRow }> {
  const keyOf = options.keyOf ?? ((row: PromptCheckRow) => row.promptId)
  const sides = new Map<string, DiffSide & { row: PromptCheckRow }>()
  for (const row of run.rows) {
    sides.set(`${run.marketId}|${keyOf(row)}`, { ...diffSide(row, options.isCited), row })
  }
  return sides
}

/**
 * The diff of `after` against `before`. Not comparable when there is no earlier run, the
 * markets differ, or either run measured under 90% of its planned questions.
 */
export function diffRuns(
  before: RunRows | null,
  after: RunRows,
  options: RunDiffOptions = {}
): RunDiff {
  if (before === null) return { comparable: false, reason: 'none', diff: null }
  if (before.marketId !== after.marketId) {
    return { comparable: false, reason: 'market', diff: null }
  }
  const beforeSides = runSides(before, options)
  const afterSides = runSides(after, options)
  if (
    !coverageComparable(measuredCount(beforeSides.values()), plannedOf(before)) ||
    !coverageComparable(measuredCount(afterSides.values()), plannedOf(after))
  ) {
    return { comparable: false, reason: 'coverage', diff: null }
  }
  return { comparable: true, diff: diffQuestions(beforeSides, afterSides) }
}

function plannedOf(run: RunRows): number {
  return Math.max(run.planned ?? run.rows.length, run.rows.length)
}
