/** Results screens: funnel, opportunities, leaderboard, trends, and scores. */

import type {
  CheckComparisonColumn,
  MarketCheckMetrics,
  PromptCheckRow,
  PromptCheckStatus,
  SampleCapture
} from './checks'
import type { BrandLens } from '../brand-mentions'
import type { CompetitorTier } from '../competitor-hosts'
import type { StoredOverviewRead } from '../overview-read'
import { isOneOf } from './one-of'
import type { IntentStage } from './prompts'
import type { IntervalDays } from './settings'

/** FR-12.6. The four buckets do not overlap. Each AIO sits in exactly one. */
/**
 * The report's opportunity bars (src/shared/report-copy.ts `opportunityBucketOf`):
 * already winning (cited and named), cited only, named only, not visible.
 */
const OPPORTUNITY_BUCKETS = ['winning', 'cited_only', 'named_not_linked', 'invisible'] as const

export type OpportunityBucketId = (typeof OPPORTUNITY_BUCKETS)[number]

/** FR-12.5. Each step is a subset of the one above. Counts are prompts. */
const FUNNEL_STEPS = ['checked', 'aio_shown', 'own_domain', 'this_page', 'cited_and_named'] as const

export type FunnelStepId = (typeof FUNNEL_STEPS)[number]

/** FR-12.9. Where a top action opens. */
const TOP_ACTION_SCREENS = ['gaps', 'communities', 'page_read'] as const

export type TopActionScreen = (typeof TOP_ACTION_SCREENS)[number]

/** FR-12.8 badge. `you` is the project's own domain. */
const LEADERBOARD_BADGES = ['you', 'tracked', 'observed'] as const

export type LeaderboardBadge = (typeof LEADERBOARD_BADGES)[number]

/** Prompts that drop between two funnel steps (FR-12.5). */
export interface FunnelDrop {
  count: number
  /** Why these prompts are not in the next step. */
  reason: string
  promptIds: readonly string[]
}

/** One funnel step. `promptIds.length` is `count` (NFR-14). */
export interface FunnelStep {
  id: FunnelStepId
  count: number
  promptIds: readonly string[]
  /** Null on `checked`. */
  drop: FunnelDrop | null
}

/** One opportunity bucket. `promptIds.length` is `count`. */
export interface OpportunityBucket {
  id: OpportunityBucketId
  count: number
  promptIds: readonly string[]
}

/**
 * FR-12.6 overlay. These prompts also sit in a bucket.
 * Reddit or YouTube is cited above any own-domain link, or no own-domain link exists.
 */
export interface UgcOverlay {
  count: number
  promptIds: readonly string[]
}

/** FR-12.8. Counts are AIOs (prompts), not links. */
export interface CompetitorLeaderboardRow {
  domain: string
  badge: LeaderboardBadge
  aioCount: number
  /** AIOs that also cite the own domain. Null for the `you` row. */
  overlap: number | null
  /** AIOs that cite this domain and do not cite the own domain. Null for the `you` row. */
  gap: number | null
  averagePosition: number
  promptIds: readonly string[]
  /** Empty for the `you` row. */
  gapPromptIds: readonly string[]
}

/** One prompt that cites a cannibalizing URL (FR-12.13). */
export interface CannibalizingHit {
  promptId: string
  position: number
}

/** An own-domain URL cited instead of the target page. */
export interface CannibalizingPage {
  url: string
  normalizedUrl: string
  /** False when the URL is not a tracked page (FR-20.5). */
  tracked: boolean
  pageId: string | null
  prompts: readonly CannibalizingHit[]
}

/** FR-12.11. The renderer names best and weakest only where `prompts` is 2 or more. */
export interface StageRate {
  stage: IntentStage
  prompts: number
  pageCited: number
}

/** FR-12.9. Read-only. Planning the fix is not a channel in this contract. */
export interface TopAction {
  rank: number
  /** The action title, such as "Add the txt.att.net migration step". */
  text: string
  /** The muted reason under the title. Why this action is on the list. */
  reason: string
  /**
   * Link wording, such as "Open the gap for prompt 4".
   * `screen` is where that link opens.
   */
  linkLabel: string
  screen: TopActionScreen
  promptId: string | null
}

