import { ScheduleError } from './errors'

/** Minutes from local midnight. End is exclusive. `startMinute === endMinute` is no quiet period. */
export interface MinuteWindow {
  startMinute: number
  endMinute: number
}

export interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Throws {@link ScheduleError} when `timeZone` is not an IANA name Intl accepts. */
export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
  } catch {
    throw new ScheduleError(`Unknown time zone: ${timeZone}`)
  }
}

export function localParts(nowMs: number, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const map = new Map<string, string>()
  for (const part of fmt.formatToParts(new Date(nowMs))) {
    if (part.type !== 'literal') map.set(part.type, part.value)
  }
  let hour = numberPart(map, 'hour')
  if (hour === 24) hour = 0
  return {
    year: numberPart(map, 'year'),
    month: numberPart(map, 'month'),
    day: numberPart(map, 'day'),
    hour,
    minute: numberPart(map, 'minute'),
    second: numberPart(map, 'second')
  }
}

/** `YYYY-MM-DD` in `timeZone`. SCH-2 uses this as the due-pass day. */
export function localDateKey(nowMs: number, timeZone: string): string {
  const parts = localParts(nowMs, timeZone)
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
}

/** `YYYY-MM` in `timeZone`. Usage months are keyed this way. */
export function monthKey(nowMs: number, timeZone: string): string {
  const parts = localParts(nowMs, timeZone)
  return `${pad(parts.year, 4)}-${pad(parts.month)}`
}

export function minuteOfDay(nowMs: number, timeZone: string): number {
  const parts = localParts(nowMs, timeZone)
  return parts.hour * 60 + parts.minute
}

/** Wall-clock `parts` in `timeZone`, as epoch ms. */
export function utcFromLocal(
  parts: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second?: number
  },
  timeZone: string
): number {
  const second = parts.second ?? 0
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, second)
  const firstOffset = timeZoneOffsetMs(guess, timeZone)
  let utc = guess - firstOffset
  const secondOffset = timeZoneOffsetMs(utc, timeZone)
  if (secondOffset !== firstOffset) utc = guess - secondOffset
  return utc
}

/** Daily check instant on the local calendar day that contains `nowMs`. */
export function dailyCheckOnDay(nowMs: number, timeZone: string, dailyCheckMinute: number): number {
  const parts = localParts(nowMs, timeZone)
  return utcFromLocal(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: Math.floor(dailyCheckMinute / 60),
      minute: dailyCheckMinute % 60,
      second: 0
    },
    timeZone
  )
}

export function addLocalDays(nowMs: number, timeZone: string, days: number): number {
  const parts = localParts(nowMs, timeZone)
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return utcFromLocal(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second
    },
    timeZone
  )
}

/**
 * SCH-3, SCH-9. `startMinute === endMinute` is no quiet period.
 * A window that passes midnight has `startMinute > endMinute`.
 * The end minute is exclusive.
 */
export function isQuietAt(nowMs: number, timeZone: string, quiet: MinuteWindow): boolean {
  if (quiet.startMinute === quiet.endMinute) return false
  const minute = minuteOfDay(nowMs, timeZone)
  if (quiet.startMinute < quiet.endMinute) {
    return minute >= quiet.startMinute && minute < quiet.endMinute
  }
  return minute >= quiet.startMinute || minute < quiet.endMinute
}

/** First instant at or after `nowMs` that is outside quiet hours. */
export function quietEndInstant(nowMs: number, timeZone: string, quiet: MinuteWindow): number {
  if (!isQuietAt(nowMs, timeZone, quiet)) return nowMs
  const parts = localParts(nowMs, timeZone)
  let end = utcFromLocal(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: Math.floor(quiet.endMinute / 60),
      minute: quiet.endMinute % 60,
      second: 0
    },
    timeZone
  )
  if (end <= nowMs) end = addLocalDays(end, timeZone, 1)
  return end
}

function timeZoneOffsetMs(nowMs: number, timeZone: string): number {
  const parts = localParts(nowMs, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return asUtc - nowMs
}

function numberPart(map: Map<string, string>, key: string): number {
  const value = map.get(key)
  if (value === undefined) throw new ScheduleError(`Missing local time part: ${key}`)
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new ScheduleError(`Invalid local time part: ${key}`)
  return parsed
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}
