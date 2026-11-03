/** Check runs, check jobs, and one prompt check in one market. */

import type { CoverageLevel } from './coverage'
import { isOneOf } from './one-of'
import type { IntentStage, PromptSource } from './prompts'

/**
 * Section 7.1. Points are {@link VISIBILITY_POINT_PAGE_CITED} and the constants below.
 * `no_aio` and `error` are excluded from the visibility score.
 * `error` is a failed capture after retries, never a stand-in for "no AIO" (FR-5.5).
 */
const PROMPT_CHECK_STATUSES = [
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited',
  'no_aio',
  'error'
] as const

export type PromptCheckStatus = (typeof PROMPT_CHECK_STATUSES)[number]

/** Section 7.3. Compared with the previous check in the same prompt-set version and market. */
const PROMPT_MOVEMENTS = ['gained', 'lost', 'improved', 'declined', 'unchanged'] as const

export type PromptMovement = (typeof PROMPT_MOVEMENTS)[number]

/**
 * Section 10 `aio_references.classification` (FR-6.5).
 * `target` is this page. `own` is another page on the own domain.
 * `competitor` is a tracked competitor domain. `other` is everyone else.
 */
const CITATION_CLASSES = ['target', 'own', 'competitor', 'other'] as const

export type CitationClass = (typeof CITATION_CLASSES)[number]

/** Section 10 `aio_references.source_type` (FR-17.1). Stored with the reference. Communities is M6. */
const CITATION_SOURCE_TYPES = [
  'web',
  'reddit',
  'youtube',
  'linkedin',
  'review',
  'forum',
  'other'
] as const

export type CitationSourceType = (typeof CITATION_SOURCE_TYPES)[number]

/**
 * Section 10 `runs.kind`. The hyphen in "follow-up" is an underscore here.
 * The engine sets `baseline` from the baseline rule (section 8). The renderer does not send it.
 */
const CHECK_RUN_KINDS = ['baseline', 'scheduled', 'manual', 'follow_up'] as const

export type CheckRunKind = (typeof CHECK_RUN_KINDS)[number]

/**
 * Section 10 `runs.status` has no value list. These four are the contract.
 * `running` is an in-progress check. `partial` on the run is a separate flag (FR-14.6).
 */
const CHECK_RUN_STATUSES = ['running', 'finished', 'cancelled', 'error'] as const

export type CheckRunStatus = (typeof CHECK_RUN_STATUSES)[number]

/** One user action that owns one or more section 10 runs (one run per page × market). */
const CHECK_JOB_STATUSES = ['running', 'finished', 'cancelled', 'error'] as const

export type CheckJobStatus = (typeof CHECK_JOB_STATUSES)[number]

/**
 * FR-5.6 columns, plus the re-read that section 3 and SCH-4 put first.
 * `search` is the Google search. `aio` is the AI Overview step. `analysis` is Claude.
 */
const CHECK_PHASES = ['reread', 'search', 'aio', 'analysis'] as const

export type CheckPhase = (typeof CHECK_PHASES)[number]

/** One cell on the Checking screen. `waiting` is only on the job snapshot, not a progress push. */
const CHECK_STEP_STATES = ['waiting', 'running', 'ok', 'warning', 'error'] as const

export type CheckStepState = (typeof CHECK_STEP_STATES)[number]

/**
 * Why a capture was stored as `error` (FR-5.5, NFR-2, SERP-3).
 * `empty` is an empty body after retries. It is not `no_aio`.
 * `token_expired` is a follow-up token that still failed after the one fresh search (SERP-3).
 */
export const CHECK_ERROR_CODES = [
  'timeout',
  'rate_limited',
  'out_of_searches',
  'rejected',
  'token_expired',
  'empty',
  'other'
] as const

export type CheckErrorCode = (typeof CHECK_ERROR_CODES)[number]

/**
 * Shown while a rate-limited search service has the check running slower. No provider
 * name: the plan allows only a few searches at a time, and the check keeps going.
 */
export const CHECK_SLOWED_NOTICE =
  'Going slower: your CiteFox credits plan allows only a few searches at a time. CiteFox keeps going, nothing is lost.'

