/** The standard data grid: saved views (FR-21.2) and Export CSV (FR-21.1, FR-21.8). */

import type { GridViewState, SavedGridView } from '../domain'
import type { SummaryBoard } from '../summary-board'
import { invokeWith, type InvokeChannelSpecs } from './contract'

/** `grid:listViews`. Views are per project and per grid id. */
export interface ListGridViewsRequest {
  projectId: string
  grid: string
}

export interface GridViewList {
  views: readonly SavedGridView[]
}

/**
 * `grid:saveView`. A null `id` saves a new view. An id overwrites that view's
 * name and state. Names are unique per grid (trimmed, 1–80 characters).
 */
export interface SaveGridViewRequest {
  projectId: string
  grid: string
  id: string | null
  name: string
  state: GridViewState
}

export interface GridViewIdRequest {
  projectId: string
  viewId: string
}

export interface DeletedGridView {
  id: string
}

/**
 * `grid:exportCsv`. The rows the grid shows, with its current search, filters,
 * sort and columns. Main writes UTF-8 with a BOM (FR-21.8), neutralizes formula
 * text and redacts known secrets, then asks where to save. The renderer never
 * sends a path.
 */
export interface GridCsvRequest {
  /** Suggested file name, such as `example-all-pages-2026-10-19.csv`. */
  fileName: string
  header: readonly string[]
  rows: readonly (readonly (string | number | null)[])[]
}

export type GridCsvResult =
  | { ok: true; rowCount: number; columnCount: number; fileName: string }
  | { ok: false; reason: 'cancelled' | 'failed'; message: string }

/**
 * `grid:getScreenView` / `grid:setScreenView`. The view a screen was last
 * shown in (`tree`, `grid`, `list`, `pages`, `progress`), per project and per
 * screen key such as `topic` or `pages`. Lowercase letters, digits and `-`.
 */
export interface ScreenViewRequest {
  projectId: string
  screen: string
}

export interface SetScreenViewRequest {
  projectId: string
  screen: string
  view: string
}

export interface ScreenViewResult {
  /** Null when the screen has no remembered view yet. */
  view: string | null
}

/**
 * `grid:getSummaryBoard` / `grid:setSummaryBoard`. The project's Summary widgets
 * (src/shared/summary-board.ts), kept in the project file's `saved_views` beside the
 * screens' last views. Null: the project has never arranged its Summary.
 */
export interface SummaryBoardRequest {
  projectId: string
}

export interface SetSummaryBoardRequest {
  projectId: string
  board: SummaryBoard
}

export interface SummaryBoardResult {
  board: SummaryBoard | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const gridChannels = {
  'grid:listViews': invokeWith<ListGridViewsRequest, GridViewList>(),
  'grid:saveView': invokeWith<SaveGridViewRequest, SavedGridView>(),
  'grid:deleteView': invokeWith<GridViewIdRequest, DeletedGridView>(),
  'grid:exportCsv': invokeWith<GridCsvRequest, GridCsvResult>(),
  'grid:getScreenView': invokeWith<ScreenViewRequest, ScreenViewResult>(),
  'grid:setScreenView': invokeWith<SetScreenViewRequest, ScreenViewResult>(),
  'grid:getSummaryBoard': invokeWith<SummaryBoardRequest, SummaryBoardResult>(),
  'grid:setSummaryBoard': invokeWith<SetSummaryBoardRequest, SummaryBoardResult>()
} as const satisfies InvokeChannelSpecs
