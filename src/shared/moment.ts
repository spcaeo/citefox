/**
 * When something happened, as the computer shows it (owner rule, 2026-10-29):
 * "Oct 29, 3:12 PM" in the computer's own zone and clock style, with the year only
 * when it is not this year ("Oct 29, 2025, 3:12 PM"). Never UTC, never a forced
 * 24-hour clock, never a date alone for an event. The renderer and the main process
 * both use this one helper; tests inject `timeZone` and `locale` to stay fixed.
 */

export interface MomentOptions {
  /** Default: the computer's zone. */
  timeZone?: string
  /** Today, for "this year". Default now. */
  now?: Date
  /** The clock's language; default the computer's own, so 12- or 24-hour follows it. */
  locale?: string
  /** Always write the year (for text an AI or a report reads). Default: only when not this year. */
  year?: boolean
}

/** "Oct 29, 3:12 PM"; an em dash for a missing or broken time. */
export function formatMoment(iso: string | null, options: MomentOptions = {}): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const { timeZone, locale } = options
  const yearOf = (value: Date): string =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(value)
  const withYear = options.year === true || yearOf(date) !== yearOf(options.now ?? new Date())
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
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
  const { timeZone, locale } = options
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date)
  if (clock !== '00:00:00') return formatMoment(iso, options)
  const yearOf = (value: Date): string =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(value)
  const withYear = options.year === true || yearOf(date) !== yearOf(options.now ?? new Date())
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {})
  }).format(date)
}
