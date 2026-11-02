import type { ScheduledPageInput, ProjectSchedule } from './types'

/**
 * FR-10.5, SCH-9. Project pause is `paused`, not `ProjectStatus`.
 * Pausing clears `pagesDueToday`. `nextCheckAt` stays, and `planSchedule`
 * recomputes it as the next check after resume. Page pause is status `paused`.
 */

export function pauseProject<T extends ProjectSchedule>(schedule: T): T {
  return { ...schedule, paused: true, pagesDueToday: 0 }
}

export function resumeProject<T extends ProjectSchedule>(schedule: T): T {
  if (!schedule.paused) return schedule
  return { ...schedule, paused: false }
}

export function pausePage(page: ScheduledPageInput): ScheduledPageInput {
  if (page.status !== 'tracked') return page
  return { ...page, status: 'paused' }
}

export function resumePage(page: ScheduledPageInput): ScheduledPageInput {
  if (page.status !== 'paused') return page
  return { ...page, status: 'tracked' }
}
