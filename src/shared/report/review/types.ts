import type { LoopStep } from '../../fix-loop'
import type { MetricEngine, MetricResult, SegmentDimension } from '../../metrics/types'
import type { NamedView, WhatChangedView } from './changed-types'
import type { CompetitionView } from './compete-types'
import type { BacklinkAsk, PageChangeNote, ReportBranding } from './extras'
import type { ImpactView, ReportNeeds } from './impact-types'
import type { VisibilityView } from './visibility-types'
import type { ShapeView, SourcesView } from './sources-types'
import type { ReadyView } from './ready-types'

/**
 * The ready reports (Docs/REPORT-SPEC.md "Ready reports"): the numbers, sentences and
 * drill lists of one report, built from one `MetricsResult` by {@link buildReport}.
 * The app (src/renderer/src/reports/review) and the downloaded file
 * (src/main/export/review) both draw this, so they always show the same numbers.
 */

export const REPORT_KINDS = [
  'visibility',
  'changed',
  'impact',
  'pitch',
  'content',
  'rival'
] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

/** Reports that read one check (the latest, or the one picked), never a From → To pair. */
export const ONE_CHECK_KINDS: ReadonlySet<ReportKind> = new Set([
  'visibility',
  'pitch',
  'content',
  'rival'
])

export const REVIEW_SECTIONS = [
  'standing',
  'verdict',
  'published',
  'changed',
  'questions',
  'competitors',
  'pages',
  'lost',
  'topics',
  'deep',
  'reputation',
  'sources',
  'shape',
  'notindexed',
  'backlinks',
  'next',
  'method',
  // The short ready reports (ready-types.ts): Pitch / audit, Content plan, Head-to-head.
  'summary',
  'plan',
  'writeplan',
  'h2h'
] as const
export type ReviewSectionId = (typeof REVIEW_SECTIONS)[number]

/** The lenses of the Topics switch, in order. */
export const REVIEW_LENSES = ['topic', 'funnel', 'intent', 'pageType'] as const
export type ReviewLens = (typeof REVIEW_LENSES)[number] & SegmentDimension

/** A number on screen and the drill it opens (`drills[drill]` lists exactly `n` items). */
export interface Num {
  n: number
  drill: string
}

/** A sentence: plain text and clickable numbers, in reading order. */
export type Part = string | Num

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral'

/**
 * What a drawer lists. `questions`: question ids (a `to` row id, or a `from` row id for
 * a question no longer checked). `pages`: page addresses.
 */
export interface Drill {
  title: string
  kind: 'questions' | 'pages'
  ids: readonly string[]
  /** One plain line under the title. */
  sub?: string
  /** Answer shape journeys: "Write a page in this order", one line per block. */
  outline?: readonly string[]
}

/** One question in the window: its result at both ends. */
export interface QuestionItem {
  id: string
  text: string
  topic: string
  funnel: string | null
  intent: string | null
  pageType: string | null
  /** Null: not checked at the From end (or no comparison). */
  before: MetricResult | null
  /** Null: not checked at the To end. */
  now: MetricResult | null
  /** Your page cited now, else the one cited before. */
  page: string | null
  positionBefore: number | null
  positionNow: number | null
  change: Movement | null
  /** The question's own pages: the Primary page first, then the Also OK pages. */
  targets: readonly string[]
  /** Your page cited at each end (null: none cited, or not checked). */
  pageBefore: string | null
  pageNow: string | null
  /** Your brand named in the answer at each end (null: not checked). */
  namedBefore: boolean | null
  namedNow: boolean | null
}

export type Movement = 'gained' | 'kept' | 'lost' | 'notcited' | 'noanswer'

export type PageStatus = 'cited' | 'notyet' | 'toonew' | 'lost'

export interface PageItem {
  url: string
  /** The path, such as `/pricing` (`/` for the home page). */
  path: string
  title: string | null
  kind: 'new' | 'rewrite' | null
  liveSince: string | null
  daysLive: number | null
  indexed: boolean | null
  before: number | null
  now: number
  status: PageStatus
  published: boolean
}

