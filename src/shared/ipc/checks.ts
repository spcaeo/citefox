/** Check jobs and their progress events. */

import type {
  CheckErrorCode,
  CheckJobStatus,
  CheckPhase,
  CheckStepState,
  EngineAnswerStatus,
  EngineId,
  PromptCheckDetail,
  SearchProvider,
  TopicPromptKind,
  TopicStage
} from '../domain'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'

/** `checks:cancel` and `checks:get`. */
export interface CheckJobIdRequest {
  jobId: string
}

/**
 * `checks:listActive`. `projectId` null lists every project's running jobs (the Status screen).
 * A project id lists that project's jobs (the Checking screen after the window reopens).
 */
export interface ActiveJobsRequest {
  projectId: string | null
}

/**
 * `checks:start` (FR-1.7 step 4, FR-5.6, FR-7.5, FR-14.6).
 * One job. The engine creates one section 10 run per page × market.
 * `marketIds` null means every market on each page. A market a page does not have is skipped.
 * `promptIds` null means every enabled buyer prompt. A list is a follow-up and is stored as partial.
 * The engine marks a run `baseline` when the section 8 rule says so. This request does not send that kind.
 */
export interface StartCheckRequest {
  projectId: string
  pageIds: readonly [string, ...string[]]
  marketIds: readonly string[] | null
  promptIds: readonly string[] | null
  /**
   * These engines instead of the page's own (a one-question re-check on just Google AI
   * Overview, or a try on ChatGPT). Left out or null: every engine the page checks.
   */
  engines?: readonly EngineId[] | null
}

/** Latest cell for one prompt phase, so a reopened Checking screen can paint without replaying events. */
export interface CheckStepSnapshot {
  pageId: string
  marketId: string
  promptId: string
  /** 1-based prompt order on the Checking table. */
  promptPosition: number
  /** Short name. The question itself is `promptText`. */
  label: string
  /**
   * The buyer question being checked, in this market's wording (FR-5.6, FR-8.6).
   * `label` stays the short name.
   */
  promptText: string
  /** 1-based. Null for `reread` and `analysis`. */
  sampleNo: number | null
  phase: CheckPhase
  state: CheckStepState
  detail: string
  errorCode: CheckErrorCode | null
  /**
   * Short message for this step while the job may still be running (FR-5.5, FR-5.6, NFR-10).
   * Null when the step has no error. Never a key, a token, or a raw provider payload (NFR-5).
   * `CheckJob.message` stays the job-level sentence and is null unless `status` is `error`.
   */
  error: string | null
  /** Extra searches this step's retries added (FR-5.5). 0 when there were none. */
  retrySearches: number
}

/** One market pill on the Checking screen (FR-5.6). */
export interface CheckMarketProgress {
  marketId: string
  done: number
  total: number
  state: CheckStepState
}

/**
 * The Checking screen's job (FR-5.6).
 * `done` and `total` count prompts × markets, not samples and not phases.
 * A prompt × market counts as done when its `analysis` step reaches `ok`, `warning`, or `error`.
 * `searchesMax` is prompts × markets × samples × 2 (`SEARCHES_PER_PROMPT_MAX`), plus
 * `brandSearchesMax`.
 */
export interface CheckJob {
  id: string
  projectId: string
  pageIds: readonly string[]
  marketIds: readonly string[] | null
  promptIds: readonly string[] | null
  status: CheckJobStatus
  /** ISO-8601 UTC. */
  startedAt: string
  finishedAt: string | null
  done: number
  total: number
  searchesUsed: number
  searchesMax: number
  /**
   * The brand prompts' share of `searchesMax` (FR-16.1): brand prompts × markets
   * in their language × 1 sample × 2. Sentiment only, never in visibility. 0 on a follow-up.
   */
  brandSearchesMax: number
  /** This project's searches this month. Null when usage has not been counted. */
  monthUsed: number | null
  /** Project cap. Null when the project has no cap. */
  monthLimit: number | null
  /** Section 10 run ids created so far, one per page × market. */
  runIds: readonly string[]
  markets: readonly CheckMarketProgress[]
  steps: readonly CheckStepSnapshot[]
  /** NFR-10. Null unless `status` is `error`. */
  message: string | null
  nextStep: string | null
  /** The engines this job checks (multi-engine). Absent on jobs from before engines. */
  engines?: readonly EngineId[]
  /** Who ran the Google AI Overview searches. Null when the job runs no Google search. */
  provider?: SearchProvider | null
  /** cloro credits charged so far. */
  creditsUsed?: number
  /** Money spent so far, USD × 1,000,000 at each key's plan. */
  costMicros?: number
  /**
   * `total` split into questions and keywords (a topic can have both), so the
   * Check window says "8 questions and 4 keywords". Absent on older jobs.
   */
  mix?: CheckMix
}

/** A job's questions and keywords, each counted per market. */
export interface CheckMix {
  questions: number
  keywords: number
}

/**
 * Pushed during `checks:start`, once per phase change of one step (FR-5.6, NFR-17).
 * `done` / `total` are the job totals. `markets` is every market pill, so a late subscriber
 * can paint the pills from the latest event. The prompt table for a remount comes from `checks:get`.
 */
