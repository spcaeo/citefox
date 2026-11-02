/**
 * The AI visibility home (Overview): one call that reads the project's stored
 * checks across every tracked page and topic. Counts are questions (prompts),
 * except share of citations, which counts links. Nothing here is estimated.
 */

import type { Market } from '../domain'
import { isOneOf } from '../domain/one-of'
import type { ChangeCounts, CitationChange } from '../report/diff'
import type { Agreement } from '../report/method'
import type { VerdictSet } from '../report/verdict'
import type { CompetitorLink } from './competitors'
import type { LiveCheck } from './live-results'
import { invokeWith, type InvokeChannelSpecs } from './contract'

const OVERVIEW_PERIODS = ['7d', '30d', '90d'] as const

/** The period the deltas and the weekly series cover. */
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number]

export const OVERVIEW_PERIOD_DAYS: Readonly<Record<OverviewPeriod, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90
}

export const DEFAULT_OVERVIEW_PERIOD: OverviewPeriod = '30d'

export function isOverviewPeriod(value: unknown): value is OverviewPeriod {
  return typeof value === 'string' && isOneOf(OVERVIEW_PERIODS, value)
}

/** `YYYY-MM-DD`: a `vs` that compares with the state at the end of that day (UTC). */
export const OVERVIEW_VS_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `visibility:overview`. `marketId` absent: each page and topic in its default market.
 * `vs` (the "Compare with" control, `?vs=` in the route): absent or null compares each
 * page and topic with its own previous check; a run id compares with the state when
 * that check finished; a `YYYY-MM-DD` day with the state at the end of that day (UTC).
 */
export interface VisibilityOverviewRequest {
  projectId: string
  period: OverviewPeriod
  marketId?: string | null
  vs?: string | null
}

/** One headline number and its change since the compared check. */
export interface OverviewKpi {
  value: number
  /** The value at the compared check. Null when nothing had been checked by then. */
  before: number | null
  /** `value` minus `before`. Null without `before`. */
  delta: number | null
}

/**
 * Share of citations as a whole percent, in the scope Competitors uses: the latest full
 * check of each page and topic in each market (one market when picked). Null when the
 * overviews cite nothing.
 */
export interface OverviewShareKpi {
  value: number | null
  /** The share at the compared check. Null without one, or when it cited nothing. */
  before: number | null
  /** Percentage points since the compared check. Null without history or a value. */
  delta: number | null
  /** Own links and all links behind `value`. */
  ownCitations: number
  allCitations: number
  /** Questions with an AI Overview those links come from (the scope line under the share). */
  questions: number
}

/**
 * One link behind the share (`shareLinks`): every link of every overview in the share's
 * scope, once per question, so the list length is `allCitations` and its own links are
 * `ownCitations`.
 */
export interface OverviewShareLink extends CompetitorLink {
  /** The link's host, for its icon. */
  host: string
  /** A link to the project's own site. */
  own: boolean
}

export interface OverviewKpis {
  /** Enabled prompts in the active sets of tracked pages and topics. No history: no delta. */
  tracked: OverviewKpi
  /** How many of `tracked` are topic keywords (short searches); the rest are questions. */
  keywords: number
  /** Questions whose latest check showed an AI Overview. */
  withAio: OverviewKpi
  /** Questions whose overview cites the own domain (any own page). */
  cited: OverviewKpi
  /** Questions whose overview text names the brand. */
  named: OverviewKpi
  share: OverviewShareKpi
}

/** One week of the chart: the state at the end of that week. */
export interface OverviewWeek {
  /** ISO-8601 UTC end of the week (the last bar ends now). */
  endsAt: string
  /** Null when no question had been checked by then. */
  cited: number | null
  withAio: number | null
  /**
   * The questions behind `withAio` (an AI Overview showed), with whether each cited
   * you, so a week's point opens exactly its rows. Unset before any check.
   */
  searches?: readonly OverviewWeekSearch[]
}

/** One question with an AI Overview at the end of a week, from the check that counted. */
export interface OverviewWeekSearch {
  /** `OverviewQuestion.key`. */
  key: string
  pageId: string
  promptId: string
  marketId: string
  runId: string
  text: string
  cited: boolean
}

/** The question's latest result for the own site. */
export type OverviewYouStatus = 'cited' | 'named' | 'not_cited' | 'no_aio' | 'error'

/**
 * Which own page a cited overview links: the question's target page, or another
 * page of the site. Null when the site is not cited.
 */
export type OverviewOwnPage = 'target' | 'other'

/** Where a question comes from: a tracked page, or a topic. */
export type OverviewSource =
  { kind: 'page'; url: string; path: string } | { kind: 'topic'; name: string }

/** A question's result in the compared (earlier) check. */
export interface OverviewQuestionBefore {
  you: OverviewYouStatus
  ownPage: OverviewOwnPage | null
  position: number | null
  /** ISO-8601 UTC finish of that check. */
  checkedAt: string
}

/**
 * One tracked question in its latest check, and how its citation moved since the
 * compared check (`change`, null when it has no comparable earlier result).
 */
export interface OverviewQuestion {
  /** Opaque and stable for the question within the project; the drill and verdict sets use it. */
  key: string
  /** Page or topic id, prompt id, market and check: the prompt detail route. */
  pageId: string
  promptId: string
  marketId: string
  runId: string
  text: string
  source: OverviewSource
  you: OverviewYouStatus
  /** The target page or another own page, when cited. */
  ownPage: OverviewOwnPage | null
  /** Best own reference position when cited. */
  position: number | null
  /** The own URL cited at that position, when cited. */
  citedUrl: string | null
  /** Up to 3 sites cited ahead of you: competitor names, else domains. */
  citedInstead: readonly string[]
  change: CitationChange | null
  before: OverviewQuestionBefore | null
  /** ISO-8601 UTC of the latest check. */
  checkedAt: string | null
}

