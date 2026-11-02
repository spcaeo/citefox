/**
 * Day and clock labels for the whole renderer. `timeZone` defaults to the
 * computer's zone. Invalid or missing instants read as an em dash.
 */

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

export interface MomentOptions {
  timeZone?: string
  /** Today, for "this year". Default now. */
  now?: Date
  /** The clock's language; default the computer's own, so 12- or 24-hour follows it. */
  locale?: string
}

/**
 * When something happened, as the computer shows it: "Oct 29, 3:12 PM" in its own
 * zone and clock style, with the year only when it is not this year
 * ("Oct 29, 2025, 3:12 PM"). Two checks on one day read apart (owner, 2026-10-29).
 */
export function formatMoment(iso: string | null, options: MomentOptions = {}): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const { timeZone, locale } = options
  const year = (value: Date): string =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(value)
  const sameYear = year(date) === year(options.now ?? new Date())
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

/**
 * A date that may be a picked day or a real moment: a day someone picked (stored
 * as local midnight, such as a fix's "Goes live on") reads as its day, "Oct 19";
 * any other instant reads as formatMoment, "Oct 19, 3:12 PM", so an event never
 * shows a made-up "12:00 AM" (audit #8).
 */
export function formatWhen(iso: string | null, options: MomentOptions = {}): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const { timeZone, locale, now } = options
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date)
  if (clock !== '00:00:00') return formatMoment(iso, options)
  const year = (value: Date): string =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(value)
  const sameYear = year(date) === year(now ?? new Date())
  return formatDay(iso, { timeZone, locale, year: !sameYear })
}
