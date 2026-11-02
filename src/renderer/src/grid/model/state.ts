import {
  GRID_WIDTH_MAX,
  GRID_WIDTH_MIN,
  type GridRange,
  type GridSortKey,
  type GridViewState
} from '@shared/domain'
import { cycleSort } from '../../utils/sort'
import type { GridColumn } from '../types'

export const DEFAULT_GRID_STATE: GridViewState = {
  search: '',
  filters: {},
  ranges: {},
  sort: [],
  hidden: [],
  widths: {},
  density: 'comfortable',
  view: 'table',
  groupBy: null,
  treeBy: null,
  pageSize: 25
}

/** The grid's starting state: defaults, then the columns hidden by default, then `initial`. */
export function initialGridState<Row>(
  columns: readonly GridColumn<Row>[],
  initial: Partial<GridViewState> = {}
): GridViewState {
  return {
    ...DEFAULT_GRID_STATE,
    hidden: columns.filter((column) => column.hiddenByDefault && !column.fixed).map((c) => c.id),
    ...initial
  }
}

/** A preset or saved view applied over the grid's starting state. */
export function applyView(base: GridViewState, view: Partial<GridViewState>): GridViewState {
  return { ...base, ...view }
}

export function toggleFacetValue(
  state: GridViewState,
  columnId: string,
  value: string
): GridViewState {
  const current = state.filters[columnId] ?? []
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  const filters = { ...state.filters }
  if (next.length === 0) delete filters[columnId]
  else filters[columnId] = next
  return { ...state, filters }
}

export function setRange(state: GridViewState, columnId: string, range: GridRange): GridViewState {
  const ranges = { ...state.ranges }
  if (range.min === null && range.below === null) delete ranges[columnId]
  else ranges[columnId] = range
  return { ...state, ranges }
}

export function clearColumnFilter(state: GridViewState, columnId: string): GridViewState {
  const filters = { ...state.filters }
  const ranges = { ...state.ranges }
  delete filters[columnId]
  delete ranges[columnId]
  return { ...state, filters, ranges }
}

export function clearFilters(state: GridViewState): GridViewState {
  return { ...state, filters: {}, ranges: {} }
}

/** FR-21.6 "Clear search and filters". */
export function clearSearchAndFilters(state: GridViewState): GridViewState {
  return { ...state, search: '', filters: {}, ranges: {} }
}

export function activeFilterCount(state: GridViewState): number {
  let count = Object.keys(state.ranges).length
  for (const values of Object.values(state.filters)) count += values.length
  return count
}

/** FR-21.1. Click sorts by one column; Shift-click adds or cycles a further sort. */
export function sortByColumn(
  state: GridViewState,
  columnId: string,
  additive: boolean
): GridViewState {
  return { ...state, sort: cycleSort<string>(state.sort, columnId, additive) }
}

/** The "Sort by" menu: the picked column becomes the first sort and keeps any others after it. */
export function setPrimarySort<Row>(
  state: GridViewState,
  columns: readonly GridColumn<Row>[],
  columnId: string | null
): GridViewState {
  if (columnId === null) return { ...state, sort: [] }
  const existing = state.sort.find((item) => item.key === columnId)
  const column = columns.find((item) => item.id === columnId)
  const first: GridSortKey = { key: columnId, dir: existing?.dir ?? column?.defaultDir ?? 'asc' }
  return { ...state, sort: [first, ...state.sort.filter((item) => item.key !== columnId)] }
}

export function flipPrimarySort(state: GridViewState): GridViewState {
  const [first, ...rest] = state.sort
  if (!first) return state
  return {
    ...state,
    sort: [{ key: first.key, dir: first.dir === 'asc' ? 'desc' : 'asc' }, ...rest]
  }
}

export function toggleColumn(state: GridViewState, columnId: string): GridViewState {
  return {
    ...state,
    hidden: state.hidden.includes(columnId)
      ? state.hidden.filter((id) => id !== columnId)
      : [...state.hidden, columnId]
  }
}

export function clampWidth<Row>(column: GridColumn<Row>, width: number): number {
  const min = Math.max(GRID_WIDTH_MIN, column.minWidth ?? GRID_WIDTH_MIN)
  return Math.min(GRID_WIDTH_MAX, Math.max(min, Math.round(width)))
}

export function setWidth<Row>(
  state: GridViewState,
  column: GridColumn<Row>,
  width: number
): GridViewState {
  return { ...state, widths: { ...state.widths, [column.id]: clampWidth(column, width) } }
}

export function columnWidth<Row>(state: GridViewState, column: GridColumn<Row>): number {
  return state.widths[column.id] ?? column.width
}

export function visibleColumns<Row>(
  state: GridViewState,
  columns: readonly GridColumn<Row>[]
): GridColumn<Row>[] {
  return columns.filter((column) => column.fixed || !state.hidden.includes(column.id))
}

/** Two states are the same view when every saved field matches. */
export function sameView(left: GridViewState, right: GridViewState): boolean {
  return JSON.stringify(normalizeForCompare(left)) === JSON.stringify(normalizeForCompare(right))
}

function normalizeForCompare(state: GridViewState): GridViewState {
  const sortObject = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
  return {
    ...state,
    filters: sortObject(state.filters),
    ranges: sortObject(state.ranges),
    widths: sortObject(state.widths),
    hidden: [...state.hidden].sort()
  }
}
