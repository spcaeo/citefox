import type { EngineId } from '../../domain/engines'
import type { ClaimToneId } from './visibility-extras'
import type { Num, Part, QuestionItem, ReviewLens, Tile } from './types'

/**
 * The Visibility report's own cards (Docs/REPORT-SPEC.md "Visibility report"), built by
 * src/shared/report/review/visibility.ts and reputation.ts. Every number is a `Num`
 * whose drill lists exactly that many questions or pages.
 */

/** One fact on the cover strip. `num`: the value opens its list. */
export interface CoverFact {
  label: string
  value: string
  num?: Num
}

export interface OpportunityBar {
  id: 'invisible' | 'wrongpage' | 'ugc' | 'winning'
  label: string
  sub: string
  value: Num
}

export interface OpportunityView {
  /** Questions with an AI answer: the bars' whole. */
  answers: Num
  bars: readonly OpportunityBar[]
  /** Answers in none of the four bars (right page without your name, or named only). */
  rest: number
}

export interface EngineStandRow {
  engine: EngineId
  label: string
  answered: Num
  cited: Num
  right: Num
  named: Num
}

export interface EnginesView {
  rows: readonly EngineStandRow[]
  /** Shown instead of the rows when one engine is picked and others are on offer. */
  note: string | null
}

export interface SinceView {
  fromLabel: string
  gained: Num
  lost: Num
  newlyNamed: Num
  noLongerNamed: Num
}

export interface TargetPageRow {
  url: string
  path: string
  role: 'Primary' | 'Also OK' | 'Primary · Also OK'
  /** Questions it is a target page for. */
  questions: Num
  /** Questions each engine cites it on, in `TargetsView.engines` order. */
  engines: readonly Num[]
  total: Num
  /** Not cited by any engine in this check. */
  notCited: boolean
}

export interface OtherPageRow {
  url: string
  path: string
  questions: Num
  items: readonly QuestionItem[]
}

export interface TargetsView {
  /** Questions with a target page, of all questions. Null: no target data at all. */
  set: { n: Num; of: number } | null
  tiles: readonly Tile[]
  engines: readonly { id: EngineId; label: string }[]
  rows: readonly TargetPageRow[]
  others: readonly OtherPageRow[]
  /** One line when there is nothing to list. */
  empty: string | null
}

export type SegmentFlag = 'small' | 'within' | null

export interface SegmentExtra {
  answered: Num
  named: Num
  /** Questions citing you ÷ questions in the segment, 0–100 whole. */
  bar: number
  flag: SegmentFlag
}

export interface TopicsExtra {
  /** Per lens: groups, largest, best, weakest (best and weakest from groups of 5+). */
  universe: Readonly<Record<ReviewLens, readonly Tile[]>>
  /** Per lens, by segment value. */
  rows: Readonly<Record<ReviewLens, Readonly<Record<string, SegmentExtra>>>>
  /** Smallest group judged in best and weakest. */
  minimum: number
}

export interface ToneSlice {
  tone: ClaimToneId
  label: string
  /** Questions whose answer reads this way about you. */
  value: Num
}

export interface TonePoint {
  label: string
  positive: number
  neutral: number
  negative: number
  total: number
  /** (positive − negative) ÷ all × 100, or null below 5 claims. */
  net: number | null
}

export interface ReputationIssueView {
  id: string
  question: QuestionItem | null
  questionText: string
  claim: string
  brand: string
  own: boolean
  why: string
  correction: string
  sourceToFix: string | null
}

export interface ReputationRowView {
  question: QuestionItem
  tone: ClaimToneId
  theme: string | null
  rank: string
  reason: string | null
}

export interface ThemeView {
  theme: string
  positive: number
  neutral: number
  negative: number
  total: number
  /** Null below 2 claims. */
  net: number | null
  examples: readonly { claim: string; tone: ClaimToneId; question: QuestionItem | null }[]
}

/** You and each competitor named in the same read answers. */
export interface BrandView {
  brand: string
  own: boolean
  /** Read answers naming the brand. */
  answers: Num
  /** Of those, answers naming it first. */
  first: number
  positive: number
  neutral: number
  negative: number
  net: number | null
}

export interface ReputationView {
  /** One plain line saying what the tab needs; null when it has data to show. */
  needs: string | null
  /** Where you stand's one line: "Net sentiment +36 from 19 claims about you." Null: no data. */
  standingLine: string | null
  /** "What AI says about you": the top themes, with example claims. */
  themes: readonly ThemeView[]
  /** How you are described next to the competitors named in the same answers. */
  brands: readonly BrandView[]
  /** "Read from 9 of 11 Google AI Overview answers." */
  basis: string
  split: readonly ToneSlice[]
  claims: { positive: number; neutral: number; negative: number; net: number | null }
  trend: readonly TonePoint[]
  issues: readonly ReputationIssueView[]
  rows: readonly ReputationRowView[]
}

export interface VisibilityView {
  cover: readonly CoverFact[]
  headline: readonly Part[]
  /** A line under each Where you stand tile, in `standing.kpis` order. */
  kpiNotes: readonly string[]
  opportunity: OpportunityView
  engines: EnginesView
  since: SinceView | null
  targets: TargetsView
  topics: TopicsExtra
  reputation: ReputationView
}
