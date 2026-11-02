import { ScheduleError } from './errors'

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** `HH:MM` 24-hour, as minutes from local midnight. */
export function parseClockTime(value: string, label: string): number {
  const match = HH_MM.exec(value)
  if (match === null) throw new ScheduleError(`${label} must be HH:MM in 24-hour time`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour * 60 + minute
}

export function parseInstant(value: string, label: string): number {
  if (!ISO_UTC.test(value)) throw new ScheduleError(`${label} must be ISO-8601 UTC`)
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new ScheduleError(`${label} must be ISO-8601 UTC`)
  return parsed
}

/** ISO-8601 UTC with millisecond precision, matching `Date.toISOString`. */
export function formatInstant(nowMs: number): string {
  return new Date(nowMs).toISOString()
}
