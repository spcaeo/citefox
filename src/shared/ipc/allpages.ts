/**
 * All pages at scale (SRS section 4.20): the grid rows, the tiles, bulk actions
 * with their search cost, "Wrong page cited", and own pages cited but not tracked.
 */

import type {
  GridMembership,
  IntervalDays,
  Market,
  PageSetupStep,
  PageStatus,
  ProjectScoreSummary,
  SampleCount
} from '../domain'
import { isOneOf } from '../domain/one-of'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'
import type { FixIdRequest } from './fixes'

/** One row of the All pages grid. Every found page, tracked or not (FR-20.1). */
export interface AllPageRow {
  id: string
  url: string
  title: string | null
  label: string | null
  folder: string | null
  status: PageStatus
  setupStep: PageSetupStep | null
  pinned: boolean
  intervalDays: IntervalDays
  samples: SampleCount
  /** Enabled prompts in the active set. The planned count before a set is saved. */
  promptCount: number
  defaultMarketId: string | null
  marketIds: readonly string[]
  /** FR-20.7. Default market, the same number as `PageSummary.score`. */
  score: number | null
  /** Default market, current minus previous full check. Null without a previous check. */
  change: number | null
  /** Prompts citing this page in the latest full check, default market. Null before a check. */
  pageCited: number | null
  /** Prompts with an AI Overview in that check. `pageCited` is out of this. */
  aioPrompts: number | null
  /** Links to this page in that check's AI Overview references. Links, not prompts. */
  citations: number | null
  /** ISO-8601 UTC. */
  lastCheckedAt: string | null
  /** ISO-8601 UTC. Null when the page is not scheduled. */
  nextCheckAt: string | null
  /**
   * The check `pageCited`, `aioPrompts` and `citations` come from (default
   * market). Drill-downs load exactly this check so the drawer total equals
   * the cell (NFR-14). Null or absent before a check.
   */
  runId?: string | null
  /** Site-structure clusters (FR-19.5). Null when the project has no clusters yet. */
  clusters: readonly GridMembership[] | null
  /** User groups (FR-19.7). Null when the project has no groups yet. */
  groups: readonly GridMembership[] | null
  /** The published date the page states, from its latest read. Absent before a read. */
  publishedAt?: string | null
  /** The "Updated" date the page states, from its latest read. */
  modifiedAt?: string | null
  /** ISO-8601 UTC of the latest page read. */
  lastReadAt?: string | null
  /** Changes seen on the page that nobody logged as a fix or marked "Not a fix". */
  unloggedChanges?: number
}

/** `allpages:list`. The grid rows and the tiles (FR-20.2). */
export interface AllPagesData {
  projectId: string
  domain: string
  /** Every row, removed pages included. Equal to `rows.length`. */
  foundPageCount: number
  /** Rows whose status is `setting_up`, `tracked`, or `paused`, as on `ProjectDetail`. */
  trackedPageCount: number
  markets: readonly Market[]
  defaultMarketId: string | null
  summary: ProjectScoreSummary
  /**
   * Searches left this month: the project cap minus what it used, or what the
   * SerpApi keys report left, whichever is lower. Null when neither is known.
   */
  searchesLeft: number | null
  /**
   * Groups a page can be added to (FR-19.7). Null when Site structure has not
   * created groups for this project, and "Add to group" is not offered.
   */
  groups: readonly GridMembership[] | null
  rows: readonly AllPageRow[]
}

/** FR-20.5. Why a cited own page is probably not worth tracking. */
const NOISE_KINDS = ['login', 'account', 'legal', 'cart', 'search'] as const
export type CitationNoiseKind = (typeof NOISE_KINDS)[number]

export function isCitationNoiseKind(value: string): value is CitationNoiseKind {
  return isOneOf(NOISE_KINDS, value)
}

/**
 * FR-20.4. In the latest full check of a tracked page and market, the prompt's
 * AI Overview cites another own page and not the tracked one.
 */
export interface WrongPageCase {
  /** `pageId|marketId|promptId`. */
  id: string
  pageId: string
  pageUrl: string
  pageLabel: string
  marketId: string
  promptId: string
  promptLabel: string
  promptText: string
  citedUrl: string
  /** The project page at that URL, tracked or not. Null when it is not a project page. */
  citedPageId: string | null
  /** True when the cited page has a saved prompt set, so the prompt can move there. */
  citedPageReady: boolean
  /** Reference position of the cited own page. */
  position: number | null
  runId: string
  /** ISO-8601 UTC. */
  checkedAt: string | null
}

