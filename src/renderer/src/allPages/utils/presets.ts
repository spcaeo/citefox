import type { GridSortKey, GridViewState } from '@shared/domain'
import type { GridPreset } from '../../grid'
import { DEFAULT_GRID_STATE } from '../../grid/model/state'
import { DEFAULT_HIDDEN } from './listColumns'
import { WORKING_STATUSES } from './views'

export const ALL_PAGES_GRID = 'all-pages'

/** The grid's default order inside each folder group. */
export const DEFAULT_SORT: readonly GridSortKey[] = [{ key: 'score', dir: 'desc' }]

/** Built-in views (the toolbar's segmented filter). `#/pages?preset=` names them too. */
export const PRESETS: readonly GridPreset[] = [
  { id: 'all', label: 'All pages', state: {} },
  {
    // Counts like the "N tracked" tile: tracked, setting up and paused.
    id: 'tracked',
    label: 'Tracked pages',
    state: { filters: { status: [...WORKING_STATUSES] }, sort: [{ key: 'score', dir: 'desc' }] }
  },
  {
    id: 'lost',
    label: 'Lost citations',
    state: { filters: { change: ['lost'] }, sort: [{ key: 'change', dir: 'asc' }] }
  },
  {
    id: 'due',
    label: 'Due within 7 days',
    state: { filters: { next: ['today', 'week'] }, sort: [{ key: 'next', dir: 'asc' }] }
  },
  {
    id: 'untracked',
    label: 'Not tracked yet',
    state: { filters: { status: ['not_tracked'] }, sort: [{ key: 'page', dir: 'asc' }] }
  }
]

/** Short segment labels for the built-in views. Linked views keep their own label. */
export const SHORT_LABELS: Readonly<Record<string, string>> = {
  all: 'All',
  tracked: 'Tracked',
  lost: 'Lost',
  due: 'Due soon',
  untracked: 'Untracked'
}

/** Group-by choices. `null` is no grouping. */
export type PagesGroupId = 'folder' | 'cluster' | 'status' | null

/** What the All pages list shows: a view, its filters and order, grouping and columns. */
export interface PagesViewState {
  /** A preset id, a linked view id (`link:…`), or `saved:<id>`. */
  viewId: string
  filters: Readonly<Record<string, readonly string[]>>
  sort: readonly GridSortKey[]
  groupBy: PagesGroupId
  hidden: readonly string[]
  /** Bumped when the order changes from outside the grid, so the grid starts on it. */
  version: number
}

/** The state a preset opens with. */
export function presetState(
  preset: GridPreset | undefined,
  current?: PagesViewState
): PagesViewState {
  return {
    viewId: preset?.id ?? 'all',
    filters: { ...(preset?.state.filters ?? {}) },
    sort: preset?.state.sort ?? DEFAULT_SORT,
    groupBy: current ? current.groupBy : 'folder',
    hidden: current ? current.hidden : DEFAULT_HIDDEN,
    version: (current?.version ?? 0) + 1
  }
}

/** A saved view (FR-21.2) as list state. Search and widths are not part of the v2 list. */
export function savedState(
  id: string,
  state: GridViewState,
  current: PagesViewState
): PagesViewState {
  const group = state.groupBy
  return {
    viewId: `saved:${id}`,
    filters: { ...state.filters },
    sort: state.sort.length > 0 ? state.sort : DEFAULT_SORT,
    groupBy: group === 'folder' || group === 'cluster' || group === 'status' ? group : null,
    hidden: state.hidden,
    version: current.version + 1
  }
}

/** List state as a saved grid view. */
export function toGridState(view: PagesViewState): GridViewState {
  return {
    ...DEFAULT_GRID_STATE,
    filters: view.filters,
    sort: view.sort,
    hidden: view.hidden,
    groupBy: view.groupBy
  }
}

/** Facet filters that are on, as `[column id, value]` pairs. */
export function activeFilters(
  filters: Readonly<Record<string, readonly string[]>>
): [string, string][] {
  return Object.entries(filters).flatMap(([id, values]) =>
    values.map((value) => [id, value] as [string, string])
  )
}
