/**
 * Background page setup (FR-1.7, FR-20.6, SCH-12). Pages tracked in bulk
 * (Import pages, Site structure, All pages) start as "setting up". The main
 * process reads each page, writes its buyer profile, buyer prompts and coverage
 * with the project's Claude connection and templates, and marks it tracked so
 * the scheduler checks it on its staggered date.
 */

import type { SampleCount } from '../domain'
import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/**
 * The `assist:progress` channel name of a background setup run; its scope is the
 * page id, so a page tab shows only its own page's live steps.
 */
export const SETUP_PROGRESS_CHANNEL = 'setup:run'

/** The steps the runner takes for one page, in order. */
export const SETUP_RUN_STEPS = ['read', 'profile', 'prompts', 'coverage'] as const

export type SetupRunStep = (typeof SETUP_RUN_STEPS)[number]

/** One page whose setup stopped. */
export interface SetupFailure {
  projectId: string
  projectName: string
  pageId: string
  url: string
  /** The page label, else its title, else null. */
  label: string | null
  step: SetupRunStep
  /** Redacted, plain words. */
  reason: string
  nextStep: string | null
  attempts: number
  /** ISO-8601 UTC. */
  failedAt: string
  /** ISO-8601 UTC of the next automatic try. Null when CiteFox gave up (use Retry). */
  retryAt: string | null
}

/** One page behind a `SetupStatus` count, so each count opens exactly its pages (NFR-14). */
export interface SetupPageRef {
  projectId: string
  projectName: string
  pageId: string
  url: string
  /** The page label, else its title, else null. */
  label: string | null
}

/** The pages behind each count. Each list's length equals its count. */
export interface SetupStatusPages {
  waiting: readonly SetupPageRef[]
  running: readonly SetupPageRef[]
  doneToday: readonly SetupPageRef[]
  failed: readonly SetupPageRef[]
}

/**
 * What the runner is doing. "Today" is the computer's local day.
 * `waiting` counts pages still setting up that are not running and have not
 * failed for good, including pages held for their staggered date, quiet hours,
 * or a Claude limit.
 */
export interface SetupStatus {
  /** ISO-8601 UTC. */
  builtAt: string
  paused: boolean
  pagesPerHour: number
  waiting: number
  running: number
  doneToday: number
  /** Pages that gave up after their retries. Pages waiting to retry are in `waiting`. */
  failed: number
  /** Gave up, and waiting to retry, newest first, at most 50. */
  failures: readonly SetupFailure[]
  /** Why nothing is starting now, in plain words. Null when the runner is free to start. */
  holdReason: string | null
  /** The pages behind `waiting`, `running`, `doneToday` and `failed`. */
  pages?: SetupStatusPages
}

export interface SetupProgress {
  projectId: string
  pageId: string
  step: SetupRunStep
  state: 'running' | 'done' | 'failed' | 'waiting'
  /** Plain words. */
  message: string
  status: SetupStatus
}

/** Omit both to retry every page that failed. */
export interface SetupRetryRequest {
  projectId?: string
  pageIds?: readonly string[]
}

export interface SetupPauseRequest {
  paused: boolean
}

export interface SetupRateRequest {
  /** 1–200. */
  pagesPerHour: number
}

/**
 * One page's automatic setup, as the page tabs show it (owner feedback 5): read
 * page → buyer profile → buyer prompts → content gaps → ready to check. Built
 * from what is stored, so a page set up by hand reads the same way.
 */
export const PAGE_PIPELINE_STEPS = ['read', 'profile', 'prompts', 'coverage', 'ready'] as const

export type PagePipelineStepId = (typeof PAGE_PIPELINE_STEPS)[number]

/** `todo` has not started; `waiting` is held (retry later, a Claude limit, stopped). */
export type PagePipelineStepState = 'done' | 'running' | 'waiting' | 'failed' | 'todo'

export interface PagePipelineStep {
  id: PagePipelineStepId
  label: string
  state: PagePipelineStepState
  /** Plain words for this step, such as "1,240 words" or "10 prompts". Null when nothing to say. */
  detail: string | null
}

/**
 * - `queued`: waiting for a slot (or the background runner is off).
 * - `running`: a step is in flight.
 * - `retrying`: a step failed and CiteFox tries again by itself at `retryAt`.
 * - `held`: waiting on a Claude limit or a notice answer.
 * - `failed`: gave up; the one action fixes it.
 * - `stopped`: the user stopped setup; Resume continues.
 * - `ready`: prompts are saved and the first check waits for the user (or runs by itself).
 * - `checked`: the page has been checked at least once.
 */
export type PagePipelineState =
  'queued' | 'running' | 'retrying' | 'held' | 'failed' | 'stopped' | 'ready' | 'checked'

/** The one thing the user can do about a stopped or failed setup. */
export type PagePipelineActionKind = 'retry' | 'resume' | 'connections' | 'project_settings'

export interface PagePipelineAction {
  kind: PagePipelineActionKind
  label: string
}

export interface PagePipeline {
  projectId: string
  pageId: string
  state: PagePipelineState
  /** Plain words: what CiteFox is doing or why it stopped. */
  message: string
  steps: readonly PagePipelineStep[]
  /** ISO-8601 UTC of this run's start, for the elapsed time. Null before the first run. */
  startedAt: string | null
  /** ISO-8601 UTC when setup finished. Null while it is not finished. */
  finishedAt: string | null
  /** ISO-8601 UTC of the next automatic try (`retrying`). */
  retryAt: string | null
  attempts: number
  /** Redacted plain words of the last failure. Null when nothing failed. */
  error: string | null
  action: PagePipelineAction | null
  /** Enabled prompts in the active set. */
  prompts: number
  markets: number
  samples: SampleCount
  /** The first check's search estimate: prompts × markets × samples, then twice that. */
  searchesMin: number
  searchesMax: number
  /** True while the first check waits for "Start first check". */
  firstCheckWaits: boolean
  /** Project setting: start the first check by itself once setup is ready (default off). */
  checkWhenReady: boolean
  /**
   * This page was added with "Add and check now" and its first check is still
   * pending: it starts by itself once setup is ready (kept over a restart).
   */
  checkAsked: boolean
}

/** `setup:start` and `setup:stop` for one page. */
export interface SetupPageRequest {
  projectId: string
  pageId: string
}

/** `setup:checkWhenReady`: the project setting, from the review screen or Project settings. */
export interface SetupCheckWhenReadyRequest {
  projectId: string
  on: boolean
}

/** Invoke channels for this area. Each one is declared here only. */
export const setupChannels = {
  'setup:status': invoke<SetupStatus>(),
  'setup:page': invokeWith<SetupPageRequest, PagePipeline>(),
  'setup:start': invokeWith<SetupPageRequest, PagePipeline>(),
  'setup:stop': invokeWith<SetupPageRequest, PagePipeline>(),
  'setup:checkWhenReady': invokeWith<SetupCheckWhenReadyRequest, { checkWhenReady: boolean }>(),
  'setup:retry': invokeWith<SetupRetryRequest, SetupStatus>(),
  'setup:pause': invokeWith<SetupPauseRequest, SetupStatus>(),
  'setup:setRate': invokeWith<SetupRateRequest, SetupStatus>()
} as const satisfies InvokeChannelSpecs

export const setupEvents = {
  'setup:progress': push<SetupProgress>()
} as const satisfies PushChannelSpecs
