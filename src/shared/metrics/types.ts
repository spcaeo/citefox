import type { EngineId } from '../domain/engines'
import type { ChangeStatus, DayBucketId } from '../fix-loop'
import type { AllEnginesCounting } from './settings'

/**
 * The shared metrics layer (Docs/METRICS.md): plain check rows in, every number the
 * reports and the in-app screens need out. Pure: no Electron, no database, no clock.
 *
 * Every count carries the ids behind it (`MetricCount.ids`), so a number on any screen
 * opens a drawer whose row total equals the number.
 */

/**
 * One question's result in one check:
 * - `target`: the page meant to answer it is cited;
 * - `other`: another page of yours is cited instead;
 * - `not_cited`: an AI answer showed and cites no page of yours;
 * - `no_answer`: the engine showed no AI answer;
 * - `failed`: the search failed, so the question was not measured.
 */
export const METRIC_RESULTS = ['target', 'other', 'not_cited', 'no_answer', 'failed'] as const

export type MetricResult = (typeof METRIC_RESULTS)[number]

/** The lenses a breakdown can group by. */
export const SEGMENT_DIMENSIONS = ['topic', 'group', 'funnel', 'intent', 'pageType'] as const

export type SegmentDimension = (typeof SEGMENT_DIMENSIONS)[number]

/** A row's value for each lens. Null: not set for this question. */
export type MetricSegments = Readonly<Record<SegmentDimension, string | null>>

/** One question checked once on one engine in one market. */
export interface MetricRow {
  /** Unique across every row given to the module. */
  id: string
  /** The question, the same across checks (and prompt-set versions). */
  questionId: string
  text: string
  /**
   * The engine. `all` marks a row that stands for every engine at once (counting
   * `once`, see settings.ts): its `parts` name the engines' own rows.
   */
  engine: MetricEngine
  marketId: string
  /** The tracked page or topic the question belongs to. */
  sourceId: string
  sourceKind: 'page' | 'topic'
  /** The check (run) this row comes from. */
  checkId: string
  /** ISO-8601 UTC: when that check finished. */
  checkedAt: string
  result: MetricResult
  /** Your best cited URL when `result` is `target` or `other`; else null. */
  citedUrl: string | null
  /** Your best (lowest) source position when cited; else null. 1 = the number-one source. */
  position: number | null
  /**
   * Every page of yours the answer cites, best position first (cited rows only). Unset:
   * only `citedUrl` is known (older callers).
   */
  ownUrls?: readonly string[]
  /** Other sites the answer cites, each once (bare hosts, or site keys). */
  domains: readonly string[]
  /**
   * Each other site's best (lowest) source position in the answer, by the same key as
   * `domains`. Absent or missing a key: the position is not known.
   */
  sitePositions?: Readonly<Record<string, number>>
  /** Your brand is named in the answer text. */
  named: boolean
  segments: MetricSegments
  /** An `all` row only: the ids of the engines' rows it stands for (each in `rows`). */
  parts?: readonly string[]
}

/** A page of yours that was published or rewritten (from the changes ledger). */
export interface MetricPage {
  url: string
  title: string | null
  /** `new`: a new page; `rewrite`: an existing page rewritten or fixed; null: unknown. */
  kind: 'new' | 'rewrite' | null
  /** ISO-8601 UTC go-live. Null: unknown. */
  liveSince: string | null
  /** Google index state. Null: never checked or the check could not tell. */
  indexed: boolean | null
}

/** Whole project, one topic, or one tracked page. */
export type MetricScope =
  { kind: 'project' } | { kind: 'topic'; id: string } | { kind: 'page'; id: string }

/** One engine, or every engine (counted as settings.ts `ALL_ENGINES_COUNTING` says). */
export type MetricEngine = EngineId | 'all'

/**
 * The two ends compared. `to` null: the latest check. `from` null: latest only (no
 * comparison); `previous`: each question's check before its `to` check; an ISO time: each
 * question's newest check at or before that moment.
 */
export interface MetricWindow {
  from: string | 'previous' | null
  to: string | null
}

export interface MetricsInput {
  rows: readonly MetricRow[]
  pages?: readonly MetricPage[]
  /** Your domain, for the "you" row of the site movers. */
  ownDomain: string
  scope: MetricScope
  /** Null: every market. */
  marketId: string | null
  engine: MetricEngine
  window: MetricWindow
  /** How "All engines" counts. Default: `ALL_ENGINES_COUNTING`. */
  counting?: AllEnginesCounting
}

/** A number and the ids behind it: `n === ids.length`, always. */
export interface MetricCount {
  n: number
  ids: readonly string[]
}

/**
 * The same question at both ends. Built by {@link resolveWindow}, or by a consumer that
 * already holds both ends (Summary, the offline report).
 */
export interface MetricPair {
  key: string
  from: MetricRow | null
  to: MetricRow
}

/** Counts over one set of rows (one end of the window). */
export interface SideCounts {
  /** Every row. */
  checked: MetricCount
  /** Rows whose search did not fail. */
  measured: MetricCount
  failed: MetricCount
  /** An AI answer showed. */
  answered: MetricCount
  noAnswer: MetricCount
  /** A page of yours is cited (target or other). */
  cited: MetricCount
  target: MetricCount
  other: MetricCount
  notCited: MetricCount
  named: MetricCount
  /** An answer showed that neither cites you nor names you. */
  notVisible: MetricCount
  /** You are the number-one source. */
  first: MetricCount
  /** cited ÷ answered, 0–1. Null without answers. */
  rate: number | null
}

