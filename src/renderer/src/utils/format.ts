import { formatClock, formatDay } from './dates'

/**
 * The grid standard's value formats (grid audit R8, R9), one place for every
 * screen: empty is "—" and a real zero is "0"; no change is "—", never "+0";
 * dates are "Oct 19" this year and "Oct 19, 2025" otherwise, with the time in
 * the tooltip; percents are whole; point changes read "+11 pts" / "−3 pts";
 * money is "$0.03"; counts have thousands separators; ranges are "2–4".
 * Day labels come from utils/dates, so the computer's time zone applies.
 */

/** The faint empty value. */
export const EMPTY = '—'
/** The minus sign (U+2212), not a hyphen, so "−3" lines up with "+3". */
export const MINUS = '−'

function missing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || Number.isNaN(value)
}

/** "1,204", "0", or "—" when there is no value. */
export function formatCount(value: number | null | undefined): string {
  return missing(value) ? EMPTY : Math.round(value).toLocaleString('en-US')
}

/** A whole-number percent from 0–100: "42%", "0%", or "—". */
export function formatPercent(value: number | null | undefined): string {
  return missing(value) ? EMPTY : `${Math.round(value)}%`
}

/** A whole percent of `part` in `whole`, or "—" when there is nothing to divide by. */
export function formatShare(part: number, whole: number): string {
  return whole > 0 ? formatPercent((part / whole) * 100) : EMPTY
}

/** Which way a change points, for its colour. A zero or missing change is `flat`. */
export type ChangeDirection = 'up' | 'down' | 'flat'

export function changeDirection(delta: number | null | undefined): ChangeDirection {
  if (missing(delta) || Math.round(delta) === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/** "+3", "−2", or "—" for no change (never "+0"). `suffix` follows the number. */
export function formatSigned(delta: number | null | undefined, suffix = ''): string {
  const direction = changeDirection(delta)
  if (direction === 'flat' || missing(delta)) return EMPTY
  const size = Math.abs(Math.round(delta)).toLocaleString('en-US')
  return `${direction === 'up' ? '+' : MINUS}${size}${suffix}`
}

/** A change in percentage points: "+11 pts", "−3 pts", "+1 pt", or "—". */
export function formatPoints(delta: number | null | undefined): string {
  if (missing(delta)) return EMPTY
  return formatSigned(delta, Math.abs(Math.round(delta)) === 1 ? ' pt' : ' pts')
}

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** "$0.03", "$1,204.50", "$0.00" for a real zero, or "—". A cost under a cent reads "<$0.01". */
export function formatMoney(value: number | null | undefined): string {
  if (missing(value)) return EMPTY
  if (value > 0 && value < 0.005) return '<$0.01'
  return MONEY.format(value)
}

/** "2–4", "3" when both ends match, or "—". */
export function formatRange(
  low: number | null | undefined,
  high: number | null | undefined
): string {
  if (missing(low) && missing(high)) return EMPTY
  if (missing(low)) return formatCount(high)
  if (missing(high) || Math.round(low) === Math.round(high)) return formatCount(low)
  return `${formatCount(low)}–${formatCount(high)}`
}

/** "1 / 2": one value for a part of a whole. */
export function formatOutOf(
  part: number | null | undefined,
  whole: number | null | undefined
): string {
  if (missing(part) || missing(whole)) return EMPTY
  return `${formatCount(part)} / ${formatCount(whole)}`
}

export interface GridDateOptions {
  /** Today, for "this year". Default now. */
  now?: Date
  timeZone?: string
}

function yearOf(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(date)
}

/** A date in a grid cell: "Oct 19" this year, "Oct 19, 2025" in another year, or "—". */
export function formatGridDate(
  iso: string | null | undefined,
  options: GridDateOptions = {}
): string {
  if (!iso) return EMPTY
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EMPTY
  const { timeZone } = options
  const sameYear = yearOf(date, timeZone) === yearOf(options.now ?? new Date(), timeZone)
  return formatDay(iso, { timeZone, year: !sameYear })
}

/** The full date and time for a date cell's tooltip: "Oct 19, 2026, 18:30", or "". */
export function formatGridDateTitle(
  iso: string | null | undefined,
  options: { timeZone?: string } = {}
): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return ''
  return `${formatDay(iso, options)}, ${formatClock(iso, options)}`
}
