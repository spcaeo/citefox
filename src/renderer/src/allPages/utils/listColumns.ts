import type { AllPageRow } from '@shared/ipc'
import type { GridColumn, GridGroupOption } from '../../grid'
import type { ListColumn, ListGroup } from '../../ui'
import { groupSummary } from './columns'

/** v2 list-grid widths. `page` takes the rest of the row. */
const WIDTHS: Readonly<Record<string, number | 'fill'>> = {
  page: 'fill',
  url: 220,
  folder: 112,
  cluster: 136,
  group: 120,
  markets: 136,
  score: 96,
  change: 72,
  cited: 88,
  citations: 120,
  last: 96,
  next: 88,
  updated: 112,
  published: 112,
  read: 144,
  unlogged: 168,
  prompts: 72,
  interval: 88,
  status: 104,
  pin: 72
}

/** Numeric columns: right-aligned, tabular. */
const NUMERIC = new Set(['change', 'cited', 'citations', 'prompts'])

/**
 * Columns hidden until turned on in "Choose columns". Folder is the default
 * grouping, so its column starts hidden; the rest are the old picker's extras.
 */
export const DEFAULT_HIDDEN: readonly string[] = [
  'url',
  'folder',
  'cluster',
  'group',
  'markets',
  'last',
  'published',
  'read',
  'unlogged',
  'prompts',
  'interval',
  'pin'
]

/** The grid columns that are switched on, as v2 list columns. */
export function toListColumns(
  columns: readonly GridColumn<AllPageRow>[],
  hidden: readonly string[]
): ListColumn<AllPageRow>[] {
  return columns
    .filter((column) => column.fixed || !hidden.includes(column.id))
    .map((column) => {
      const width = WIDTHS[column.id] ?? column.width
      return {
        id: column.id,
        label: column.label,
        width,
        ...(width === 'fill' ? { minWidth: 180 } : {}),
        ...(NUMERIC.has(column.id) ? { numeric: true } : {}),
        ...(column.align ? { align: column.align } : {}),
        ...(column.sort ? { sort: column.sort } : {}),
        render: column.render,
        ...(column.drill ? { drill: column.drill } : {}),
        ...(column.id === 'url' ? { cellClassName: 'mono' } : {})
      }
    })
}

/** A grid group option as a list-grid group with "12 pages · avg score 41 · 8 tracked". */
export function toListGroup(option: GridGroupOption<AllPageRow>): ListGroup<AllPageRow> {
  return {
    key: option.key,
    ...(option.order ? { order: option.order } : {}),
    meta: (rows) => groupSummary(rows)
  }
}