export interface Kpi {
  label: string
  now: string
  before: string | null
  /** Up, down or the same, read on the raw values. */
  trend: 'up' | 'down' | 'flat' | null
  drill: string
  /** One small line under the tile, such as "30% → 40% of AI answers". */
  note?: string
  /** Average position: a smaller number is better, so a fall shows in green. */
  lowerIsBetter?: true
}

export interface Tile {
  label: string
  value: string
  /** Null: the tile does not drill (such as "Longest wait"). */
  drill: string | null
  tone?: Tone
  /** On Published pages and Not indexed: the table chip this tile filters by. */
  chip?: string
}

export interface Chip {
  id: string
  label: string
  count: number
}

export interface Step {
  lead: string
  parts: readonly Part[]
  /** The report tab the step's detail is on. */
  tab?: ReviewSectionId
}

export interface Finding {
  tone: Tone
  lead: string
  parts: readonly Part[]
}

export interface BarItem {
  label: string
  sub?: string
  before: number
  now: number
  beforeDrill: string | null
  nowDrill: string
  tone?: 'target' | 'not-cited'
}

export interface BucketItem {
  label: string
  sub: string
  value: number
  drill: string
}

export interface SplitView {
  /** Change in cited questions, in tenths of a question, and its two parts. */
  totalTenths: number
  marketTenths: number
  workTenths: number
  marketDrill: string
  workDrill: string
  newAnswers: Num
  rateBefore: number | null
  rateAfter: number | null
}

export interface VerdictView {
  badge: { label: string; tone: Tone }
  headline: readonly Part[]
  findings: readonly Finding[]
  kpis: readonly Kpi[]
  split: SplitView | null
  groups: readonly BarItem[]
  speed: readonly BucketItem[]
  next: readonly Step[]
}

export interface StandingView {
  kpis: readonly Kpi[]
  funnel: readonly { label: string; value: number; drill: string }[]
  /** Your source position in each answer citing you, with the drill per bucket. */
  positions: readonly number[]
  notCited: number
}

export interface PublishedView {
  tiles: readonly Tile[]
  chips: readonly Chip[]
  rows: readonly PageItem[]
}

export interface MoverItem {
  question: QuestionItem
  cells: readonly {
    date: string
    state: 'target' | 'other' | 'named' | 'not-cited' | 'none' | 'missing'
    position: number | null
  }[]
}

export interface ChangedView {
  tiles: readonly Tile[]
  net: number
  moved: number
  compared: Num
  excluded: Num
  movers: readonly MoverItem[]
  /** The check dates the history strip shows, oldest first. */
  dates: readonly string[]
}

export interface SiteItem {
  domain: string
  own: boolean
  before: number | null
  now: number
  beforeDrill: string | null
  nowDrill: string
  withYou: number
}

export interface CompetitorsView {
  gained: readonly SiteItem[]
  lost: readonly SiteItem[]
  ranked: readonly SiteItem[]
  /** Sites cited now, for the CSV. */
  all: readonly SiteItem[]
}

export interface LostPage {
  page: PageItem
  questions: readonly QuestionItem[]
}

export interface PagesView {
  bars: readonly BarItem[]
  lost: readonly LostPage[]
}

export interface SegmentItem {
  value: string
  questions: Num
  before: Num | null
  now: Num
  shareBefore: number | null
  shareNow: number | null
  open: Num
  change: number | null
}

export interface TopicsView {
  lenses: Readonly<Record<ReviewLens, readonly SegmentItem[]>>
}

export interface NotIndexedView {
  tiles: readonly Tile[]
  rows: readonly PageItem[]
}

export interface MethodView {
  paragraphs: readonly string[]
  compared: Num
  agreement: { percent: number; pairs: Num; agree: Num } | null
  /** Answers vary: a change smaller than this many questions is read as noise. */
  noise: number
}