/** How each compared question moved. */
export interface Movement {
  gained: MetricCount
  kept: MetricCount
  lost: MetricCount
  /** Not cited at either end, with an answer now. */
  notCited: MetricCount
  /** Not cited at either end, with no answer now. */
  noAnswer: MetricCount
  /** `notCited` + `noAnswer`: cited at neither end. */
  never: MetricCount
  /** No answer before, an answer now. */
  newAnswers: MetricCount
  /** An answer before, none now. */
  goneAnswers: MetricCount
  /** Named before / now, over compared questions. */
  namedBefore: MetricCount
  namedAfter: MetricCount
}

/**
 * Market vs your work. The change in cited questions splits into the part explained by
 * answers appearing or vanishing at your old rate (`market`) and the rest (`work`).
 * Kept in tenths so the parts add up exactly: `marketTenths + workTenths === total × 10`.
 */
export interface Decomposition {
  total: number
  market: number
  work: number
  marketTenths: number
  workTenths: number
  rateBefore: number | null
  rateAfter: number | null
  /** Questions whose answer appeared or vanished: the rows behind `market`. */
  marketIds: readonly string[]
  /** Questions gained or lost: the rows behind `work`. */
  workIds: readonly string[]
}

/** Questions left out of the comparison, and why. */
export interface Excluded {
  /** Checked at the `to` end only. Ids of the `to` rows. */
  noBefore: MetricCount
  /** Checked at the `from` end only. Ids of the `from` rows. */
  noAfter: MetricCount
  /** The search failed at either end. Ids of the `to` rows. */
  failed: MetricCount
}

export interface Comparison {
  /** Questions measured at both ends. */
  compared: MetricCount
  before: SideCounts
  after: SideCounts
  movement: Movement
  decomposition: Decomposition
  excluded: Excluded
}

/** A before → after pair of counts for one item. Before is null without a comparison. */
export interface BeforeAfter {
  /** Over every `to` row. */
  now: MetricCount
  /** Over compared questions, at the `from` end. */
  before: MetricCount | null
  /** Over compared questions, at the `to` end. */
  after: MetricCount | null
}

export interface SegmentRow {
  value: string
  questions: MetricCount
  answered: BeforeAfter
  cited: BeforeAfter
  /** Answer shows now, not citing you: the opening. */
  open: MetricCount
  rateNow: number | null
  rateBefore: number | null
  rateAfter: number | null
}

export interface DomainRow {
  domain: string
  own: boolean
  cited: BeforeAfter
  /** Now: questions citing this site and you in the same answer. */
  withYou: MetricCount
  /** after − before, or null without a comparison. */
  change: number | null
  /**
   * The site's average source position (1 = first source) over the answers citing it,
   * one decimal. `now` over every `to` row, `before`/`after` over compared questions.
   * Null where no citing answer has a known position (or without a comparison).
   */
  position: { now: number | null; before: number | null; after: number | null }
}

export interface PageRow {
  url: string
  title: string | null
  kind: 'new' | 'rewrite' | null
  liveSince: string | null
  daysLive: number | null
  indexed: boolean | null
  /** Questions citing this page. */
  cited: BeforeAfter
  change: number | null
  /** The Fixes screen's rule (`changeStatus`): lost ground, cited now, too new, not cited yet. */
  status: ChangeStatus
}

export interface PageGroupRow {
  kind: 'new' | 'rewrite' | 'other'
  cited: BeforeAfter
}

export interface SpeedBucket {
  id: DayBucketId
  label: string
  /** Published pages live this long (ids are page URLs). */
  pages: MetricCount
  /** Of those, pages cited now. */
  citedPages: MetricCount
  /** Questions citing those pages now (row ids). */
  questions: MetricCount
}

export interface PageMetrics {
  rows: readonly PageRow[]
  groups: readonly PageGroupRow[]
  speed: readonly SpeedBucket[]
  /** Page counts: ids are page URLs. */
  published: MetricCount
  newPages: MetricCount
  rewrites: MetricCount
  citedNow: MetricCount
  notCitedYet: MetricCount
  tooNew: MetricCount
  lostGround: MetricCount
  notIndexed: MetricCount
}

export interface HistoryPoint {
  rowId: string
  checkId: string
  checkedAt: string
  result: MetricResult
  position: number | null
  /** Your brand is named in that answer. Absent: not known. */
  named?: boolean
}

export interface QuestionHistory {
  key: string
  questionId: string
  engine: MetricEngine
  marketId: string
  /** Oldest first, within the window. */
  points: readonly HistoryPoint[]
}

export interface EngineRow {
  engine: EngineId
  answered: BeforeAfter
  cited: BeforeAfter
}

/** One finished check in scope, for the From and To pickers. */
export interface MetricCheck {
  id: string
  /** ISO-8601 UTC: when it finished. */
  at: string
}

export interface MetricsResult {
  scope: MetricScope
  marketId: string | null
  engine: MetricEngine
  window: MetricWindow
  /** How "All engines" counted this result. */
  counting: AllEnginesCounting
  /** Engines with rows in this scope and market, whatever the engine filter (app order). */
  offeredEngines: readonly EngineId[]
  /** Every finished check in this scope and market, oldest first. */
  checks: readonly MetricCheck[]
  /** Every `to` row in scope. */
  now: SideCounts
  /** Null with `from` null. */
  comparison: Comparison | null
  segments: Readonly<Record<SegmentDimension, readonly SegmentRow[]>>
  domains: readonly DomainRow[]
  pages: PageMetrics
  engines: readonly EngineRow[]
  history: readonly QuestionHistory[]
  /** Each `to` row's row at the `from` end, by id (questions with no `from` row left out). */
  fromOf: Readonly<Record<string, string>>
  /** Every row a count above names, by id (history points carry their own fields). */
  rows: Readonly<Record<string, MetricRow>>
}
