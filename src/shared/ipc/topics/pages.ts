import type {
  CompetitorClaim,
  CompetitorPageRead,
  IntervalDays,
  TopicDraft,
  TopicStage
} from '../../domain'
import type { TopicCallInfo } from './types'

// ---------------------------------------------------------------------------
// Competitor page
// ---------------------------------------------------------------------------

export interface ReadCompetitorPageRequest {
  projectId: string
  draftId: string
  url: string
}

export interface ReadCompetitorPageResult {
  draft: TopicDraft
  page: CompetitorPageRead
}

export interface CompetitorQuestionsRequest {
  projectId: string
  draftId: string
  marketId: string | null
}

export interface CompetitorQuestionsResult {
  draft: TopicDraft
  claims: readonly CompetitorClaim[]
  droppedForBrand: number
  info: TopicCallInfo
}

// ---------------------------------------------------------------------------
// Pages step
// ---------------------------------------------------------------------------

/** One page a prompt can target: a tracked page or a sitemap entry. */
export interface TopicPageCandidate {
  /** Tracked page id; null for a sitemap entry that is not tracked. */
  pageId: string | null
  url: string
  title: string | null
  source: 'tracked' | 'sitemap'
  /** H2/H3 outline where a snapshot exists. */
  outline: readonly string[]
}

export interface TopicPageCandidates {
  candidates: readonly TopicPageCandidate[]
  /** ISO-8601 UTC of the latest sitemap read; null when none. */
  sitemapReadAt: string | null
}

/** `topics:matchTracked`: CiteFox AI picks each tracked question's best page, with a fit %. */
export interface MatchTrackedTopicRequest {
  projectId: string
  topicId: string
  marketId?: string | null
}

export interface MatchTrackedTopicResult {
  /** Questions that got a page. */
  matched: number
  /** Questions no page on the site fits. */
  noPage: number
  /** Questions whose page you picked, left as they were. */
  kept: number
}

export interface MatchTopicPagesRequest {
  projectId: string
  draftId: string
  /** Null matches every prompt not confirmed by the user. */
  promptIds?: readonly string[] | null
}

export interface MatchTopicPagesResult {
  draft: TopicDraft
  matched: number
  noPage: number
  info: TopicCallInfo
}

/** Target for one or more prompts. `url` null with `pageId` null means "No page yet". */
export interface TopicTarget {
  pageId: string | null
  url: string | null
}

/**
 * Change or confirm a target. With `draftId` it edits the wizard draft; with
 * `topicId` it edits a started topic (`topic_prompts`, kept across prompt-set
 * versions). `target` omitted confirms the current target.
 */
export interface SetTopicTargetRequest {
  projectId: string
  draftId?: string | null
  topicId?: string | null
  promptIds: readonly string[]
  target?: TopicTarget
  /**
   * Other own pages that may answer these questions besides the target (a started
   * topic only). Google citing any of them counts as the right page. Left out: kept.
   */
  alsoUrls?: readonly string[]
}

export interface SetTopicTargetResult {
  draft: TopicDraft | null
  /** Updated rows for a started topic. */
  rows: readonly { promptId: string; targetPageId: string | null; targetUrl: string | null }[]
}

export interface DraftPageBriefRequest {
  projectId: string
  draftId?: string | null
  topicId?: string | null
  promptId: string
  marketId?: string | null
}

export interface TopicPageBrief {
  promptId: string
  /** "Answer first: two sentences in the buyer's words, then …". */
  summary: string
  outline: readonly string[]
  /** Domains Google cites now (from saved checks; empty before a check). */
  citedNow: readonly string[]
  /** The whole brief as text, for Copy brief. */
  text: string
  /** External writing tool link. Opens the browser; CiteFox sends it nothing. */
  writeWithUrl: string
  info: TopicCallInfo
}

// ---------------------------------------------------------------------------
// Estimate and start
// ---------------------------------------------------------------------------

export const TOPIC_START_PLANS = ['likeliest', 'stage_first', 'stagger', 'all_now'] as const
export type TopicStartPlan = (typeof TOPIC_START_PLANS)[number]

export interface TopicEstimateRequest {
  projectId: string
  draftId: string
  /** Which prompts the first check covers. Default: what the draft generates. */
  scope?: 'questions' | 'keywords' | 'both'
}

export interface TopicPlanOption {
  plan: TopicStartPlan
  label: string
  detail: string
  /** Prompts checked today, and the searches they need. */
  todayPrompts: number
  todaySearchesLo: number
  todaySearchesHi: number
  /** Days the rest is spread over (0 when everything runs today). */
  restDays: number
  fit: 'fits' | 'may_not_fit' | 'over_budget' | 'unknown'
  /** True for the plan CiteFox suggests. */
  suggested: boolean
  /** For `stage_first`: the stage (or keyword group) checked first. */
  firstStage: TopicStage | null
  firstGroup: string | null
}

export interface TopicEstimate {
  draftId: string
  scope: 'questions' | 'keywords' | 'both'
  questions: number
  keywords: number
  stages: number
  groups: number
  markets: number
  prompts: number
  searchesLo: number
  searchesHi: number
  /** Searches left this month across keys and the project cap; null when unknown. */
  searchesLeft: number | null
  /** ISO date the SerpApi allowance renews (first of next month). */
  renewsOn: string
  plans: readonly TopicPlanOption[]
  /** Per re-check interval: searches a month. */
  recheck: readonly { intervalDays: IntervalDays; monthlyLo: number; monthlyHi: number }[]
  targets: { set: number; noPage: number }
  /** "Anything that doesn't fit waits for Nov 1. Nothing is lost." */
  note: string | null
}

export interface StartTopicRequest {
  projectId: string
  draftId: string
  plan: TopicStartPlan
  scope?: 'questions' | 'keywords' | 'both'
  /** For `stage_first`. */
  stage?: TopicStage | null
  group?: string | null
  intervalDays?: IntervalDays
}

export interface StartTopicResult {
  topicId: string
  promptSetId: string
  /** The check job started now; null when nothing could start (message says why). */
  jobId: string | null
  /** Batches planned for later days. */
  batches: readonly { batchNo: number; dueAt: string; prompts: number }[]
  message: string
  nextStep: string | null
}