/** One page that lost ground: what changed on it, which questions it lost, where they went. */
export interface LostItem {
  page: PageItem
  questions: readonly QuestionItem[]
  lost: Num
  /** Of the lost questions: another page of yours is cited now. */
  toOwn: Num
  /** An answer shows and cites other sites. */
  toOthers: Num
  /** No AI answer now (or the search failed). */
  noAnswer: Num
  /** Sites the lost questions' answers cite now, most first. */
  sites: readonly { domain: string; n: number }[]
  change: PageChangeNote | null
  /** The change's day, such as "Oct 6". */
  changedLabel: string | null
  /** The recovery steps, in plain words. */
  plan: readonly string[]
}

export interface LostView {
  items: readonly LostItem[]
}

export interface BacklinksView {
  rows: readonly BacklinkAsk[]
  first: number
}

export interface RoundStepView {
  step: LoopStep
  name: string
  line: string
  owner: string
  /** What the step counts now (questions or pages), or null. */
  count: Num | null
  countWords: string
}

export interface RoundView {
  steps: readonly RoundStepView[]
  /** "Next check on Nov 2, then every 14 days." or null. */
  schedule: string | null
}

export interface DeepView {
  /** Null: no stored answer text to read. */
  shapes: {
    items: readonly BarItem[]
    wordsBefore: number | null
    wordsNow: number | null
    read: number
  } | null
  /** Your source position: #1, #2, #3, #4–5, #6+, before and now. */
  spread: readonly BarItem[]
  /** Under All engines with two or more engines: questions by how many engines cite you. */
  agree: { engines: number; buckets: readonly BucketItem[] } | null
}

export interface ReportContext {
  brand: string
  domain: string
  kind: ReportKind
  /** Formats an ISO time as a short day, such as "Sep 16" (formatMoment in the app). */
  day: (iso: string) => string
  marketLabel: string
  engineLabel: string
  /** "Whole project", "Topic: Pricing". Absent: whole project. */
  scopeLabel?: string
  /** Head-to-head: the rival's domain. Absent: the top competitor. */
  rival?: string
}

export interface ReviewReport {
  kind: ReportKind
  title: string
  /** The engine view: one engine, or `all`. */
  engine: MetricEngine
  /** "Sep 16 → Oct 28", or the latest check's day. */
  windowLabel: string
  fromLabel: string | null
  toLabel: string
  comparing: boolean
  /** `empty`: nothing to show yet; the one line says what the tab needs (greyed out). */
  sections: readonly { id: ReviewSectionId; title: string; alert?: boolean; empty?: string }[]
  standing: StandingView
  verdict: VerdictView
  published: PublishedView
  changed: ChangedView
  questions: { chips: readonly Chip[]; rows: readonly QuestionItem[] }
  competitors: CompetitorsView
  /** Competitors tab: tiles, kinds of site, every site, share of voice. */
  competition: CompetitionView
  pages: PagesView
  topics: TopicsView
  notIndexed: NotIndexedView
  lostGround: LostView
  backlinks: BacklinksView
  round: RoundView
  deep: DeepView
  /** The Visibility report's own cards (visibility.ts); built for every kind. */
  visibility: VisibilityView
  sources: SourcesView
  answerShape: ShapeView
  branding: ReportBranding
  method: MethodView
  /** Brand named, shared by every report. */
  named: NamedView
  /** The What changed report's cover, coverage, lists, drivers, pages and answer structure. */
  whatChanged: WhatChangedView
  /** The Impact review's extra proofs, tables and client asks (impact.ts). */
  impact: ImpactView
  /** Pitch / audit, Content plan and Head-to-head (ready.ts); built for every kind. */
  ready: ReadyView
  /** "What this report needs" when it cannot say anything yet; null when it can. */
  needs: ReportNeeds | null
  drills: Readonly<Record<string, Drill>>
  /** Every question by id, for drawers. */
  questionsById: Readonly<Record<string, QuestionItem>>
  pagesByUrl: Readonly<Record<string, PageItem>>
}
