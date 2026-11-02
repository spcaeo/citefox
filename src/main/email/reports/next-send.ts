import { formatInstant, parseClockTime } from '../../scheduler/clock-time'
import { addLocalDays, localDateKey, localParts, utcFromLocal } from '../../scheduler/local-time'
import type { ReportSchedule, ReportTiming } from '../types'

/** Enough to reach the next monthly slot, including a short month. */
const HORIZON_DAYS = 370

/**
 * Facts the schedule's project contributes to `nextSendAt`.
 * `paused` is project status `paused` or `archived`, or the project schedule pause.
 */
export interface ProjectSendFacts {
  paused: boolean
  /** ISO-8601 UTC from the project schedule. Null when no check is scheduled. */
  nextCheckAt: string | null
}

/**
 * FR-23.7 and FR-23.12. ISO-8601 UTC, or null.
 * Null when the timing is `on_change`, or the schedule's project is paused.
 * `after_check` uses that project's `nextCheckAt`. An all-projects `after_check`
 * has no single check time, so it is null. A paused schedule still has a slot.
 */
export function nextSendAt(
  schedule: ReportSchedule,
  nowMs: number,
  project: ProjectSendFacts | null
): string | null {
  if (schedule.timing.kind === 'on_change') return null
  if (schedule.projectId !== null && (project === null || project.paused)) return null
  if (schedule.timing.kind === 'after_check') return project?.nextCheckAt ?? null
  return nextClockSlot(schedule.timing, schedule.timeZone, nowMs)
}

function nextClockSlot(
  timing: Extract<ReportTiming, { kind: 'weekly' | 'monthly' }>,
  timeZone: string,
  nowMs: number
): string | null {
  const minute = parseClockTime(timing.time, 'report time')
  let cursor = startOfLocalDay(nowMs, timeZone)
  for (let step = 0; step < HORIZON_DAYS; step += 1) {
    const date = localDateKey(cursor, timeZone)
    if (matches(date, timing)) {
      const instant = instantOnDate(date, minute, timeZone)
      if (instant >= nowMs) return formatInstant(instant)
    }
    cursor = addLocalDays(cursor, timeZone, 1)
  }
  return null
}

function matches(
  date: string,
  timing: Extract<ReportTiming, { kind: 'weekly' | 'monthly' }>
): boolean {
  if (timing.kind === 'weekly') return isoWeekday(date) === timing.day
  return monthlyMatch(date, timing.when)
}

function monthlyMatch(date: string, when: '1' | '15' | 'last'): boolean {
  const day = dayOf(date)
  if (when === '1') return day === 1
  if (when === '15') return day === 15
  return day === lastDayOfMonth(date)
}

function startOfLocalDay(nowMs: number, timeZone: string): number {
  const parts = localParts(nowMs, timeZone)
  return utcFromLocal(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 },
    timeZone
  )
}

function instantOnDate(date: string, minuteOfDay: number, timeZone: string): number {
  const [year, month, day] = dateParts(date)
  return utcFromLocal(
    {
      year,
      month,
      day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      second: 0
    },
    timeZone
  )
}

function isoWeekday(date: string): number {
  const [year, month, day] = dateParts(date)
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return js === 0 ? 7 : js
}

function lastDayOfMonth(date: string): number {
  const [year, month] = dateParts(date)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dayOf(date: string): number {
  return dateParts(date)[2]
}

function dateParts(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return [1970, 1, 1]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
