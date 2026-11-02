/**
 * The standard data grid (SRS section 4.21). Every list uses one grid component.
 * A saved view (FR-21.2) is the grid state below, stored in the project file
 * (section 10 `saved_views`: id, grid, name, state_json).
 */

import { isOneOf } from './one-of'

export const GRID_VIEW_MODES = ['table', 'cards', 'tree'] as const
export type GridViewMode = (typeof GRID_VIEW_MODES)[number]

export const GRID_DENSITIES = ['comfortable', 'compact'] as const
export type GridDensity = (typeof GRID_DENSITIES)[number]

/** FR-21.4. `all` shows every matching row in a virtualized list (NFR-12). */
export const GRID_PAGE_SIZES = [10, 25, 50, 'all'] as const
export type GridPageSize = (typeof GRID_PAGE_SIZES)[number]

export type GridSortDir = 'asc' | 'desc'

export interface GridSortKey {
  key: string
  dir: GridSortDir
}

/** A number range filter: `min` inclusive, `below` exclusive. Null is open. */
export interface GridRange {
  min: number | null
  below: number | null
}

/**
 * FR-21.2. Everything a saved view restores: search, filters, sort, columns,
 * density, view and column widths. Grouping, the tree level and the page size
 * are kept too so a view opens the way it was saved.
 */
export interface GridViewState {
  search: string
  /** Facet column id → the values that are on. An empty or missing list is no filter. */
  filters: Readonly<Record<string, readonly string[]>>
  /** Range column id → range. */
  ranges: Readonly<Record<string, GridRange>>
  /** Priority order. The first key is the primary sort. */
  sort: readonly GridSortKey[]
  /** Column ids the user hid. Fixed columns are never hidden. */
  hidden: readonly string[]
  /** Column id → width in CSS pixels. */
  widths: Readonly<Record<string, number>>
  density: GridDensity
  view: GridViewMode
  /** Group-by option id for the table. Null is no grouping. */
  groupBy: string | null
  /** Tree level option id. Null is the grid's first tree option. */
  treeBy: string | null
  pageSize: GridPageSize
}

/** One saved view. Ids and names are per grid and per project. */
export interface SavedGridView {
  id: string
  /** The grid this view belongs to, such as `all-pages`. */
  grid: string
  name: string
  state: GridViewState
  /** ISO-8601 UTC. */
  createdAt: string
  /** ISO-8601 UTC. */
  updatedAt: string
}

export const GRID_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
export const SAVED_VIEW_NAME_MAX = 80
export const GRID_WIDTH_MIN = 48
export const GRID_WIDTH_MAX = 960
/** Upper bound on a stored state so a saved view cannot grow without limit. */
export const GRID_STATE_JSON_MAX = 32_000

export function isGridViewMode(value: string): value is GridViewMode {
  return isOneOf(GRID_VIEW_MODES, value)
}

export function isGridDensity(value: string): value is GridDensity {
  return isOneOf(GRID_DENSITIES, value)
}

export function isGridPageSize(value: unknown): value is GridPageSize {
  return GRID_PAGE_SIZES.some((size) => size === value)
}

/**
 * A cluster or group the page belongs to (FR-19.5, FR-19.7).
 * The grid renders these through its membership column type.
 */
export interface GridMembership {
  id: string
  name: string
}
