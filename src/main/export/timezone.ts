import { formatMoment } from '@shared/moment'

const DAY_MS = 86_400_000

/** True when `value` is an IANA zone `Intl` accepts, such as `America/Toronto`. */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false
  if (value !== value.trim()) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/**
 * Calendar date `YYYY-MM-DD` of an ISO-8601 instant in `timeZone`.
 * Replaces the UTC `finishedAt.slice(0, 10)` day.
 */
export function calendarDay(iso: string, timeZone: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso.slice(0, 10)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(parsed))
  const year = part(parts, 'year')
  const month = part(parts, 'month')
  const day = part(parts, 'day')
  return `${year}-${month}-${day}`
}

/**
 * Inclusive UTC bounds for calendar dates `fromDay` and `toDay` in `timeZone`.
 * `CheckReadFilter.from` and `to` compare these to `runs.finished_at`.
 */
export function inclusiveFinishedBounds(
  fromDay: string,
  toDay: string,
  timeZone: string
): { from: string; to: string } {
  const start = zonedMidnightUtc(fromDay, timeZone)
  const end = zonedMidnightUtc(nextCalendarDay(toDay), timeZone) - 1
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
}

function zonedMidnightUtc(day: string, timeZone: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(year, month - 1, date)
  return guess - offsetMs(guess - offsetMs(guess, timeZone), timeZone)
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(utcMs))
  let year = Number(part(parts, 'year'))
  let month = Number(part(parts, 'month'))
  let day = Number(part(parts, 'day'))
  let hour = Number(part(parts, 'hour'))
  const minute = Number(part(parts, 'minute'))
  const second = Number(part(parts, 'second'))
  if (hour === 24) {
    hour = 0
    const shifted = new Date(Date.UTC(year, month - 1, day) + DAY_MS)
    year = shifted.getUTCFullYear()
    month = shifted.getUTCMonth() + 1
    day = shifted.getUTCDate()
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - utcMs
}

function nextCalendarDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(year, month - 1, date) + DAY_MS)
  return calendarDay(next.toISOString(), 'UTC')
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '0'
}

/**
 * A report date in `timeZone`, such as `Oct 19, 2026`.
 * With `withTime`, the clock follows the computer's own style, never a forced 24-hour
 * clock (`Oct 19, 2026, 10:00 PM`; `locale` is for tests). The day alone is built from
 * date parts so it does not depend on the machine locale.
 */
export function formatExportDate(
  iso: string,
  timeZone: string,
  withTime = false,
  locale?: string
): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  if (withTime) return formatMoment(iso, { timeZone, locale, year: true })
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).formatToParts(new Date(parsed))
  return `${part(parts, 'month')} ${part(parts, 'day')}, ${part(parts, 'year')}`
}
