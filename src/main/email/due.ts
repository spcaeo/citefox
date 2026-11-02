import { ScheduleError } from '../scheduler/errors'
import { parseClockTime } from '../scheduler/clock-time'
import {
  addLocalDays,
  assertTimeZone,
  localDateKey,
  localParts,
  utcFromLocal
} from '../scheduler/local-time'
import { EmailError } from './errors'
import type { ReportSchedule, ReportTiming } from './types'

/** Ten years of daily steps. A longer span is not walked. */
const MAX_DAYS = 3660

export interface DueOccurrence {
  key: string
  trigger: 'weekly' | 'monthly'
}

/**
 * FR-23.7 and FR-23.12. Occurrences whose local instant is at or before `now`
 * and at or after the schedule was created. Missed ones stay due so a wake can send them.
 */
export function dueOccurrences(schedule: ReportSchedule, nowMs: number): DueOccurrence[] {
  const timing = schedule.timing
  if (timing.kind !== 'weekly' && timing.kind !== 'monthly') return []
  const minute = clockMinute(timing.time)
  const createdMs = Date.parse(schedule.createdAt)
  const dates = localDates(createdMs, nowMs, schedule.timeZone)
  const due: DueOccurrence[] = []
  for (const date of dates) {
    if (!matchesTiming(date, timing)) continue
    const instant = instantOnDate(date, minute, schedule.timeZone)
    if (instant < createdMs || instant > nowMs) continue
    due.push({ key: `${timing.kind}:${date}`, trigger: timing.kind })
  }
  return due
}

export function requireTimeZone(timeZone: string): void {
  try {
    assertTimeZone(timeZone)
  } catch (error: unknown) {
    if (error instanceof ScheduleError) throw new EmailError('Invalid time zone', 'invalid')
    throw error
  }
}

export function requireClockTime(value: string): void {
  try {
    parseClockTime(value, 'time')
  } catch (error: unknown) {
    if (error instanceof ScheduleError) throw new EmailError('Invalid time', 'invalid')
    throw error
  }
}

/** Local calendar date is the 1st (FR-23.13). */
export function isFirstOfMonth(date: string): boolean {
  return /^\d{4}-\d{2}-01$/.test(date)
}

function clockMinute(value: string): number {
  try {
    return parseClockTime(value, 'time')
  } catch (error: unknown) {
    if (error instanceof ScheduleError) throw new EmailError('Invalid time', 'invalid')
    throw error
  }
}

function matchesTiming(date: string, timing: ReportTiming): boolean {
  if (timing.kind === 'weekly') return isoWeekday(date) === timing.day
  if (timing.kind === 'monthly') return monthlyMatch(date, timing.when)
  return false
}

function monthlyMatch(date: string, when: '1' | '15' | 'last'): boolean {
  const day = dayOf(date)
  if (when === '1') return day === 1
  if (when === '15') return day === 15
  return day === lastDayOfMonth(date)
}

function localDates(fromMs: number, toMs: number, timeZone: string): string[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return []
  const dates: string[] = []
  let cursor = startOfLocalDay(fromMs, timeZone)
  const endKey = localDateKey(toMs, timeZone)
  for (let step = 0; step < MAX_DAYS; step += 1) {
    const key = localDateKey(cursor, timeZone)
    dates.push(key)
    if (key >= endKey) break
    cursor = addLocalDays(cursor, timeZone, 1)
  }
  return dates
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
  if (match === null) throw new EmailError('Invalid date', 'invalid')
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
