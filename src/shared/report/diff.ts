/**
 * Before vs after (Docs/REPORT-SPEC.md "What changed"): how one question's citation
 * moved between an earlier full check and the latest one. Pure, so the Overview, the
 * report model and the engine's run diff all count the same way.
 *
 * - gained: not cited before, cited now;
 * - kept: cited before and now;
 * - lost: cited before, not cited now;
 * - never: not cited before or now (an overview that does not cite you, or none at all).
 *
 * "Cited" is the own domain (any own page) in that check's overview. A question with no
 * earlier result, or whose search failed in either check, has no change: it is left out
 * of all four counts, so they never mix a measured question with an unmeasured one. A
 * failed or empty search is never "not cited".
 *
 * Like for like: the same question in the same market, and only when both checks measured
 * enough of what they set out to. A check that measured under {@link COMPARE_MIN_COVERAGE}
 * of its planned questions (searches failed, or a re-check of a few questions) hides every
 * change of that page or topic; a check above it is compared even when it is partial.
 */

/** The share of planned questions a check must have measured for its changes to show. */
export const COMPARE_MIN_COVERAGE = 0.9

/**
 * True when `measured` of `planned` questions is enough to compare (90% or more).
 * Nothing planned is never enough.
 */
export function coverageComparable(measured: number, planned: number): boolean {
  if (!Number.isFinite(planned) || planned <= 0) return false
  return measured >= COMPARE_MIN_COVERAGE * planned
}

/** Questions in a check that were measured (their search did not fail). */
export function measuredCount(sides: Iterable<DiffSide>): number {
  let count = 0
  for (const side of sides) if (!side.failed) count += 1
  return count
}

export const CITATION_CHANGES = ['gained', 'kept', 'lost', 'never'] as const

export type CitationChange = (typeof CITATION_CHANGES)[number]

export function isCitationChange(value: unknown): value is CitationChange {
  return typeof value === 'string' && (CITATION_CHANGES as readonly string[]).includes(value)
}

/** One question's result in one full check, as the diff reads it. */
export interface DiffSide {
  cited: boolean
  /** The search failed: the question was not measured in that check. */
  failed: boolean
}

/** Null when the question cannot be compared (no earlier result, or a failed search). */
export function citationChange(before: DiffSide | null, after: DiffSide): CitationChange | null {
  if (before === null || before.failed || after.failed) return null
  if (after.cited) return before.cited ? 'kept' : 'gained'
  return before.cited ? 'lost' : 'never'
}

export type ChangeCounts = Record<CitationChange, number> & {
  /** Questions with no comparable earlier result. */
  unmatched: number
}

export interface QuestionDiff<K> {
  /** Every key of `after`, with its change or null. */
  changes: Map<K, CitationChange | null>
  counts: ChangeCounts
  /** True when a check measured too little of its plan, so every change is hidden. */
  lowCoverage: boolean
}

/** How many questions each check planned, for the coverage rule. */
export interface PlannedQuestions {
  before: number
  after: number
}

/**
 * The diff of every question in `after` against `before`. Keys only in `before` are
 * ignored. With `planned`, a check that measured under {@link COMPARE_MIN_COVERAGE} of
 * its plan hides every change (each counts as unmatched).
 */
export function diffQuestions<K>(
  before: ReadonlyMap<K, DiffSide>,
  after: ReadonlyMap<K, DiffSide>,
  planned?: PlannedQuestions
): QuestionDiff<K> {
  const counts: ChangeCounts = { gained: 0, kept: 0, lost: 0, never: 0, unmatched: 0 }
  const changes = new Map<K, CitationChange | null>()
  const lowCoverage =
    planned !== undefined &&
    (!coverageComparable(measuredCount(before.values()), planned.before) ||
      !coverageComparable(measuredCount(after.values()), planned.after))
  for (const [key, now] of after) {
    const change = lowCoverage ? null : citationChange(before.get(key) ?? null, now)
    changes.set(key, change)
    if (change === null) counts.unmatched += 1
    else counts[change] += 1
  }
  return { changes, counts, lowCoverage }
}

/** Plain labels for the four changes, shared by the app and every export. */
export const CITATION_CHANGE_LABELS: Readonly<Record<CitationChange, string>> = {
  gained: 'Gained',
  kept: 'Kept',
  lost: 'Lost',
  never: 'Not cited'
}

/** One-line meaning of each change, for legends and the "How we measured" text. */
export const CITATION_CHANGE_DEFINITIONS: Readonly<Record<CitationChange, string>> = {
  gained: 'Not cited in the earlier check, cited in the latest one.',
  kept: 'Cited in both checks.',
  lost: 'Cited in the earlier check, not cited in the latest one.',
  never: 'Cited in neither check.'
}