/** One citation behind an {@link UntrackedCitation} count: a tracked page's prompt whose overview cites the URL. */
export interface UntrackedCitationRef {
  /** The tracked page whose prompt it is. */
  pageId: string
  pageLabel: string
  marketId: string
  promptId: string
  promptLabel: string
  promptPosition: number
  /** Reference position of the URL in that overview. */
  position: number
  runId: string
}

/**
 * FR-20.5. An own-domain URL that AI Overviews cite for a tracked page's prompts,
 * next to the tracked page or instead of it, and that is not a tracked page.
 */
export interface UntrackedCitation {
  url: string
  normalizedUrl: string
  /** The project page at that URL (found in the sitemap, not tracked). Null when absent. */
  pageId: string | null
  /** Links in the latest check of each tracked page, all markets. Equal to `refs.length`. */
  citations: number
  /** Tracked pages whose prompts cite it. Distinct `refs[].pageId`. */
  citedFor: number
  /** The citations behind the counts, for the drill-down (NFR-14). */
  refs: readonly UntrackedCitationRef[]
  noise: CitationNoiseKind | null
  ignored: boolean
}

/** `allpages:citations`. Latest full check of every tracked page, all markets. */
export interface CitationReview {
  wrongPage: readonly WrongPageCase[]
  /** Distinct tracked pages in `wrongPage`. */
  wrongPagePages: number
  untracked: readonly UntrackedCitation[]
}

/**
 * Whose a cited page is, from the stored citation classes: this page or another
 * own page is `yours`, a saved competitor's site is `competitor`, else `other`.
 */
const CITED_WHOSE = ['yours', 'competitor', 'other'] as const
export type CitedWhose = (typeof CITED_WHOSE)[number]

export function isCitedWhose(value: string): value is CitedWhose {
  return isOneOf(CITED_WHOSE, value)
}

/**
 * One overview counted in a cited page's Overviews: one question's overview in one
 * market's latest check. Its question's text is on the row's `questions`.
 */
export interface CitedOverviewRef {
  /** `runId|promptId`. */
  id: string
  /** The {@link CitedQuestionRef} id (`pageId|promptId`). */
  questionId: string
  marketId: string
  runId: string
  /** The page's place in that overview's reference list. */
  position: number
}

/** A question whose latest overview cites the page, every market together. */
export interface CitedQuestionRef {
  /** `pageId|promptId`. */
  id: string
  pageId: string
  pageKind: 'page' | 'topic'
  pageLabel: string
  promptId: string
  promptLabel: string
  promptText: string
  /** The first market it was cited in, and its check: where the question link opens. */
  marketId: string
  runId: string
  marketIds: readonly string[]
  /** Best reference position across those markets. */
  position: number
}

/** One page AI Overviews cite in the latest checks, anyone's. */
export interface CitedPageRow {
  /** Opaque and stable for the same URL, for routes. Never the URL itself. */
  id: string
  url: string
  /** The project page's title for an own page, else the overview's reference title. */
  title: string | null
  /** The cited host without `www.`, such as `twilio.com`. */
  domain: string
  /** Opaque and stable for the same host, for routes. */
  domainId: string
  whose: CitedWhose
  /** The saved competitor's name. Null unless `whose` is `competitor`. */
  competitor: string | null
  /** Markets with an overview citing it. Distinct `overviews[].marketId`. */
  marketIds: readonly string[]
  /** Distinct questions citing it. `questions.length` is the Questions number. */
  questions: readonly CitedQuestionRef[]
  /** Every overview citing it, once each. `overviews.length` is the Overviews number. */
  overviews: readonly CitedOverviewRef[]
}

/** `allpages:citedPages`. Latest full check of every tracked page and topic, every market. */
export interface CitedPagesData {
  projectId: string
  ownDomain: string
  /** Page or topic × market checks the rows come from. */
  checks: number
  /** Questions with an AI Overview in those checks. */
  questions: number
  /** ISO-8601 UTC of the newest of those checks. Null before any check. */
  checkedAt: string | null
  rows: readonly CitedPageRow[]
}

/** FR-20.3. */
export const BULK_ACTIONS = [
  'track',
  'check',
  'add_market',
  'change_schedule',
  'pause',
  'resume',
  'stop',
  'pin',
  'add_to_group',
  'remove_from_group',
  'export'
] as const
export type BulkAction = (typeof BULK_ACTIONS)[number]

export function isBulkAction(value: string): value is BulkAction {
  return isOneOf(BULK_ACTIONS, value)
}

