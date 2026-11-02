import type { GridSortKey, GridViewState } from '@shared/domain'
import type { GridColumn } from '../types'

export function count(value: number, noun: readonly [string, string]): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? noun[0] : noun[1]}`
}

/**
 * FR-21.5. Always "Showing X of Y". X is what is on screen, Y what matches.
 * When filters or search narrow the list, the full count follows.
 */
export function showingLabel(
  shown: number,
  matching: number,
  total: number,
  noun: readonly [string, string]
): string {
  const base =
    shown === matching
      ? `Showing ${count(shown, noun)}`
      : `Showing ${shown.toLocaleString('en-US')} of ${count(matching, noun)}`
  if (matching === total) return base
  return `${base} · ${total.toLocaleString('en-US')} in all, filtered`
}

/** FR-21.7. A sort header's accessible name states its sort order. */
export function sortButtonLabel(
  column: { label: string },
  sort: readonly GridSortKey[],
  id: string
): string {
  return `${column.label}${sortStateText(sort, id)}`
}

/** The part of the sort header's name after the column label, read by screen readers only. */
export function sortStateText(sort: readonly GridSortKey[], id: string): string {
  const at = sort.findIndex((item) => item.key === id)
  if (at < 0) return ', not sorted. Activate to sort; hold Shift to add a second sort.'
  const dir = sort[at]?.dir === 'asc' ? 'ascending' : 'descending'
  const rank = sort.length > 1 ? `, sort ${at + 1} of ${sort.length}` : ''
  return `, sorted ${dir}${rank}. Activate to change; hold Shift to add a second sort.`
}

export function ariaSort(
  sort: readonly GridSortKey[],
  id: string
): 'ascending' | 'descending' | 'none' {
  const first = sort[0]
  if (!first || first.key !== id) return 'none'
  return first.dir === 'asc' ? 'ascending' : 'descending'
}

/** FR-21.6. Why nothing matches. */
export function emptyReason<Row>(
  state: GridViewState,
  columns: readonly GridColumn<Row>[],
  noun: readonly [string, string]
): string {
  const parts: string[] = []
  const search = state.search.trim()
  if (search.length > 0) parts.push(`the search “${search}”`)
  const named = columns.filter(
    (column) => (state.filters[column.id]?.length ?? 0) > 0 || state.ranges[column.id] !== undefined
  )
  if (named.length > 0) {
    const list = named.map((column) => column.label.toLowerCase()).join(', ')
    parts.push(`the ${list} ${named.length === 1 ? 'filter' : 'filters'}`)
  }
  if (parts.length === 0) return `No ${noun[1]} to show.`
  return `No ${noun[1]} match ${parts.join(' and ')}.`
}

/** `example-all-pages-2026-10-20.csv`, using the local date. */
export function csvFileName(base: string, now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export'
  return `${safe}-${date}.csv`
}

export function rangeChip(label: string, min: number | null, below: number | null): string {
  if (min !== null && below !== null) return `${label} ${min} to under ${below}`
  if (min !== null) return `${label} ≥ ${min}`
  return `${label} < ${below ?? ''}`
}
