import { monthKey, utcFromLocal } from '../../scheduler/local-time'

/** The computer's timezone. Usage months are keyed in it (SERP-6). */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export interface MonthWindow {
  /** `YYYY-MM`. */
  month: string
  /** ISO-8601 UTC of local midnight on the 1st. */
  start: string
  /** ISO-8601 UTC of local midnight on the 1st of next month. */
  end: string
  /** `YYYY-MM-DD` of the 1st of next month, when caps reset. */
  resetsOn: string
  /** Days in the month, and how far into it `now` is (0–1]. */
  days: number
  elapsed: number
}

/** The local calendar month containing `now`, in `timeZone`. */
export function monthWindow(now: Date, timeZone: string = localZone()): MonthWindow {
  const month = monthKey(now.getTime(), timeZone)
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const index = Number(monthText)
  const nextYear = index === 12 ? year + 1 : year
  const nextIndex = index === 12 ? 1 : index + 1
  const startMs = utcFromLocal({ year, month: index, day: 1, hour: 0, minute: 0 }, timeZone)
  const endMs = utcFromLocal(
    { year: nextYear, month: nextIndex, day: 1, hour: 0, minute: 0 },
    timeZone
  )
  const days = Math.round((endMs - startMs) / 86_400_000)
  const elapsed = Math.min(
    1,
    Math.max(1 / (days * 24), (now.getTime() - startMs) / (endMs - startMs))
  )
  return {
    month,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    resetsOn: `${String(nextYear).padStart(4, '0')}-${String(nextIndex).padStart(2, '0')}-01`,
    days,
    elapsed
  }
}

/** Straight-line pace to month end. Null before any use. */
export function projectedMonthEnd(used: number, window: MonthWindow): number | null {
  if (used <= 0) return null
  return Math.round(used / window.elapsed)
}
