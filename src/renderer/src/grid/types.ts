import type { ReactNode } from 'react'
import type {
  GridMembership,
  GridSortDir,
  GridViewMode,
  GridViewState,
  SavedGridView
} from '@shared/domain'
import type { GridCsvRequest, GridCsvResult } from '@shared/ipc'

/** What a cell writes to the CSV. Numbers stay numbers. */
export type CsvCell = string | number | null

/** A sortable value. Null always sorts last, in either direction. */
export type SortValue = string | number | null

/** FR-21.1. A column filter with one checkbox per value and counts beside each. */
export interface FacetFilter<Row> {
  kind: 'facet'
  /** The values a row has. A row matches when any of them is on. */
  values: (row: Row) => readonly string[]
  /** Display text for a value. Defaults to the value. */
  label?: (value: string) => string
  /** Fixed value order. Values not listed follow, sorted. */
  order?: readonly string[]
  /** Shorter chip text, such as "Status". Defaults to the column label. */
  chip?: string
}

/** A number range: "At least" (inclusive) and "Below" (exclusive). Rows with no number are hidden while set. */
export interface RangeFilter<Row> {
  kind: 'range'
  value: (row: Row) => number | null
  /** One sentence under the inputs. */
  hint?: string
}

/**
 * A cell that opens something (REPORT-SPEC "every number drills"). The cell's
 * `render` output becomes the content of a button (`onOpen`: a drawer or a
 * popover) or of a link (`href`: a route, or an external URL). Keep the
 * rendered content free of other controls.
 */
export type GridCellDrill =
  | {
      /** Accessible name, such as "Show the 3 prompts that cite this page". */
      label: string
      onOpen: () => void
      /**
       * NFR-14 id (`data-nfr-drill`). Set it only when `render` returns the bare
       * count: the content is then marked `data-nfr-figure` with the same id.
       */
      nfrId?: string
    }
  | {
      label: string
      href: string
      /** Opens in the browser (an http(s) URL). */
      external?: boolean
    }

export interface GridColumn<Row> {
  id: string
  label: string
  /** Shown beside the column in the picker. */
  note?: string
  /** Always shown and listed first. It cannot be hidden. */
  fixed?: boolean
  /** Hidden until the user turns it on. */
  hiddenByDefault?: boolean
  /** Default width in CSS pixels. */
  width: number
  minWidth?: number
  align?: 'start' | 'end'
  /** Absent: the header is not a sort button. */
  sort?: (row: Row) => SortValue
  /** First direction when this column is picked from a "Sort by" menu. */
  defaultDir?: GridSortDir
  filter?: FacetFilter<Row> | RangeFilter<Row>
  render: (row: Row) => ReactNode
  csv: (row: Row) => CsvCell
  /** Makes the cell open its own detail. Null for rows where there is nothing to open. */
  drill?: (row: Row) => GridCellDrill | null
}

/** A way to group rows: the table's "Group by" or the tree's first level. */
export interface GridGroupOption<Row> {
  id: string
  label: string
  /** One group per row. */
  key: (row: Row) => { key: string; label: string }
  /** Fixed group order by key. Groups not listed follow, sorted by label. */
  order?: readonly string[]
}

/** A built-in view, such as "Money pages". Unset fields keep the grid's defaults. */
export interface GridPreset {
  id: string
  label: string
  state: Partial<GridViewState>
}

/** FR-21.2. Where saved views are kept. Production is `grid:*` IPC. */
export interface GridViewsAdapter {
  list(): Promise<readonly SavedGridView[]>
  save(id: string | null, name: string, state: GridViewState): Promise<SavedGridView>
  remove(id: string): Promise<void>
}

/** FR-21.1, FR-21.8. Writes the CSV. Production is `grid:exportCsv`. */
export type GridCsvExport = (request: GridCsvRequest) => Promise<GridCsvResult>

/** What the bulk bar's actions receive. */
export interface BulkContext<Row> {
  selected: readonly Row[]
  clear: () => void
  /** Exports the selected rows with the visible columns. Resolves to the message shown. */
  exportSelected: () => Promise<string>
}

export interface DataGridProps<Row> {
  /** Grid id for saved views, such as `all-pages`. */
  id: string
  /** Accessible name of the grid, such as "Pages". */
  label: string
  /** Row noun, singular and plural, such as ['page', 'pages']. */
  noun: readonly [string, string]
  rows: readonly Row[]
  rowKey: (row: Row) => string
  /** Name of a row for "Select …" and screen readers. */
  rowLabel: (row: Row) => string
  columns: readonly GridColumn<Row>[]
  search?: { label: string; placeholder: string; text: (row: Row) => string }
  /** Views the data allows (FR-21.3). Default table only. */
  views?: readonly GridViewMode[]
  card?: (row: Row) => ReactNode
  /** A row under a tree node. Defaults to the first column's cell. */
  treeLeaf?: (row: Row) => ReactNode
  /** Tree levels the user can pick. The first is the default. */
  tree?: readonly GridGroupOption<Row>[]
  groupBy?: readonly GridGroupOption<Row>[]
  /** Text after a group or tree node's name, such as "12 pages · avg score 41". */
  groupSummary?: (rows: readonly Row[]) => string
  /** Bulk actions for the selected rows (FR-21.4). Absent: no selection column. */
  bulk?: (context: BulkContext<Row>) => ReactNode
  initial?: Partial<GridViewState>
  presets?: readonly GridPreset[]
  savedViews?: GridViewsAdapter | null
  exportCsv?: GridCsvExport | null
  /** CSV file name without the date or extension, such as `example-all-pages`. */
  exportName: string
  /** Shown when there are no rows at all. */
  empty: ReactNode
  /**
   * Opens a row: Enter on the focused row, or a click on the row that is not on
   * a link, button or field inside it. Cards and tree leaves open the same way.
   */
  onActivate?: (row: Row) => void
  /** Hint under the toolbar, such as "Scores are for each page's default market." */
  note?: ReactNode
  /** Accessible name of the toolbar group. Default "Grid tools". */
  toolsLabel?: string
  /** Replaces the "Showing X of Y" line. `filtering` is true while a search or filter is on. */
  showing?: (shown: number, matching: number, total: number, filtering: boolean) => string
  /** Replaces the sentence that says why nothing matches. */
  noMatch?: string
  /**
   * While a search or filter is on, rows that pass `test` come first, unless the
   * grid is sorted by the `unlessSortedBy` column (FR-23.11 failed-first).
   */
  filteredFirst?: { test: (row: Row) => boolean; unlessSortedBy: string }
  /** Table line heights in pixels. Default 48 comfortable, 36 compact. */
  rowHeights?: { comfortable: number; compact: number }
  /** Called with the rows in display order whenever that order changes. */
  onOrderChange?: (rows: readonly Row[]) => void
}

/** Cluster and group memberships render as "—" when the data is absent. */
export type MembershipValue = readonly GridMembership[] | null
