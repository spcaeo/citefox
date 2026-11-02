/** Re-check schedules, due pages, and fix follow-ups. */

import { isOneOf } from './one-of'
import type { IntervalDays } from './settings'

/** Why a page is on the due list. */
const DUE_REASONS = ['scheduled', 'follow_up', 'catch_up'] as const

export type DueReason = (typeof DUE_REASONS)[number]

/**
 * SCH-1. App-wide tray and headless job.
 * `dailyCheckTime` is `HH:MM` in the computer's local timezone, 24-hour.
 */
export interface AppSchedule {
  startAtLogin: boolean
  catchUpAfterSleep: boolean
  /** Turning this on registers the OS job. Turning it off removes the job (SCH-1). */
  checkWhenClosed: boolean
  dailyCheckTime: string
}

/**
 * SCH-9. Pages keep their own interval (`pages:update`).
 * This is the project's default interval for new pages, plus the clock and the pause.
 * Quiet hours use the same `HH:MM` local clock. A window that passes midnight (22:00–07:00) is legal.
 * Null quiet fields mean quiet hours are off.
 */
export interface ProjectSchedule {
  projectId: string
  defaultIntervalDays: IntervalDays
  dailyCheckTime: string
  quietFrom: string | null
  quietUntil: string | null
  spreadAcrossDay: boolean
  catchUp: boolean
  /** Pause for this project. The UI reads this and shows "Paused". */
  paused: boolean
  /**
   * ISO-8601 UTC of the soonest page. Stays computed while `paused`: the next check after resume (SCH-9).
   * Null when no page is scheduled, or the project is archived.
   */
  nextCheckAt: string | null
  /** Stays 0 while `paused`. */
  pagesDueToday: number
}

/** One page the scheduler should run (FR-7.1, SCH-10). */
export interface DuePage {
  projectId: string
  pageId: string
  label: string | null
  title: string | null
  /** Null for a topic, which has no single URL. */
  url: string | null
  marketIds: readonly string[]
  /** ISO-8601 UTC. */
  dueAt: string
  intervalDays: IntervalDays
  reason: DueReason
  /** Set when `reason` is `follow_up`. */
  promptIds: readonly string[] | null
  /** Set only when `reason` is `follow_up`. The logged fix this due item completes. */
  fixId?: string
  /** Set for a staggered topic batch (`reason` `scheduled`, `promptIds` set). */
  topicBatchId?: string
}

export interface DueList {
  /** Local calendar date the list was built for, `YYYY-MM-DD`. */
  day: string
  pages: readonly DuePage[]
}

/** FR-14.5, SCH-10. When the follow-up for a logged fix should run. */
const FIX_RECHECK_RULES = ['after_3_days', 'after_7_days', 'next_scheduled'] as const

export type FixRecheckRule = (typeof FIX_RECHECK_RULES)[number]

/**
 * SCH-10, FR-14.5. One logged fix the scheduler can run.
 * `description` is what changed. Storage assigns the fix number per page.
 * Completion is `followup_run_id` on the stored fix, not a field here.
 */
export interface FixFollowUpInput {
  id: string
  projectId: string
  pageId: string
  description: string
  /** ISO-8601 UTC go-live. */
  goLiveAt: string
  rule: FixRecheckRule
  promptIds: readonly string[]
  marketIds: readonly string[]
}

export function isDueReason(value: string): value is DueReason {
  return isOneOf(DUE_REASONS, value)
}

export function isFixRecheckRule(value: string): value is FixRecheckRule {
  return isOneOf(FIX_RECHECK_RULES, value)
}