/** FR-12.1. Times are ISO-8601 UTC. The renderer formats them in local time. */
export interface ResultsScope {
  promptCount: number
  marketCount: number
  brands: readonly string[]
  pageUrl: string
  pageTitle: string | null
  checkedAt: string | null
  /** When this payload was built. */
  builtAt: string
  promptSetVersion: number | null
  /**
   * ISO-8601 UTC of when that prompt set was saved (FR-12.1).
   * The renderer prints "v2 · saved Sep 20, 2026".
   * Same moment as `PromptSetView.savedAt` and `PromptSetRef.createdAt`.
   * Null when `promptSetVersion` is null.
   */
  promptSetSavedAt: string | null
  /** True when `checkedAt` is more than {@link STALE_CHECK_DAYS} days before `builtAt` (FR-12.2). */
  stale: boolean
  /** Number the next logged fix on this page gets (FR-14.5). 1 when none is logged yet. */
  nextFixNumber: number
}

/** `run_summary.md` (FR-12.3). States both facts and does not claim cause. Null until it has run. */
export interface RunSummaryText {
  headline: string
  body: string
}

/**
 * The Results screen for one page and one market (FR-12, section 7).
 * Prompt id lists are the drill drawer (FR-12.7). Their lengths match the counts (NFR-14).
 */
export interface PageResults {
  scope: ResultsScope
  /** Null when the page has no run in this market yet. */
  run: MarketCheckMetrics | null
  /** Section 7.3 and FR-12.4. Nulls when that check does not exist. */
  scoreChange: {
    sincePrevious: number | null
    sinceBaseline: number | null
  }
  comparison: readonly [CheckComparisonColumn, CheckComparisonColumn, CheckComparisonColumn]
  runSummary: RunSummaryText | null
  funnel: readonly FunnelStep[]
  buckets: readonly OpportunityBucket[]
  ugcOverlay: UgcOverlay
  prompts: readonly PromptCheckRow[]
  leaderboard: readonly CompetitorLeaderboardRow[]
  cannibalizing: readonly CannibalizingPage[]
  stageRates: readonly StageRate[]
  topActions: readonly TopAction[]
}

/** One point on the time-true rate chart (FR-14.3, section 7.4). */
export interface TrendPoint {
  runId: string
  /** ISO-8601 UTC. The chart spaces points by this instant (NFR-15). */
  finishedAt: string
  /** Null when that check has no stored prompt-set version. */
  promptSetVersion: number | null
  /** Partial checks are marked and left out of the trend line. */
  partial: boolean
  /** Page cited ÷ AIOs shown. Null when no prompt had an AIO. */
  pageCitedRate: number | null
  promptsChecked: number
  /** Enabled prompts in the set. Coverage is promptsChecked ÷ promptsTotal. */
  promptsTotal: number
  visibilityScore: number | null
  contentChanged: boolean
}

/** `results:history`. Newest last. Includes partial checks, flagged. */
export interface ResultsHistory {
  pageId: string
  marketId: string
  /** Version of the latest point. Null when there are no points. */
  promptSetVersion: number | null
  points: readonly TrendPoint[]
}

/** FR-13.3. One market's wording and latest status for the same prompt. */
export interface PromptMarketSnapshot {
  marketId: string
  text: string
  status: PromptCheckStatus | null
  position: number | null
  runId: string | null
}

/** FR-6.6. One fact the overview states that the page does not. */
export interface AioGapFact {
  fact: string
  likelySource: string | null
}

/**
 * Prompt detail (FR-13).
 * `samples` includes the redacted raw JSON (FR-5.3, FR-13.5).
 * `searchesUsed` is the sum of `samples[].searches`.
 */
export interface PromptCheckDetail {
  pageId: string
  marketId: string
  runId: string | null
  row: PromptCheckRow | null
  samples: readonly SampleCapture[]
  searchesUsed: number
  otherMarkets: readonly PromptMarketSnapshot[]
  /** Null when `aio_gap.md` has not run for this prompt. */
  aioGap: readonly AioGapFact[] | null
  /** Where the page covers this prompt, from the latest gap row. Empty when there is no row. */
  whereCovered: readonly string[]
  /** What the overview is read against: the brand, the own site, and this page's competitors. */
  lens: OverviewLens
  /** Saved "Analyse with Claude" reads of these samples, one per sample at most. */
  overviewReads: readonly StoredOverviewRead[]
  /** Google's own results for this prompt, from the searches already stored. */
  google: PromptGoogleSearch
}