/** One question behind "Questions tracked": an enabled prompt of a tracked page or topic. */
export interface OverviewTrackedQuestion {
  /** `pageId|promptId`. */
  key: string
  pageId: string
  promptId: string
  /** Such as "Q4". */
  label: string
  text: string
  source: OverviewSource
  /** A topic keyword (a short search) rather than a question. */
  keyword: boolean
}

/** One earlier check the "Compare with" control offers: the last check finished that day. */
export interface OverviewCompareOption {
  /** A run id, for `vs`. */
  value: string
  /** ISO-8601 UTC finish of that check. */
  at: string
}

export interface OverviewCompare {
  /** Echoes the request; null is each page's and topic's previous check. */
  vs: string | null
  /** `previous`, a `run`, or a `day`. `previous` when `vs` was not found (`unknown`). */
  mode: 'previous' | 'run' | 'day'
  /** The moment compared with. Null for `previous` (each source has its own). */
  at: string | null
  /** True when `vs` named a check or day that is not in this project: previous is used. */
  unknown: boolean
  /** False when no question has a comparable earlier result. */
  available: boolean
  /** Earlier checks to pick from, newest first. */
  options: readonly OverviewCompareOption[]
}

/** "How we measure": what was searched, and when. */
export interface OverviewMethod {
  /** Markets the latest checks searched. */
  marketIds: readonly string[]
  /** ISO-8601 UTC of the oldest and newest finished check read. */
  firstCheckAt: string | null
  lastCheckAt: string | null
  /** Page prompts and topic questions with the same wording in the same market; null when none. */
  agreement: Agreement | null
}

/** One row of "Who gets cited". `count` is questions whose overview cites it. */
export interface OverviewCitedSite {
  name: string
  /** Null for the project row when its domain is unknown. */
  domain: string | null
  count: number
  /** The project itself. */
  own: boolean
  /** A competitor of the page's or topic's product (`competitorContext`). */
  competitor: boolean
  /** Questions citing it at the compared check. Null without one. */
  before: number | null
  /** The question keys behind `count` (`OverviewQuestion.key`), so the count drills. */
  keys: readonly string[]
}

export interface OverviewFix {
  fixId: string
  pageId: string
  number: number
  /** The first line of the fix description, plain text. */
  title: string
  source: OverviewSource
  /** Targeted questions. */
  questions: number
  /** ISO-8601 UTC go-live. */
  goLiveAt: string
}

/** The first check started from the first-run setup ("Your site" plan). */
export interface OverviewFirstReport {
  /** ISO-8601 UTC: the earliest finished check of the drafted topic, else when it started. */
  checkedAt: string
  topicId: string | null
  topics: number
  /** Questions that first check searched. */
  questions: number
  /** Pages the plan suggested to track, and how many of them are not tracked yet. */
  suggestedPages: number
  untrackedSuggested: number
}

export interface VisibilityOverview {
  projectId: string
  domain: string
  /** The first brand name, or the domain. Highlighted with the mark colour. */
  brand: string
  period: OverviewPeriod
  /** Echoes the request: null reads each page's default market. */
  marketId: string | null
  /** ISO-8601 UTC. */
  builtAt: string
  periodStart: string
  /** Tracked pages and topics with at least one enabled prompt. */
  trackedPages: number
  trackedTopics: number
  /** True when any tracked page or topic has a check with results (finished or under way). */
  hasChecks: boolean
  /**
   * A check running now across the tracked pages and topics (questions done so far
   * of all), or the latest one that stopped part-way. While one runs the numbers
   * include its answers so far and every "since" change waits for its end.
   */
  live?: LiveCheck | null
  /** ISO-8601 UTC of the newest check read. */
  lastCheckedAt: string | null
  /** What Check now spends across every tracked page and market. */
  checkSearches: { min: number; max: number }
  kpis: OverviewKpis
  weeks: readonly OverviewWeek[]
  /** Every tracked question in its latest check: gained and lost first, then by question. */
  questions: readonly OverviewQuestion[]
  /** The rows behind `kpis.tracked` (checked or not), page order. */
  tracked: readonly OverviewTrackedQuestion[]
  compare: OverviewCompare
  /** Gained, kept, lost and never-cited questions since the compared check. Null without one. */
  diff: ChangeCounts | null
  /** Question keys behind each verdict number (`buildVerdict`), so each number drills. */
  verdictSets: Readonly<Record<VerdictSet, readonly string[]>>
  /** The most cited other site now, for the verdict; its questions are `verdictSets.top_site`. */
  topSite: { name: string; count: number } | null
  method: OverviewMethod
  /** Every market in the project, for the market picker. */
  markets: readonly Market[]
  /** Top 5 cited sites plus the project, most cited first. */
  citedSites: readonly OverviewCitedSite[]
  /** The links behind the citation share, own links first (`kpis.share`). */
  shareLinks: readonly OverviewShareLink[]
  /** Up to 3 open fixes (follow-up not run yet), soonest go-live first. */
  fixes: readonly OverviewFix[]
  openFixes: number
  firstReport: OverviewFirstReport | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const visibilityChannels = {
  'visibility:overview': invokeWith<VisibilityOverviewRequest, VisibilityOverview>()
} as const satisfies InvokeChannelSpecs