/** Section 7.1. Page cited is 3. Other own page and brand mentioned are 1. Not cited is 0. */
export const VISIBILITY_POINT_PAGE_CITED = 3

export const VISIBILITY_POINT_OTHER_OWN = 1

export const VISIBILITY_POINT_BRAND_MENTIONED = 1

export const VISIBILITY_POINT_NOT_CITED = 0

/** FR-12.2. A check older than this many days is stale. The UI still shows local time (NFR-15). */
export const STALE_CHECK_DAYS = 7

/** FR-7.3. Counts against the previous snapshot. `wordsAdded` is signed. */
export interface ContentChange {
  /** One sentence for History, such as "2 FAQs added". */
  summary: string
  faqsAdded: number
  wordsAdded: number
  headingsChanged: number
}

/** One listed reference after URL normalization (FR-6.1, FR-6.5). */
export interface AioReference {
  id: string
  /** 1-based place in the reference list (FR-6.3). */
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
  /**
   * True when this URL is on the own domain and is not a tracked page (FR-20.5).
   * False for the target page and for any tracked page.
   */
  untracked: boolean
  sourceType: CitationSourceType
}

/**
 * One sample of one prompt in one market (section 10 `serp_results`, FR-5.4).
 * Raw JSON is redacted: `api_key`, `key`, and `token` are removed before this is sent (NFR-5).
 * The strings are the stored bodies, not a parsed SerpApi schema.
 */
export interface SampleCapture {
  id: string
  /** 1-based. */
  sampleNo: number
  keyId: string | null
  /** Display name of the SerpApi key. Not a hint and not a secret. */
  keyLabel: string | null
  hasAio: boolean
  neededFollowup: boolean
  /** Searches this sample cost, including retries (FR-5.5). */
  searches: number
  errorCode: CheckErrorCode | null
  /** NFR-10. Null when `errorCode` is null. Must not contain a secret. */
  message: string | null
  nextStep: string | null
  /** Overview text as stored. Null when there was no overview. */
  aioText: string | null
  /**
   * The overview as markdown (cloro), with its headings, lists, tables and
   * citation links. Null for a SerpApi search, an older check, or no overview.
   */
  aioMarkdown: string | null
  references: readonly AioReference[]
  rawSearchJson: string | null
  rawAioJson: string | null
}

/** Section 7.1. "2 of 3" beside the rolled-up status. */
export interface SampleFrequency {
  matching: number
  samples: number
}

/**
 * One prompt row for Results, the drill drawer, and the prompt grid (FR-12.7, FR-12.10).
 * `position` is the citation position, not the prompt's order. Prompt order is `promptPosition`.
 */
export interface PromptCheckRow {
  promptId: string
  promptPosition: number
  label: string
  text: string
  source: PromptSource
  intentStage: IntentStage
  status: PromptCheckStatus
  frequency: SampleFrequency
  /** Mean reference position for the status that won. Null when that status has no position. */
  position: number | null
  /** URL that made the status `page_cited` or `other_own_page`. Null otherwise. */
  citedUrl: string | null
  /**
   * Every source the AI Overview cited for this prompt in the selected market,
   * in position order (FR-6.3, FR-6.5, FR-12.10, FR-13.2).
   * Same shape as `SampleCapture.references` on `checks:getPrompt`.
   * This is the list from the sample whose status won. Empty when that prompt had no overview.
   * `citedUrl` stays the URL that made `page_cited` or `other_own_page`.
   */
  references: readonly AioReference[]
  /** True when the winning status is `other_own_page` (FR-12.6, FR-20.4). */
  wrongPageCited: boolean
  /** Brand named in the overview text (FR-6.4). Null when the status is `no_aio` or `error`. */
  named: boolean | null
  /** Null on the first check in this prompt-set version and market. */
  movement: PromptMovement | null
  /**
   * Status on the previous check in this prompt-set version and market (section 7.3, FR-7.2, FR-12.10).
   * Null when there is no previous check. The renderer uses this with `previousPosition`
   * to say "Lost, was cited #2".
   */
  previousStatus: PromptCheckStatus | null
  /**
   * Citation position on that previous check, 1-based (FR-6.3, FR-13.1).
   * Null when there is no previous check, or that status has no citation position.
   */
  previousPosition: number | null
  /** Latest gap row for this prompt. Null when no matrix is stored. */
  coverage: CoverageLevel | null
  /** `whatToUpdate` from that row. Null when there is no row. */
  action: string | null
  /** Short overview text for the drawer. The full text is on `checks:getPrompt`. */
  aioSummary: string | null
  /** ISO-8601 UTC. Null when this prompt has not finished. */
  checkedAt: string | null
}

