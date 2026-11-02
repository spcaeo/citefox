import { formatMoment } from '../../../utils/dates'

// The computer's own zone: a desktop app shows its own time, not UTC (owner, 2026-10-29).
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DATE_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})
function valid(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "Oct 19". */
export function formatDate(iso: string): string {
  const date = valid(iso)
  return date ? DATE.format(date) : ''
}

/** "Oct 19, 2026". */
export function formatDateYear(iso: string): string {
  const date = valid(iso)
  return date ? DATE_YEAR.format(date) : ''
}

/** "Oct 19, 9:14 AM", in the computer's own zone and clock style. */
export function formatDateTime(iso: string): string {
  return formatCheckTime(iso)
}

/** When a check ran: "Oct 29, 3:12 PM", in the computer's own zone and clock style. */
export function formatCheckTime(iso: string): string {
  return valid(iso) ? formatMoment(iso) : ''
}

/** "42%", or "—" when there is nothing to divide by. */
export function formatPct(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`
}

/** "3 questions" / "1 question". */
export function countOf(count: number, noun: readonly [string, string]): string {
  return `${count} ${count === 1 ? noun[0] : noun[1]}`
}