/**
 * `allpages:estimate` and `allpages:run`. `marketId` is for `add_market`,
 * `intervalDays` for `change_schedule`, `groupId` for `add_to_group` and
 * `remove_from_group`. Others are null.
 *
 * - `resume`: paused pages go back to tracked (adds their monthly searches).
 * - `stop`: tracked, setting-up and paused pages stop being tracked (status
 *   `removed`, as `pages:remove`). History stays; no more searches are used.
 * - `pin`: pins pages that are not pinned yet.
 * - `remove_from_group`: takes the pages out of the group; the pages stay.
 */
export interface BulkActionRequest {
  projectId: string
  pageIds: readonly string[]
  action: BulkAction
  marketId: string | null
  intervalDays: IntervalDays | null
  groupId: string | null
}

/** When the estimated searches are spent. */
export type BulkCostTiming = 'now' | 'first_checks' | 'per_month' | 'saved_per_month' | 'none'

export interface BulkSkip {
  reason: string
  count: number
}

/** FR-20.3. What an action will do and cost, before it runs. */
export interface BulkEstimate {
  action: BulkAction
  selected: number
  /** Pages the action changes. `selected` minus the skips. */
  eligible: number
  skipped: readonly BulkSkip[]
  minSearches: number
  maxSearches: number
  timing: BulkCostTiming
  searchesLeft: number | null
  /** One sentence with the cost, such as "Checking 12 pages now uses about 240–480 searches." */
  summary: string
}

export interface BulkActionResult {
  action: BulkAction
  changed: number
  skipped: number
  message: string
  /** The check job `check` started. Null for the other actions. */
  jobId: string | null
  /**
   * `stop`: each stopped page with its status before, so Undo can put it back
   * (`allpages:undoTrack` with `previousStatus`). Absent for the other actions.
   */
  previous?: readonly StoppedPage[]
}

/** One page `stop` changed, for Undo. */
export interface StoppedPage {
  pageId: string
  previousStatus: PageStatus
}

/** `allpages:pointHere`. FR-20.4: move the prompt to the cited page from the next check. */
export interface PointPromptRequest {
  projectId: string
  fromPageId: string
  promptId: string
  toPageId: string
}

export interface PointPromptUndo {
  fromPageId: string
  toPageId: string
  /** The sets that were active before. `allpages:undoPoint` makes them active again. */
  fromPromptSetId: string
  toPromptSetId: string
}

export type PointPromptResult =
  | { ok: true; message: string; undo: PointPromptUndo }
  | { ok: false; message: string; nextStep: string }

export interface UndoPointRequest extends PointPromptUndo {
  projectId: string
}

/** `allpages:merge`. FR-20.4: add a fix to combine the two pages and redirect one. */
export interface MergePagesRequest {
  projectId: string
  pageId: string
  marketId: string
  promptId: string
  citedUrl: string
}

export interface MergePagesResult {
  fixId: string
  fixNumber: number
  message: string
}

/** `allpages:trackUrl`. FR-20.5 Track. */
export interface TrackUrlRequest {
  projectId: string
  url: string
}

export interface TrackUrlResult {
  pageId: string
  message: string
  /** Null when the page was added by this call. Otherwise its status before. */
  previousStatus: PageStatus | null
}

export interface UndoTrackRequest {
  projectId: string
  pageId: string
  previousStatus: PageStatus | null
}

/** `allpages:ignoreUrl`. FR-20.5 Ignore. `ignored: false` is Undo. */
export interface IgnoreUrlRequest {
  projectId: string
  url: string
  ignored: boolean
}

export interface IgnoreUrlResult {
  normalizedUrl: string
  ignored: boolean
}

/** Invoke channels for this area. Each one is declared here only. */
export const allPagesChannels = {
  'allpages:list': invokeWith<ProjectIdRequest, AllPagesData>(),
  'allpages:citations': invokeWith<ProjectIdRequest, CitationReview>(),
  'allpages:citedPages': invokeWith<ProjectIdRequest, CitedPagesData>(),
  'allpages:estimate': invokeWith<BulkActionRequest, BulkEstimate>(),
  'allpages:run': invokeWith<BulkActionRequest, BulkActionResult>(),
  'allpages:pointHere': invokeWith<PointPromptRequest, PointPromptResult>(),
  'allpages:undoPoint': invokeWith<UndoPointRequest, PointPromptUndo>(),
  'allpages:merge': invokeWith<MergePagesRequest, MergePagesResult>(),
  'allpages:undoMerge': invokeWith<FixIdRequest, { fixId: string }>(),
  'allpages:trackUrl': invokeWith<TrackUrlRequest, TrackUrlResult>(),
  'allpages:undoTrack': invokeWith<UndoTrackRequest, { pageId: string }>(),
  'allpages:ignoreUrl': invokeWith<IgnoreUrlRequest, IgnoreUrlResult>()
} as const satisfies InvokeChannelSpecs
