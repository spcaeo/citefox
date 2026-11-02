/**
 * What the Visibility report needs beyond the metrics (Docs/REPORT-SPEC.md "Visibility
 * report"): the cover's facts, each question's target pages, the tone CiteFox AI read in
 * the answers, and the counts since the previous check. Main reads it from the project
 * database (src/main/export/review/visibility-extras.ts); without it the report still
 * builds and those cards say what they need.
 */

export type ClaimToneId = 'positive' | 'neutral' | 'negative'

/** One read answer that names your brand ("Answer by answer"). */
export interface ReputationAnswerData {
  /** The engine row it belongs to: `google_aio:<check>:<question>`. */
  rowId: string
  tone: ClaimToneId
  theme: string | null
  /** "#1 of 3 brands named", or "Named". */
  rank: string
  /** CiteFox AI's one-line reason for your place in the answer. */
  reason: string | null
}

/** A claim CiteFox AI found wrong, with the suggested correction. */
export interface ReputationIssueData {
  id: string
  /** The engine row of the answer, or null for a brand search (not a tracked question). */
  rowId: string | null
  question: string
  claim: string
  brand: string
  own: boolean
  why: string
  correction: string
  /** The page or site to correct, when CiteFox AI named one. */
  sourceToFix: string | null
}

/** Own-brand claims in one check, by tone. */
export interface ReputationTrendData {
  /** ISO-8601 UTC: when the check finished. */
  at: string
  positive: number
  neutral: number
  negative: number
}

/** One theme of the claims about you ("What AI says about you"), with example claims. */
export interface ReputationThemeData {
  theme: string
  positive: number
  neutral: number
  negative: number
  /** Claims word for word, own brand, most telling first (negative, then positive). */
  examples: readonly { claim: string; tone: ClaimToneId; rowId: string | null }[]
}

/** One brand named in the same answers: you and each competitor. */
export interface ReputationBrandData {
  brand: string
  own: boolean
  /** Read answers that name the brand (row ids of the question answers). */
  rowIds: readonly string[]
  /** Read answers that name the brand first. */
  first: number
  positive: number
  neutral: number
  negative: number
}

/** The tone of the answers in the picked check (Google AI Overview answers are read). */
export interface ReputationData {
  themes: readonly ReputationThemeData[]
  brands: readonly ReputationBrandData[]
  brand: string | null
  /** Question answers with text in the picked check. */
  answers: number
  /** Of those, answers CiteFox AI has read. */
  read: number
  /** Own-brand claims in the picked check. */
  claims: { positive: number; neutral: number; negative: number }
  rows: readonly ReputationAnswerData[]
  issues: readonly ReputationIssueData[]
  /** One point per check up to the picked one, oldest first. */
  trend: readonly ReputationTrendData[]
}

/** The questions that moved since each one's previous check (ids are this report's `to` rows). */
export interface SinceData {
  /** ISO-8601 UTC of the latest previous check. */
  fromAt: string
  gained: readonly string[]
  lost: readonly string[]
  newlyNamed: readonly string[]
  noLongerNamed: readonly string[]
}

export interface VisibilityExtras {
  /** "Whole project", "Topic: Email to SMS". */
  scopeLabel: string
  /** The brand names the answers are searched for. */
  brands: readonly string[]
  /**
   * Each question's pages that count as the right page, by question id (`questionId`):
   * its Primary page first, then its Also OK pages. Empty or missing: no target set.
   */
  targets: Readonly<Record<string, readonly string[]>>
  reputation: ReputationData | null
  since: SinceData | null
}

export const EMPTY_VISIBILITY: VisibilityExtras = {
  scopeLabel: '',
  brands: [],
  targets: {},
  reputation: null,
  since: null
}
