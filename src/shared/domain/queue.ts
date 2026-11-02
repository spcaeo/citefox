/** The check queue, key caps, and the tray menu. */

import type { ApiKeyProvider, ConnectionState } from './connections'
import { isOneOf } from './one-of'

/** FR-11.4. What happens when a project reaches its monthly cap. */
const CAP_RULES = ['pause', 'notify', 'allow_10'] as const

export type CapRule = (typeof CAP_RULES)[number]

/** SCH-11 and FR-24.4. `paused_today` clears at the next local midnight. */
const QUEUE_STATES = ['running', 'paused_all', 'paused_today'] as const

export type QueueState = (typeof QUEUE_STATES)[number]

const QUEUE_PAUSE_SCOPES = ['all', 'today'] as const

export type QueuePauseScope = (typeof QUEUE_PAUSE_SCOPES)[number]

/** FR-24.6. How many finished checks the tray menu lists, newest first. */
export const TRAY_MENU_CHECK_LIMIT = 5

/** Per-key usage the queue and the Status screen show (SCH-11, FR-24.4, SERP-6). */
export interface QueueKeyUsage {
  keyId: string
  name: string
  provider: ApiKeyProvider
  used: number
  /** User cap. Null means no cap. */
  cap: number | null
  /** Plan allowance. Null when the account endpoint has not reported one. */
  planLimit: number | null
  state: ConnectionState
}

/** FR-11.4. Read-only on the queue. Changing the cap is not a channel in this contract. */
export interface QueueProjectUsage {
  projectId: string
  name: string
  used: number
  cap: number | null
  capRule: CapRule
  /** Dedicated key, or null when the project uses shared keys. */
  dedicatedKeyId: string | null
  /** Project pause. The UI reads this and shows "Paused". It does not clear the project's `nextCheckAt`. */
  paused: boolean
}

/**
 * SCH-11, FR-24.4, LLM-7.
 * `claudeConcurrency` is the Settings value. This channel does not change it.
 * No SerpApi requests-per-second number is invented here. Rate limits surface as `rate_limited`.
 */
export interface QueueStatus {
  state: QueueState
  running: number
  waiting: number
  claudeConcurrency: number
  claudeInFlight: number
  trayRunning: boolean
  /** True when the OS job from SCH-1 is registered. */
  headlessJob: boolean
  /**
   * ISO-8601 UTC. Null when the queue is `paused_all` or `paused_today`.
   * A paused project does not clear this.
   */
  nextRunAt: string | null
  pagesDue: number
  keys: readonly QueueKeyUsage[]
  projects: readonly QueueProjectUsage[]
}

/**
 * `queue:checkDue` and the headless `citefox --check-due` entry (section 11, SCH-2).
 * The CLI is not an IPC channel. It runs this same pass.
 * `started` is false when today's local date already had a pass.
 */
export interface CheckDueResult {
  started: boolean
  jobIds: readonly string[]
  pages: number
}

/** One row under "Last checks" (FR-24.6). */
export interface TrayLastCheck {
  projectId: string
  pageId: string
  label: string
  score: number | null
  /** Null when the page has no previous score. */
  change: number | null
  /** ISO-8601 UTC. */
  finishedAt: string
}

/** FR-24.6. Open, Quit, and Ask CiteFox are not fields. Ask CiteFox is M5. */
export interface TrayMenu {
  pausedToday: boolean
  pagesDueToday: number
  pagesWaiting: number
  lastChecks: readonly TrayLastCheck[]
}

export function isCapRule(value: string): value is CapRule {
  return isOneOf(CAP_RULES, value)
}

export function isQueueState(value: string): value is QueueState {
  return isOneOf(QUEUE_STATES, value)
}

export function isQueuePauseScope(value: string): value is QueuePauseScope {
  return isOneOf(QUEUE_PAUSE_SCOPES, value)
}
