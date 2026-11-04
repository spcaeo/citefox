/**
 * Day and clock labels for the whole renderer. `timeZone` defaults to the
 * computer's zone. Invalid or missing instants read as an em dash.
 */

import { formatMoment, formatWhen, type MomentOptions } from '@shared/moment'

export interface DayOptions {
  timeZone?: string
  /** Include the year ("Oct 19, 2026"). Default true. */
  year?: boolean
  /**
   * The date's language; default the computer's own, so the day order follows it
   * ("Oct 19, 2026" in the US, "19 Oct 2026" in the UK), like formatMoment (audit #8).
   */
  locale?: string
}

/**
 * "Oct 19, 2026", or "Oct 19" with `year: false`, in the computer's own day order
 * and zone: the same order as formatMoment, so a day group and its rows agree.
 */
export function formatDay(iso: string | null, options: DayOptions = {}): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    month: 'short',
    day: 'numeric',
    ...(options.year === false ? {} : { year: 'numeric' })
  }).format(date)
}

export interface ClockOptions {
  timeZone?: string
  /** The clock's language; default the computer's own, so 12- or 24-hour follows it. */
  locale?: string
}

/**
 * "3:12 PM" or "15:12": the time of day in the computer's own zone and clock style,
 * never a forced 24-hour clock (owner, 2026-10-29).
 */
export function formatClock(iso: string | null, options: ClockOptions = {}): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

/**
 * "Oct 29, 3:12 PM" in the computer's own zone and clock style (shared with the main
 * process, see `@shared/moment`). Two checks on one day read apart (owner, 2026-10-29).
 */
export { formatMoment, type MomentOptions }

/**
 * A date that may be a picked day or a real moment (a fix's "Goes live on" is a picked
 * day, stored as local midnight): see `@shared/moment`. An event never shows a made-up
 * "12:00 AM" (audit #8).
 */
export { formatWhen }
