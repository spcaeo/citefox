import type { GridPageSize, GridSortKey, GridViewState } from '@shared/domain'
import type { FacetFilter, GridColumn, GridGroupOption, SortValue } from '../types'

/**
 * The grid's row pipeline (FR-21.1, FR-21.4, NFR-12): search, facet and range
 * filters, multi-key sort, grouping and paging. Rows are addressed by index so
 * search text and sort values are computed once per row list, not per keystroke.
 */
export interface RowIndex<Row> {
  rows: readonly Row[]
  /** Lowercase search text per row. Empty when the grid has no search. */
  text: readonly string[]
  /** Sort values per column id, filled the first time a column is sorted. */
  sortCache: Map<string, readonly SortValue[]>
}

export function buildRowIndex<Row>(
  rows: readonly Row[],
  searchText: ((row: Row) => string) | undefined
): RowIndex<Row> {
  return {
    rows,
    text: searchText ? rows.map((row) => searchText(row).toLowerCase()) : [],
    sortCache: new Map()
  }
}

/** Indices of rows that pass the search and every filter except `skip` (for facet counts). */
export function matchingIndices<Row>(
  index: RowIndex<Row>,
  state: Pick<GridViewState, 'search' | 'filters' | 'ranges'>,
  columns: readonly GridColumn<Row>[],
  skip: string | null = null
): number[] {
  const needle = state.search.trim().toLowerCase()
  const facets: { filter: FacetFilter<Row>; on: ReadonlySet<string> }[] = []
  const ranges: {
    value: (row: Row) => number | null
    min: number | null
    below: number | null
  }[] = []
  for (const column of columns) {
    if (column.id === skip || !column.filter) continue
    if (column.filter.kind === 'facet') {
      const on = state.filters[column.id]
      if (on && on.length > 0) facets.push({ filter: column.filter, on: new Set(on) })
    } else {
      const range = state.ranges[column.id]
      if (range && (range.min !== null || range.below !== null)) {
        ranges.push({ value: column.filter.value, min: range.min, below: range.below })
      }
    }
  }
  const result: number[] = []
  const { rows, text } = index
  for (let at = 0; at < rows.length; at += 1) {
    if (needle.length > 0 && !(text[at] ?? '').includes(needle)) continue
    const row = rows[at] as Row
    let ok = true
    for (const facet of facets) {
      if (!facet.filter.values(row).some((value) => facet.on.has(value))) {
        ok = false
        break
      }
    }
    if (!ok) continue
    for (const range of ranges) {
      const value = range.value(row)
      if (value === null) {
        ok = false
        break
      }
      if (range.min !== null && value < range.min) ok = false
      if (range.below !== null && value >= range.below) ok = false
      if (!ok) break
    }
    if (ok) result.push(at)
  }
  return result
}

export interface FacetOption {
  value: string
  label: string
  /** Rows with this value that pass the search and the other filters. */
  count: number
  checked: boolean
}

/** FR-21.1. Every value the column has, with counts that reflect the other filters. */
export function facetOptions<Row>(
  index: RowIndex<Row>,
  state: Pick<GridViewState, 'search' | 'filters' | 'ranges'>,
  columns: readonly GridColumn<Row>[],
  column: GridColumn<Row>
): FacetOption[] {
  const filter = column.filter
  if (!filter || filter.kind !== 'facet') return []
  const counts = new Map<string, number>()
  for (const row of index.rows) {
    for (const value of filter.values(row)) if (!counts.has(value)) counts.set(value, 0)
  }
  for (const value of state.filters[column.id] ?? []) if (!counts.has(value)) counts.set(value, 0)
  for (const at of matchingIndices(index, state, columns, column.id)) {
    for (const value of new Set(filter.values(index.rows[at] as Row))) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  const on = new Set(state.filters[column.id] ?? [])
  const label = filter.label ?? ((value: string) => value)
  const order = filter.order ?? []
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count, checked: on.has(value) }))
    .sort((left, right) => {
      const a = order.indexOf(left.value)
      const b = order.indexOf(right.value)
      if (a !== -1 || b !== -1) return (a === -1 ? order.length : a) - (b === -1 ? order.length : b)
      return left.label.localeCompare(right.label)
    })
}