/**
 * What the stored Google search says besides the AI Overview (no extra searches):
 * where the own site ranks in Google's results and Google's "People also ask".
 */
export interface PromptGoogleSearch {
  /**
   * The own site's best place in Google's top 10 in this market's check. Null when it
   * is not there, or when no stored search held Google's results (`hasResults`).
   */
  ownRank: PromptOwnRank | null
  /** False when no sample of this check kept Google's organic results (a failed search). */
  hasResults: boolean
  /**
   * "People also ask" on this prompt's searches, every market of the page, repeats
   * and questions already tracked left out. At most six, the most asked first.
   */
  questions: readonly GoogleQuestion[]
}

export interface GoogleQuestion {
  text: string
  /**
   * True when the wording passes this page's or topic's question checks as it is (a
   * buyer prompt needs 8 to 32 words and no brand), so + Track can add it at once.
   */
  trackable: boolean
}

export interface PromptOwnRank {
  /** 1-based place among Google's organic results. */
  position: number
  url: string
  /** True when the result is this page; false for another page on the own site. */
  thisPage: boolean
}

/**
 * The prompt page's brand marks and "What this overview says about you" card read
 * the overview against this: the project profile's brand names and aliases, its own
 * domain and subdomains rule, and the competitors of the page's product, from
 * `competitorContext()` (the project-wide list when the product has none).
 */
export interface OverviewLens extends BrandLens {
  /** The product the page is about. Null treats the business as a whole. */
  productName: string | null
  competitors: readonly OverviewLensCompetitor[]
}

export interface OverviewLensCompetitor {
  name: string
  domain: string | null
  tier: CompetitorTier
}

/**
 * FR-10.5 and FR-20.2. The numbers the Projects and All pages tiles still show as unavailable.
 * `change` is the current default-market score minus the previous check, not a calendar month.
 * Pages with no score are left out of `averageScore`.
 */
export interface ProjectScoreSummary {
  projectId: string
  /** Nearest integer. Null when no tracked page has a default-market score. */
  averageScore: number | null
  /** Mean of per-page score changes, nearest integer. Null when none of those pages have a previous check. */
  change: number | null
  /**
   * ISO-8601 UTC. Stays set while the project is paused: the next check after resume (SCH-9).
   * Null when no page is scheduled, or the project is archived. The UI reads `paused` and shows "Paused".
   */
  nextCheckAt: string | null
  /** SerpApi searches this project has used this month (section 10 `key_usage`). */
  searchesUsed: number
  /** Project monthly cap. Null means no cap (FR-11.4). */
  searchCap: number | null
  /** Stays 0 while the project is paused. */
  pagesDueToday: number
}

/** FR-20.7. Score is the page's default market. */
export interface PageScoreSummary {
  pageId: string
  /** Same number as `PageSummary.score` once a check exists. Null before that. */
  score: number | null
  /** Current minus previous, in that default market. Null when there is no previous check. */
  change: number | null
  /**
   * ISO-8601 UTC. Null when the page is not scheduled.
   * A paused project does not clear this.
   */
  nextCheckAt: string | null
  lastCheckedAt: string | null
  intervalDays: IntervalDays
}

export interface ProjectScoreList {
  projects: readonly ProjectScoreSummary[]
  /** Sum of `searchesUsed` across the projects in `projects`. */
  searchesUsed: number
  /**
   * Soonest `nextCheckAt`, including paused projects.
   * Null when every project has none (no pages to schedule, or archived).
   */
  nextCheckAt: string | null
}

export interface PageScoreList {
  projectId: string
  summary: ProjectScoreSummary
  pages: readonly PageScoreSummary[]
}

export function isOpportunityBucketId(value: string): value is OpportunityBucketId {
  return isOneOf(OPPORTUNITY_BUCKETS, value)
}

export function isFunnelStepId(value: string): value is FunnelStepId {
  return isOneOf(FUNNEL_STEPS, value)
}

export function isTopActionScreen(value: string): value is TopActionScreen {
  return isOneOf(TOP_ACTION_SCREENS, value)
}

export function isLeaderboardBadge(value: string): value is LeaderboardBadge {
  return isOneOf(LEADERBOARD_BADGES, value)
}
