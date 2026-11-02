import type { QueuePauseStore } from './pause-store'
import type {
  ApiKeyProvider,
  CapRule,
  ConnectionState,
  DueReason,
  ProviderChoice,
  SerpApiRotationMode
} from '@shared/domain'

/**
 * Contract types live in `src/shared`. Cap rules keep their contract names:
 * `pause` and `notify` refuse new searches, `allow_10` permits `cap + floor(cap / 10)`.
 */
export type {
  CapRule,
  CheckDueResult,
  QueueKeyUsage,
  QueuePauseScope,
  QueueProjectUsage,
  QueueState,
  QueueStatus
} from '@shared/domain'

/** Key facts the queue needs besides `QueueKeyUsage`. Not all of these are on the status row. */
export interface QueueKeyInput {
  keyId: string
  name: string
  provider: ApiKeyProvider
  cap: number | null
  planLimit: number | null
  state: ConnectionState
  rotationOrder: number
  /** Empty means every project in `in_order` and `spread_evenly` (lead decision). */
  projectIds: readonly string[]
}

export interface QueueProjectInput {
  projectId: string
  name: string
  cap: number | null
  capRule: CapRule
  dedicatedKeyId: string | null
  paused: boolean
  /**
   * Who runs the project's Google AI Overview search (project migration 045). Absent or
   * `auto`: cloro when a cloro key the project may use is on, else SerpApi.
   */
  provider?: ProviderChoice
}

export type FailoverReason = 'failed' | 'cap_reached'

/** Section 10 `connection_events.kind`. No secrets. */
export interface KeyEvent {
  /** ISO-8601 UTC. */
  at: string
  keyId: string
  projectId: string
  kind: FailoverReason | 'rate_limited' | 'failover'
  detail: string
}

export interface QueueWork {
  id: string
  projectId: string
  pageId: string
  marketIds: readonly string[]
  /** `manual` is Check now (FR-7.5). It is not a due-list reason. */
  reason: DueReason | 'manual'
  promptIds: readonly string[] | null
  /** Set only when `reason` is `follow_up`. Two fixes for one page stay distinct. */
  fixId?: string
  /** A staggered topic batch; recorded as started once its check succeeds. */
  topicBatchId?: string
  needsClaude: boolean
  /** SERP-2 upper bound. The queue will not start the job until this fits the caps. */
  maxSearches: number
  /** ISO-8601 UTC. The job stays waiting until the clock reaches this. */
  notBefore: string
}

export interface RunningJob {
  id: string
  projectId: string
  pageId: string
  marketIds: readonly string[]
  reason: DueReason | 'manual'
  promptIds: readonly string[] | null
  /** Set only when `reason` is `follow_up`. */
  fixId?: string
  /** A staggered topic batch. */
  topicBatchId?: string
  partial: boolean
  needsClaude: boolean
  maxSearches: number
  /** ISO-8601 UTC. */
  startedAt: string
  cancelRequested: boolean
}

/**
 * FR-11.4. Fired once per project per local month when `notify` refuses a job.
 * Email delivery is a later task. This hook only reports the cap.
 */
export interface CapAlert {
  /** ISO-8601 UTC. */
  at: string
  projectId: string
  name: string
  used: number
  cap: number
  /** `YYYY-MM` in the computer's timezone. */
  month: string
}

/**
 * One month-to-date `key_usage` row (decision 26).
 * The queue does not read the table. Callers inject the rows.
 * `projectId` is null when migration 009 stored usage with no project.
 * Those searches count toward the key and not toward a project cap.
 */
export interface MonthUsageSeed {
  keyId: string
  projectId: string | null
  /** `YYYY-MM` in the computer's timezone. */
  month: string
  searches: number
}

/**
 * Month-to-date searches for the caps ledger.
 * `usageSeedFromStorage` reads `getKeyUsageForMonth`. An omitted seed is empty.
 */
export interface UsageSeedStore {
  monthToDate(): readonly MonthUsageSeed[]
}

/**
 * One SerpApi search the ledger is about to count.
 * `persistSearch` writes this row before the in-memory total moves.
 */
export interface CommittedSearchWrite {
  keyId: string
  projectId: string
  /** `YYYY-MM` in the computer's timezone. */
  month: string
  searches: number
}

export interface QueueOptions {
  clock: { now(): number }
  /** Called when a `notify` cap refuses new searches. Omitted: no alert is sent. */
  onCapAlert?: (alert: CapAlert) => void
  /** Computer local zone (decision 8). Used for "today", midnight, and the usage month. */
  timeZone: string
  /** LLM-7. Defaults to the shared Settings value of 2. */
  claudeConcurrency?: number
  trayRunning?: boolean
  /** True when the SCH-1 OS job is registered. This queue does not register it. */
  headlessJob?: boolean
  /**
   * FR-11.2. Defaults to `in_order`. A function is read on every allocation, so a mode
   * changed in Connections applies to the next check. The queue does not write the mode.
   */
  rotation?: SerpApiRotationMode | (() => SerpApiRotationMode)
  keys: readonly QueueKeyInput[]
  projects: readonly QueueProjectInput[]
  /**
   * Month-to-date `key_usage` (decision 26).
   * Omitted means the ledger starts empty. `--check-due` passes `usageSeedFromStorage`.
   */
  usageSeed?: readonly MonthUsageSeed[]
  /**
   * Writes the search to `key_usage` in the same step as the ledger commit.
   * The ledger calls this before it raises the in-memory count, so `syncCommitted`
   * cannot drop a search that was counted only in memory.
   */
  persistSearch?: (search: CommittedSearchWrite) => void
  /**
   * True while a check of this page is already running.
   * `checkDue` does not enqueue that page, and `dequeue` leaves a waiting copy unstarted.
   */
  pageRunning?: (projectId: string, pageId: string) => boolean
  /**
   * Shared pause row (SCH-11). Omitted: an in-memory store, so the pause lasts
   * only as long as this queue. Production passes the `queue_pause` row so the
   * tray and `citefox --check-due` honour the same pause.
   */
  pauseStore?: QueuePauseStore
}
