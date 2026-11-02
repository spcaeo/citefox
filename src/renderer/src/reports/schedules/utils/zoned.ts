/**
 * Dates and times in a schedule's own time zone: the instant a send lands on,
 * day headings for Delivery history, and the next weekly or monthly slot.
 */

/** ISO weekday, 1 (Monday) through 7 (Sunday). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** The monthly slot: the 1st, the 15th or the last day. */
export type MonthDay = '1' | '15' | 'last'

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
}

export interface ZonedParts {
  year: string
  month: string
  day: string
  weekday: string
  hour: string
  minute: string
  monthNumber: string
  dayNumber: string
}

export function zonedParts(iso: string, timeZone: string): ZonedParts | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    formatted.find((part) => part.type === type)?.value ?? ''
  const numeric = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes): string =>
    numeric.find((part) => part.type === type)?.value ?? ''
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    weekday: pick('weekday'),
    hour: pick('hour'),
    minute: pick('minute'),
    monthNumber: num('month'),
    dayNumber: num('day')
  }
}

export function formatInstant(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone)
  if (!parts) return '—'
  return `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`
}

export function formatDayHeading(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone)
  if (!parts) return iso
  return `${parts.weekday}, ${parts.month} ${parts.day}`
}

export function localDayKey(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone)
  if (!parts) return iso.slice(0, 10)
  return `${parts.year}-${parts.monthNumber}-${parts.dayNumber}`
}

export function nextWeekly(day: Weekday, time: string, timeZone: string, now: Date): string {
  const current = calendarIn(now, timeZone)
  let add = (day - current.weekday + 7) % 7
  if (add === 0 && clockPassed(time, current)) add = 7
  const date = addDays(current, add)
  return headingFor(date)
}

export function nextMonthly(when: MonthDay, time: string, timeZone: string, now: Date): string {
  const current = calendarIn(now, timeZone)
  const candidate = monthlyDate(current.year, current.month, when)
  const past =
    candidate.day < current.day ||
    (candidate.day === current.day && clockPassed(time, current)) ||
    candidate.month < current.month
  if (!past && candidate.year === current.year && candidate.month === current.month) {
    return headingFor(candidate)
  }
  const nextMonth = current.month === 12 ? 1 : current.month + 1
  const nextYear = current.month === 12 ? current.year + 1 : current.year
  return headingFor(monthlyDate(nextYear, nextMonth, when))
}

function monthlyDate(year: number, month: number, when: MonthDay): CalendarDate {
  const day = when === 'last' ? lastUtcDay(year, month) : when === '15' ? 15 : 1
  return { year, month, day, weekday: utcWeekday(year, month, day) }
}

function headingFor(date: CalendarDate): string {
  const stamp = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)))
  return stamp
}

interface CalendarDate {
  year: number
  month: number
  day: number
  weekday: number
}

function calendarIn(now: Date, timeZone: string): CalendarDate & { hour: number; minute: number } {
  const parts = zonedParts(now.toISOString(), timeZone)
  const weekday = WEEKDAY_INDEX[parts?.weekday ?? 'Mon'] ?? 1
  return {
    year: Number(parts?.year ?? '1970'),
    month: Number(parts?.monthNumber ?? '1'),
    day: Number(parts?.dayNumber ?? '1'),
    weekday,
    hour: Number(parts?.hour ?? '0'),
    minute: Number(parts?.minute ?? '0')
  }
}

function clockPassed(time: string, current: { hour: number; minute: number }): boolean {
  const hour = Number(time.split(':')[0])
  const minute = Number(time.split(':')[1])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  return current.hour > hour || (current.hour === hour && current.minute >= minute)
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12))
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    weekday: utc.getUTCDay() === 0 ? 7 : utc.getUTCDay()
  }
}

function lastUtcDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function utcWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}
