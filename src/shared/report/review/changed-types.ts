import type { BarItem, Num, PageItem, QuestionItem, ReviewLens, Tile } from './types'

/**
 * The parts of a ready report added for the What changed report (Docs/REPORT-SPEC.md
 * "What changed"): brand named (shared by every report), the cover strip, coverage, the
 * four movement lists, the verdict drivers, changed pages and answer structure. Kept out
 * of types.ts so that file stays small.
 */

/** One lens value's brand-named share, before → now. Share = named ÷ AI answers. */
export interface NamedSegment {
  before: Num | null
  now: Num
  shareBefore: number | null
  shareNow: number | null
  /** shareNow − shareBefore, in percentage points (one decimal), or null. */
  change: number | null
}

/** One row of the split table under "Market vs your work". */
export interface SplitRow {
  key: 'cited' | 'named'
  label: string
  before: Num
  after: Num
  change: number
  /** The change from more or fewer AI answers, in tenths of a question. */
  marketTenths: number
  /** The change from your share of answers, in tenths. `marketTenths + workTenths = change × 10`. */
  workTenths: number
  shareBefore: number | null
  shareAfter: number | null
}

/** Brand named: answers whose text names the brand, as a second headline. */
export interface NamedView {
  /** Over compared questions when comparing, else every question now. */
  now: Num
  before: Num | null
  shareNow: number | null
  shareBefore: number | null
  /** Named now, not before (compared questions). */
  newly: Num
  /** Named before, not now. */
  noLonger: Num
  /** Movement tiles: Newly named, No longer named. Empty without a comparison. */
  tiles: readonly Tile[]
  /** Citing you and Brand named, before / after / change and the split. Empty without a comparison. */
  splitRows: readonly SplitRow[]
  /** By lens, then by the lens value (the Topics table's `value`). */
  lenses: Readonly<Record<ReviewLens, Readonly<Record<string, NamedSegment>>>>
}

export interface CoverView {
  fromLabel: string | null
  toLabel: string
  engineLabel: string
  scopeLabel: string
  /** Questions measured at both ends. */
  compared: Num
  /** Questions in scope at either end. */
  inScope: number
  answersFrom: Num | null
  answersTo: Num
  /** "Every number covers the 11 questions checked on both dates." */
  line: string
}

export interface CoverageView {
  compared: Num
  inScope: number
  /** compared ÷ in scope, 0–100, whole number. Null with nothing in scope. */
  percent: number | null
  newSince: Num
  noLonger: Num
  failed: Num
  nothingLeftOut: boolean
  /** "11 compared of 12 in scope (92%)". */
  footer: string
}

export type MoveListId = 'gained' | 'lost' | 'named' | 'unnamed'

export interface MoveList {
  id: MoveListId
  label: string
  num: Num
  tone: 'ok' | 'warn'
  items: readonly QuestionItem[]
}

export interface SiteDriver {
  domain: string
  before: number
  now: number
  change: number
  beforeNum: Num
  nowNum: Num
}

export interface PositionDriver {
  /** Average source position when cited, one decimal. Null: not cited at that end. */
  before: number | null
  now: number | null
  beforeNum: Num
  nowNum: Num
}

export interface DriversView {
  gainer: SiteDriver | null
  loser: SiteDriver | null
  position: PositionDriver | null
  /** Questions that stopped citing you (the "Win back" step). */
  winBack: Num
}

export interface SetShare {
  label: string
  questions: Num
  citedBefore: Num
  citedNow: Num
  /** cited ÷ questions compared, 0–1. */
  shareBefore: number | null
  shareNow: number | null
}

export interface ChangedPageRow {
  page: PageItem
  /** "2 new sections, 1,240 → 1,610 words." from page history, else from saved page edits. */
  size: string | null
  /** When the change went live (page history, else go-live). */
  changedAt: string | null
  /** Days from the change to the To check. Null: unknown. */
  daysBefore: number | null
  /** Under the 14-day rule: too recent to judge. */
  tooRecent: boolean
  /** The page's target questions (Primary + Also OK). */
  targets: Num
  citedBefore: Num | null
  citedNow: Num
}

export interface ChangedPagesView {
  rows: readonly ChangedPageRow[]
  /** Changed pages' target questions vs every other question. Null: no changed page has targets. */
  compare: { changed: SetShare; rest: SetShare } | null
}

export interface ShapeChange {
  question: QuestionItem
  before: string
  after: string
  opener: boolean
}

export interface StructureView {
  /** Compared questions whose answer blocks were read at both ends. */
  analysed: Num
  changedOpener: Num
  changedShape: Num
  /** Answers holding each block, before → now. */
  blocks: readonly BarItem[]
  changes: readonly ShapeChange[]
}

export interface WaitingView {
  title: string
  line: string
  /** "Next check on Nov 11, then every 14 days." or null. */
  next: string | null
}

export interface ToneSplit {
  positive: number
  neutral: number
  negative: number
  total: number
  /** (positive − negative) ÷ all × 100, whole number. Null below 5 claims: not enough data. */
  net: number | null
}

export interface ClaimItem {
  question: QuestionItem
  sentence: string
  theme: string
}

/** How AI talks about you: the tone of the claims about your brand, before → now. */
export interface SentimentView {
  before: ToneSplit
  now: ToneSplit
  /** Questions with a negative claim now that was not there before. */
  newlyNegative: Num
  newlyNegativeClaims: readonly ClaimItem[]
  /** Questions whose negative claim from before is gone now. */
  goneNegative: Num
  goneNegativeClaims: readonly ClaimItem[]
}

export interface WhatChangedView {
  cover: CoverView
  coverage: CoverageView
  lists: readonly MoveList[]
  drivers: DriversView
  pages: ChangedPagesView
  /** Null: no stored answer blocks to compare. */
  structure: StructureView | null
  /** Null: no claims read at either end. */
  sentiment: SentimentView | null
  /** Set when there is only one check: the report shows this panel alone. */
  waiting: WaitingView | null
}