function sortValues<Row>(index: RowIndex<Row>, column: GridColumn<Row>): readonly SortValue[] {
  const cached = index.sortCache.get(column.id)
  if (cached) return cached
  const accessor = column.sort
  const values = accessor
    ? index.rows.map((row) => {
        const value = accessor(row)
        return typeof value === 'string' ? value.toLowerCase() : value
      })
    : index.rows.map(() => null)
  index.sortCache.set(column.id, values)
  return values
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function compareSortValues(a: SortValue, b: SortValue): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/** Multi-key sort in priority order. Empty values sort last; ties keep the source order. */
export function sortIndices<Row>(
  index: RowIndex<Row>,
  indices: readonly number[],
  sort: readonly GridSortKey[],
  columns: readonly GridColumn<Row>[]
): number[] {
  const keys = sort.flatMap((key) => {
    const column = columns.find((item) => item.id === key.key)
    if (!column?.sort) return []
    return [{ values: sortValues(index, column), desc: key.dir === 'desc' }]
  })
  const result = [...indices]
  if (keys.length === 0) return result
  result.sort((left, right) => {
    for (const key of keys) {
      const a = key.values[left] ?? null
      const b = key.values[right] ?? null
      if (a === null || b === null) {
        if (a === b) continue
        return a === null ? 1 : -1
      }
      const compared = compareSortValues(a, b)
      if (compared !== 0) return key.desc ? -compared : compared
    }
    return left - right
  })
  return result
}

export interface RowGroup {
  key: string
  label: string
  indices: number[]
}

/** Groups keep the sorted order of their rows. */
export function groupIndices<Row>(
  index: RowIndex<Row>,
  sorted: readonly number[],
  option: GridGroupOption<Row>
): RowGroup[] {
  const groups = new Map<string, RowGroup>()
  for (const at of sorted) {
    const { key, label } = option.key(index.rows[at] as Row)
    const group = groups.get(key)
    if (group) group.indices.push(at)
    else groups.set(key, { key, label, indices: [at] })
  }
  const order = option.order ?? []
  return [...groups.values()].sort((left, right) => {
    const a = order.indexOf(left.key)
    const b = order.indexOf(right.key)
    if (a !== -1 || b !== -1) return (a === -1 ? order.length : a) - (b === -1 ? order.length : b)
    return collator.compare(left.label, right.label)
  })
}

export interface PageSlice {
  /** 1-based page, clamped to the last page. */
  page: number
  pages: number
  start: number
  end: number
}

export function pageSlice(total: number, pageSize: GridPageSize, page: number): PageSlice {
  if (pageSize === 'all' || total === 0) return { page: 1, pages: 1, start: 0, end: total }
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * pageSize
  return { page: current, pages, start, end: Math.min(total, start + pageSize) }
}

/** One line of the table body: a group header or a row. */
export type TableLine =
  | { kind: 'group'; key: string; label: string; count: number; indices: number[]; open: boolean }
  | { kind: 'row'; index: number }

/**
 * The table's lines for one page. With grouping, rows are ordered by group and a
 * header opens each group that has rows on this page. Counts are the whole group.
 */
export function tableLines<Row>(
  index: RowIndex<Row>,
  sorted: readonly number[],
  option: GridGroupOption<Row> | null,
  slice: PageSlice,
  collapsed: ReadonlySet<string>
): { lines: TableLine[]; ordered: number[] } {
  if (option === null) {
    return {
      lines: sorted.slice(slice.start, slice.end).map((at) => ({ kind: 'row', index: at })),
      ordered: [...sorted]
    }
  }
  const groups = groupIndices(index, sorted, option)
  const ordered = groups.flatMap((group) => group.indices)
  const groupOf = new Map<number, RowGroup>()
  for (const group of groups) for (const at of group.indices) groupOf.set(at, group)
  const lines: TableLine[] = []
  let last: RowGroup | null = null
  for (const at of ordered.slice(slice.start, slice.end)) {
    const group = groupOf.get(at)
    if (!group) continue
    if (group !== last) {
      last = group
      lines.push({
        kind: 'group',
        key: group.key,
        label: group.label,
        count: group.indices.length,
        indices: group.indices,
        open: !collapsed.has(group.key)
      })
    }
    if (!collapsed.has(group.key)) lines.push({ kind: 'row', index: at })
  }
  return { lines, ordered }
}

/** One line of the tree: a node or a leaf row. */
export type TreeLine =
  | { kind: 'node'; key: string; label: string; count: number; indices: number[]; open: boolean }
  | { kind: 'leaf'; index: number }

/**
 * The tree's lines. With no open set yet, the first node starts open, or every
 * node while a search or filter narrows the list.
 */
export function treeLines<Row>(
  index: RowIndex<Row>,
  sorted: readonly number[],
  option: GridGroupOption<Row>,
  open: ReadonlySet<string> | null,
  filtering: boolean
): { lines: TreeLine[]; open: ReadonlySet<string> } {
  const groups = groupIndices(index, sorted, option)
  const effective =
    open ??
    new Set(filtering ? groups.map((group) => group.key) : groups.slice(0, 1).map((g) => g.key))
  const lines: TreeLine[] = []
  for (const group of groups) {
    const isOpen = effective.has(group.key)
    lines.push({
      kind: 'node',
      key: group.key,
      label: group.label,
      count: group.indices.length,
      indices: group.indices,
      open: isOpen
    })
    if (isOpen) for (const at of group.indices) lines.push({ kind: 'leaf', index: at })
  }
  return { lines, open: effective }
}