/** Section 7.2 for one run (one page, one market, one check). */
export interface MarketCheckMetrics {
  runId: string
  pageId: string
  marketId: string
  promptSetId: string
  /** Saved prompt-set version. Null when that prompt set row is missing. */
  promptSetVersion: number | null
  snapshotId: string
  contentHash: string
  contentChanged: boolean
  contentChange: ContentChange | null
  kind: CheckRunKind
  /** True only for a follow-up that did not check every enabled prompt (FR-14.6, section 7.4). */
  partial: boolean
  status: CheckRunStatus
  /** ISO-8601 UTC. */
  startedAt: string
  finishedAt: string | null
  promptsChecked: number
  promptsWithAio: number
  pageCited: number
  otherOwnPage: number
  brandMentioned: number
  notCited: number
  noAio: number
  errors: number
  /** Sum of section 7.1 points across prompts with an AIO. */
  points: number
  /** 3 × prompts with an AIO. */
  pointsPossible: number
  /**
   * points ÷ pointsPossible, shown 0–100, nearest integer.
   * Null when `pointsPossible` is 0.
   */
  visibilityScore: number | null
  /** Own-domain links, split (FR-6.7). These are links, not prompts. */
  citationsThisPage: number
  citationsOtherOwn: number
  citedAndNamed: number
  /** Mean target-page reference position where the target was cited. Null when it was not. */
  averagePosition: number | null
}

/** FR-12.12. One of baseline, previous, and current. Null fields mean that check does not exist. */
export interface CheckComparisonColumn {
  which: 'baseline' | 'previous' | 'current'
  runId: string | null
  finishedAt: string | null
  score: number | null
  pageCited: number | null
  anyOwnPageCited: number | null
  linksThisPage: number | null
  linksOtherOwn: number | null
  brandMentioned: number | null
  aiosShown: number | null
  averagePosition: number | null
  contentChanged: boolean | null
  /**
   * Prompts checked in this column (FR-12.12, section 7.2).
   * The denominator beside `aiosShown` ("8 / 10"). Baseline, previous, and current each have their own count.
   * 0 when this column's check does not exist (`runId` is null). The other metrics stay null.
   */
  promptsChecked: number
}

export function isPromptCheckStatus(value: string): value is PromptCheckStatus {
  return isOneOf(PROMPT_CHECK_STATUSES, value)
}

export function isPromptMovement(value: string): value is PromptMovement {
  return isOneOf(PROMPT_MOVEMENTS, value)
}

export function isCitationClass(value: string): value is CitationClass {
  return isOneOf(CITATION_CLASSES, value)
}

export function isCitationSourceType(value: string): value is CitationSourceType {
  return isOneOf(CITATION_SOURCE_TYPES, value)
}

export function isCheckRunKind(value: string): value is CheckRunKind {
  return isOneOf(CHECK_RUN_KINDS, value)
}

export function isCheckRunStatus(value: string): value is CheckRunStatus {
  return isOneOf(CHECK_RUN_STATUSES, value)
}

export function isCheckJobStatus(value: string): value is CheckJobStatus {
  return isOneOf(CHECK_JOB_STATUSES, value)
}

export function isCheckPhase(value: string): value is CheckPhase {
  return isOneOf(CHECK_PHASES, value)
}

export function isCheckStepState(value: string): value is CheckStepState {
  return isOneOf(CHECK_STEP_STATES, value)
}

export function isCheckErrorCode(value: string): value is CheckErrorCode {
  return isOneOf(CHECK_ERROR_CODES, value)
}
