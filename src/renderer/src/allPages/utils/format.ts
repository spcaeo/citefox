import type { BulkEstimate } from '@shared/ipc'
import { formatDay } from '../../utils/dates'

export function estimateRange(min: number, max: number): string {
  return `${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}`
}

/** "Today", or "Oct 19" in local time (NFR-15). */
export function dayLabel(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  if (date.toDateString() === now.toDateString()) return 'Today'
  return formatDay(iso, { year: date.getFullYear() !== now.getFullYear() })
}

export function changeLabel(change: number | null): string {
  if (change === null) return '—'
  if (change > 0) return `+${change}`
  if (change < 0) return `−${Math.abs(change)}`
  return '0'
}

export function changeClass(change: number | null): string {
  if (change === null) return 'faint'
  return change > 0 ? 'ap-up' : change < 0 ? 'ap-down' : 'faint'
}

/** "3 of 8" prompts, or a dash before a check. */
export function citedLabel(cited: number | null, of: number | null): string {
  if (cited === null || of === null) return '—'
  return `${cited} of ${of}`
}

/** One line under the bulk bar with the cost and what is skipped. */
export function estimateDetail(estimate: BulkEstimate): string {
  const skipped = estimate.skipped
    .map((skip) => `${skip.count.toLocaleString('en-US')} ${skip.reason}`)
    .join(', ')
  return skipped.length > 0 ? `${estimate.summary} Skips ${skipped}.` : estimate.summary
}

export function pathOf(url: string | null): string {
  if (url === null) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

export function folderLabel(folder: string | null): string {
  return folder === null || folder === '' ? '(Top level)' : `/${folder}/`
}