export interface CheckProgress {
  jobId: string
  projectId: string
  pageId: string
  marketId: string | null
  promptId: string | null
  /** 1-based. Null for `reread` and `analysis`. */
  sampleNo: number | null
  phase: CheckPhase
  state: CheckStepState
  detail: string
  /** NFR-10. Null unless `state` is `warning` or `error`. */
  nextStep: string | null
  errorCode: CheckErrorCode | null
  retrySearches: number
  done: number
  total: number
  searchesUsed: number
  searchesMax: number
  monthUsed: number | null
  monthLimit: number | null
  markets: readonly CheckMarketProgress[]
  /** The question being searched, in this market's wording. Absent on job-level events. */
  promptText?: string
  /** Credits the job has spent so far. Absent on older events. */
  creditsUsed?: number
  /** See `CheckJob.mix`. */
  mix?: CheckMix
  /** Questions being checked right now (a check runs a few at once). Absent when none. */
  inFlight?: number
  /** The same questions one by one, in the order they started. Absent when none. */
  inFlightItems?: readonly CheckInFlightItem[]
  /** The question scored last, for "Q8 cited ✓" under the running ones. */
  lastDone?: CheckLastDone
  /** The project's own domain, for "… to see whether they cite example.com". */
  domain?: string
}

/** Which question a check item is, numbered as the topic screen numbers it (Q9, K3). */
export interface CheckItemRef {
  pageId: string
  marketId: string
  promptId: string
  kind: TopicPromptKind
  /** 9 in "Q9": questions and keywords are numbered apart, like the topic screen. */
  number: number
}

/**
 * One question or keyword a running check is searching now (owner, 2026-10-29: "if
 * there are three processes, why don't we show these three?").
 */
export interface CheckInFlightItem extends CheckItemRef {
  /** Problem, Options, Doubts… when the topic gave it one. */
  stage: TopicStage | null
  /** The exact words searched, in this market's wording. */
  text: string
  /**
   * The engines asked for the current sample, in display order. `status` is null while
   * that engine has not answered yet.
   */
  engines: readonly { engine: EngineId; status: EngineAnswerStatus | null }[]
  /** ISO-8601 UTC. */
  startedAt: string
}

export interface CheckLastDone extends CheckItemRef {
  /** Our site was cited by at least one engine. Null when every call failed. */
  cited: boolean | null
  /** ISO-8601 UTC. */
  finishedAt: string
}

/**
 * FR-24.7. One notice per page when that page's markets in the job have finished.
 * The score is the page's default market. `pageCited` is how many AIOs cite this page.
 */
export interface CheckFinishedNotice {
  jobId: string
  projectId: string
  pageId: string
  pageLabel: string
  marketId: string
  pageCited: number
  aiosShown: number
  /** Change in `pageCited` since the previous check. Null on the first check. */
  pageCitedChange: number | null
  score: number | null
  scoreChange: number | null
  contentChanged: boolean
}

/** `checks:getPrompt`. Null `marketId` is the page's default market. Null `runId` is the latest finished run. */
export interface GetPromptCheckRequest {
  projectId: string
  pageId: string
  promptId: string
  marketId: string | null
  runId: string | null
}

/**
 * `checks:notCited`: the questions each page did not get cited for last time,
 * for Check now's "Only questions not cited last time". `marketIds` null is
 * every market of each page. At most {@link MAX_NOT_CITED_PAGES} pages.
 */
export interface NotCitedRequest {
  projectId: string
  pageIds: readonly string[]
  marketIds: readonly string[] | null
}

/** Pages a single `checks:notCited` call reads. */
export const MAX_NOT_CITED_PAGES = 5000

/** One market's questions that were checked there and not cited. */
export interface NotCitedMarket {
  marketId: string
  /** Ids in the page's current question set, in question order. Never empty. */
  promptIds: readonly string[]
}

/** One page's questions that were checked and not cited (any status but `page_cited`). */
export interface NotCitedPage {
  pageId: string
  /** Ids in the page's current question set, in question order: every asked market together. */
  promptIds: readonly string[]
  /**
   * The same per market, in the page's market order: only the asked markets
   * with at least one question not cited there. A question cited in one market
   * and missed in another is listed under the other only.
   */
  markets: readonly NotCitedMarket[]
  /** False when the page has no finished check in those markets yet. */
  checked: boolean
}

export interface NotCitedList {
  pages: readonly NotCitedPage[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const checksChannels = {
  'checks:start': invokeWith<StartCheckRequest, CheckJob>(),
  'checks:cancel': invokeWith<CheckJobIdRequest, CheckJob>(),
  'checks:get': invokeWith<CheckJobIdRequest, CheckJob | null>(),
  'checks:listActive': invokeWith<ActiveJobsRequest, readonly CheckJob[]>(),
  'checks:getPrompt': invokeWith<GetPromptCheckRequest, PromptCheckDetail>(),
  'checks:notCited': invokeWith<NotCitedRequest, NotCitedList>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const checksEvents = {
  'checks:progress': push<CheckProgress>(),
  'checks:finished': push<CheckFinishedNotice>()
} as const satisfies PushChannelSpecs
