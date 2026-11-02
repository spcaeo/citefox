import type { TopicPromptKind, TopicStage } from '@shared/domain'

/**
 * One result language for every topic and question view (the approved "views" design):
 *
 * - `not_cited` an AI Overview showed and the own site is not in it (orange);
 * - `other_page` another own page is cited, not the target page (blue);
 * - `target` the target page is cited (green);
 * - `no_overview` Google showed no AI Overview (grey, nothing to do);
 * - `not_checked` no usable result yet: never checked in this market, or the search
 *   failed. Grey and only shown when there are some, so every total still adds up.
 */
export type SearchResult = 'not_cited' | 'other_page' | 'target' | 'no_overview' | 'not_checked'

/** Result order everywhere: bars, legends, tree branches, grid columns. */
export const SEARCH_RESULTS: readonly SearchResult[] = [
  'not_cited',
  'other_page',
  'target',
  'no_overview',
  'not_checked'
]

export type ResultCounts = Readonly<Record<SearchResult, number>>

/** One search (a buyer question or a keyword) with its latest result, in one market. */
export interface Search {
  /** The prompt id. */
  id: string
  /** "Q5" or "K1": the number in its kind's list. */
  ref: string
  number: number
  kind: TopicPromptKind
  text: string
  stage: TopicStage | null
  result: SearchResult
  /** Other sites Google cited (never the own site), best position first. */
  citedInstead: readonly string[]
  /** The own page Google cited (target or another own page). Null when none. */
  pageCited: string | null
  /** The page this search should be cited from. Null when it has none yet. */
  targetUrl: string | null
  /** 0 to 100, a ranking aid. Null when not scored (keywords, wins, no overview). */
  winOdds: number | null
  /** CiteFox AI's best page for this search, its fit % and why; absent until matched. */
  bestPage?: { url: string | null; fit: number | null; reason: string } | null
  /** The topic (or page) the search belongs to. */
  sourceId: string
  sourceName: string
  /** The page's full URL when the search belongs to a tracked page; absent for a topic. */
  sourceUrl?: string | null
  checkedAt: string | null
  /** While a check runs: this search is being checked now, or waits its turn. */
  live?: 'checking' | 'waiting' | null
  /** What a checking search still waits on: "Checking Google · ChatGPT…". */
  liveWords?: string
}

/** What every row of every view shows, and what its parent adds up from. */
export interface Totals {
  searches: number
  counts: ResultCounts
  /** Searches with an AI Overview (not cited + other page + target). */
  withAio: number
  /** target ÷ withAio, whole percent. Null without an overview. */
  targetPct: number | null
  /** Not cited + your other page. */
  needsWork: number
  /** Best win odds among the searches that need work. */
  winMax: number | null
  /** Average win odds of the searches that need work and have odds, rounded. */
  winAvg: number | null
}

/** The filters a drill (and a clicked count) applies. Every key is optional. */
export interface SearchFilter {
  /** A stage, or `none` for searches without one (keywords). */
  stage?: TopicStage | 'none'
  result?: SearchResult
  /** Needs work: Not cited or Your other page (the "Needs work" totals). URL `work=1`. */
  work?: true
  kind?: TopicPromptKind
  /** A keyword word group's label ("nagios sms", or "Other keywords"). */
  words?: string
  /** An own page cited, or the page still to win (a full URL). */
  page?: string
  /** A site cited instead (a domain). */
  site?: string
  /** A topic or page id (Questions screen). */
  source?: string
}

/** A tree row: a group with its totals, or one search. */
export interface TreeNode {
  /** Stable path id, such as `stage:problem/result:not_cited`; a search's is its prompt id. */
  id: string
  label: string
  /** 0 for top-level rows. */
  depth: number
  totals: Totals
  /** Groups only: what clicking its count opens. */
  filter: SearchFilter
  /** Groups only; empty for a search. */
  children: readonly TreeNode[]
  /** Set on a search row. */
  search?: Search
  /** A short muted line beside the label ("mostly /blog/nagios-setup/"). */
  note?: string
  /** The result a group is about, for its colour dot. */
  result?: SearchResult
}

/** One grid cell: a count and the drill it opens. */
export interface GridCell {
  result: SearchResult
  count: number
  filter: SearchFilter
}

export interface GridRow {
  id: string
  label: string
  /** "(no stage)" beside Keywords. */
  hint?: string
  totals: Totals
  cells: readonly GridCell[]
  filter: SearchFilter
}

export interface Grid {
  rows: readonly GridRow[]
  all: GridRow
  /** Result columns shown: the four, plus Not checked when any search has it. */
  results: readonly SearchResult[]
}
