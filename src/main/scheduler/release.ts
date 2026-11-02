import { parseClockTime } from './clock-time'
import { ScheduleError } from './errors'
import { MS_PER_DAY } from './intervals'
import {
  addLocalDays,
  dailyCheckOnDay,
  isQuietAt,
  quietEndInstant,
  type MinuteWindow
} from './local-time'
import type { ProjectSchedule } from './types'

export type QuietWindow = MinuteWindow

/** Null when quiet hours are off. One side set and the other null is invalid. */
export function quietWindow(schedule: ProjectSchedule): QuietWindow | null {
  if (schedule.quietFrom === null && schedule.quietUntil === null) return null
  if (schedule.quietFrom === null || schedule.quietUntil === null) {
    throw new ScheduleError('Quiet hours need both a start and an end, or neither')
  }
  return {
    startMinute: parseClockTime(schedule.quietFrom, 'quiet hours start'),
    endMinute: parseClockTime(schedule.quietUntil, 'quiet hours end')
  }
}

/**
 * When a page checked at `lastCheckedMs` is due again (before the daily check time
 * and quiet hours are applied by {@link releaseInstant}).
 *
 * - Every day (1): the check time on the next local calendar day, whatever hour the
 *   last check ran. A check that ran late (after sleep, or a long queue) does not push
 *   every later day's check later, a day is never skipped, and a page checked today
 *   (on schedule or by Check now) is never due again the same day. On the day the
 *   clocks go back (a 25-hour day) it still waits for the next day.
 * - Every 7 days and longer: exactly `intervalDays` × 24 hours later (NFR-15).
 */
export function intervalElapsedAt(
  lastCheckedMs: number,
  intervalDays: number,
  schedule: ProjectSchedule,
  timeZone: string
): number {
  if (intervalDays !== 1) return lastCheckedMs + intervalDays * MS_PER_DAY
  const minute = parseClockTime(schedule.dailyCheckTime, 'daily check time')
  return dailyCheckOnDay(addLocalDays(lastCheckedMs, timeZone, 1), timeZone, minute)
}

/**
 * First legal slot on or after `elapsedAt`: the project's daily check time,
 * then outside quiet hours. SCH-3, SCH-9.
 */
export function releaseInstant(
  elapsedAt: number,
  schedule: ProjectSchedule,
  timeZone: string
): number {
  const minute = parseClockTime(schedule.dailyCheckTime, 'daily check time')
  let at = snapDaily(elapsedAt, timeZone, minute)
  at = snapQuiet(at, schedule, timeZone)
  at = snapDaily(at, timeZone, minute)
  at = snapQuiet(at, schedule, timeZone)
  return at
}

export function inQuiet(nowMs: number, schedule: ProjectSchedule, timeZone: string): boolean {
  const quiet = quietWindow(schedule)
  if (quiet === null) return false
  return isQuietAt(nowMs, timeZone, quiet)
}

export function quietEnds(nowMs: number, schedule: ProjectSchedule, timeZone: string): number {
  const quiet = quietWindow(schedule)
  if (quiet === null || !isQuietAt(nowMs, timeZone, quiet)) return nowMs
  return quietEndInstant(nowMs, timeZone, quiet)
}

function snapDaily(at: number, timeZone: string, dailyCheckMinute: number): number {
  const check = dailyCheckOnDay(at, timeZone, dailyCheckMinute)
  return at < check ? check : at
}

function snapQuiet(at: number, schedule: ProjectSchedule, timeZone: string): number {
  if (!inQuiet(at, schedule, timeZone)) return at
  return quietEnds(at, schedule, timeZone)
}
