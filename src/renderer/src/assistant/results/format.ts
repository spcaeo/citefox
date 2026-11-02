import { formatMoment } from '../../utils/dates'

/** "Oct 19, 3:12 PM" for a stored check, in the computer's own zone and clock (audit #8). */
export function checkedDay(iso: string | null): string {
  return formatMoment(iso)
}

/** "#2", or a dash when the page has no citation position. */
export function positionText(position: number | null): string {
  return position === null ? '—' : `#${Math.round(position * 10) / 10}`
}
