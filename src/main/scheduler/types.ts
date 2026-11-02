import type { DueList, IntervalDays, PageStatus, ProjectSchedule } from '@shared/domain'

/**
 * Contract types live in `src/shared`. These names are re-exported so the
 * scheduler can keep its public surface while the definitions stay shared.
 * The computer's timezone is not a field. Callers pass it beside the clock.
 */
export type { AppSchedule, DueList, DuePage, DueReason, ProjectSchedule } from '@shared/domain'

/**
 * Page facts the due list is computed from. Not a contract type.
 * `status` is section 10. `tracked` pages are scheduled. A `setting_up` page
 * is scheduled only once `promptSetVersion` is set, so a half-set-up page
 * is not queued. A market with no first check is due unless a stagger hold
 * says otherwise.
 */
export interface ScheduledMarketInput {
  marketId: string
  /** ISO-8601 UTC. Null until the first check in this market (FR-9.4). */
  lastCheckedAt: string | null
  /** SCH-12. ISO-8601 UTC. Null means the first check is not held for stagger. */
  firstCheckNotBefore: string | null
}

/**
 * Project facts the scheduler reads. `archived` comes from the project record
 * (FR-10.8) and is not a field on `ProjectSchedule`.
 */
export interface ScheduledProjectInput extends ProjectSchedule {
  archived: boolean
}

export interface ScheduledPageInput {
  projectId: string
  pageId: string
  label: string | null
  title: string | null
  /** Null for a topic (no single URL). */
  url: string | null
  status: PageStatus
  /** FR-1.4, SCH-9. The page's own interval, not the project default. */
  intervalDays: IntervalDays
  /**
   * Active prompt set, or null when the page has none.
   * A `setting_up` page is due only when this is set.
   */
  promptSetVersion: number | null
  /**
   * True for a topic with no saved question yet (an empty topic, "+ New empty
   * topic"): nothing to search, so it is not scheduled. Absent: false.
   */
  noQuestions?: boolean
  markets: readonly ScheduledMarketInput[]
  /**
   * True while the first check waits for the user (a page added on its own,
   * project migration 033). Its never-checked markets are not due.
   */
  firstCheckWaits?: boolean
}

/**
 * One staggered topic batch ("N now, the rest over 7 days"): the prompts left
 * for a later day. The due planner turns a batch whose day has come into a due
 * item with these prompt ids, so it runs through the queue with the same caps,
 * pause and quiet hours as any scheduled check (window and `--check-due`).
 */
export interface TopicBatchInput {
  id: string
  projectId: string
  pageId: string
  /** ISO-8601 UTC. */
  dueAt: string
  marketIds: readonly string[]
  /** Prompt ids of the topic's active set. Never empty. */
  promptIds: readonly string[]
}

export interface SchedulePlan {
  due: DueList
  /** Same projects, with `nextCheckAt` and `pagesDueToday` filled in. */
  projects: readonly ProjectSchedule[]
}
