import type { ReactNode } from 'react'
import type { GridPageSize, GridSortKey } from '@shared/domain'
import type { GridCellDrill } from '../../grid/types'
import type { MenuItem } from '../Menu'
import type { SegmentOption } from '../SegmentedControl'
import type { FilterGroup } from './filters'

/** A sortable value. Null always sorts last, in either direction. */
export type ListSortValue = string | number | null

/** One column of a {@link ListGrid}. */
export interface ListColumn<Row> {
  id: string
  /** Header text. Also the sort button's name. */
  label: string
  /** Hides the header text visually (it stays for screen readers), such as a "Q" number column. */
  hideLabel?: boolean
  /** What the column means, as the header's tooltip, such as "Google's order: 1 = shown first". */
  hint?: string
  /**
   * Pixel width, or `fill` for the one flexible column that takes the rest of
   * the row (`minmax(minWidth, 1fr)`). Use `fill` for the main text column.
   */
  width: number | 'fill'
  /** Smallest width of a `fill` column before columns drop or the grid scrolls sideways. Default 240. */
  minWidth?: number
  /**
   * A raw CSS grid track that replaces the one `width` makes, such as
   * `minmax(72px, 0.6fr)`. `width` (or `minWidth`) still sets the floor the
   * grid scrolls sideways at.
   */
  track?: string
  /**
   * Text wraps instead of ending in an ellipsis, and the row grows to fit it.
   * Rows of any height scroll correctly: the grid measures each row it draws.
   */
  wrap?: boolean
  /**
   * Numbers, percents, scores, counts and money: right-aligned with tabular
   * digits, the header too (R3). While developing, a column whose cells all
   * read as numbers warns in the console when this is missing.
   */
  numeric?: boolean
  /** Text alignment. Defaults to `end` for numeric columns, else `start`. */
  align?: 'start' | 'end'
  /**
   * The value the column sorts by (R4). `false` opts out (a column of
   * actions or icons). Absent: a `copy` column sorts by its copy text, and
   * otherwise the header is plain text (and warns while developing).
   */
  sort?: ((row: Row) => ListSortValue) | false
  /**
   * The text someone may paste elsewhere (R10): the cell gets the shared copy
   * icon on hover or focus, with the green tick. Null for a row with nothing
   * to copy. URLs keep UrlText, which has copy and open.
   */
  copy?: (row: Row) => string | null
  /**
   * Leaves the column out while no row has a value in it, such as a "Last
   * run" column before anything ran (audit2 #14). `true` reads the column's
   * sort value (else its copy text); a function returns the cell's value. A
   * row is empty when that is null, undefined, '' or '—'. It checks every
   * row passed in, not only the ones a search shows, so columns stay put.
   */
  hideWhenEmpty?: boolean | ((row: Row) => unknown)
  /**
   * Leaves the column out while two or more rows are passed in and they all
   * hold the same value, so it says nothing, such as a Status that is "New"
   * on every fix or a Topic column on one topic's list (owner 2026-10-30).
   * `true` reads the column's sort value (else its copy text); a function
   * returns the cell's value. Like `hideWhenEmpty` it checks the rows passed
   * in (after the caller's filters), not only the ones a search shows.
   */
  hideWhenSame?: boolean | ((row: Row) => unknown)
  /**
   * Starts hidden, such as the "#" ref column ("Q6", "K111"), but stays in the
   * Columns menu, where someone can show it (kept on this computer like any
   * other hidden column).
   */
  defaultHidden?: boolean
  /**
   * Stays in place while the grid scrolls sideways, like a frozen first
   * column (audit2 #6). Default: on for the main text column (the `fill`
   * column, or a tree's arrow column), with the tick boxes and any narrow
   * columns before it. `false` on the main column turns pinning off; `true`
   * on another column pins that one instead.
   */
  pin?: boolean
  /** `low`: the first to drop when the grid is narrower than its row (R6), after `narrowDrops`. */
  priority?: 'low'
  /**
   * False keeps a set width with no drag edge. Default true for set widths; a
   * `fill` column and a column with a hidden header have none.
   */
  resizable?: boolean
  /** False keeps the column out of the Columns menu. Default true, except the `fill` column. */
  hideable?: boolean
  render: (row: Row) => ReactNode
  /** Makes the cell open its own detail (every number drills). Null when there is nothing to open. */
  drill?: (row: Row) => GridCellDrill | null
  /**
   * A row action column (row actions): its quiet buttons show only
   * while the row is hovered or has keyboard focus (or is the open row), and
   * always on touch screens, where there is no hover. Pass `variant="ghost"`
   * buttons. The column does not sort.
   */
  rowAction?: boolean
  /** Extra class on every cell of this column, such as `mono` for URLs. */
  cellClassName?: string
  /**
   * Tree grids ({@link ListGridProps.tree}): what a group row and the footer
   * total row show in this column, from every leaf below it (the totals add
   * up, so every row adds up to its parent). Absent: an empty cell.
   */
  total?: (rows: readonly Row[], group: ListTreeGroup<Row> | null) => ReactNode
  /**
   * Tree grids: the value sibling groups sort by under this column's header.
   * Absent: the tree column sorts groups by label; other columns keep their order.
   */
  totalSort?: (rows: readonly Row[]) => ListSortValue
}

/** One step of a leaf's place in a tree: a group it sits in. */
export interface ListTreeStep {
  /** Unique among its siblings. Never shown, never in a URL (the URL holds an opaque id). */
  key: string
  label: string
  /** A small mark before the label, such as a result dot. */
  lead?: ReactNode
}

/** A group row of a tree grid, as `renderGroup`, `total` and `groupProps` see it. */
export interface ListTreeGroup<Row> {
  /** Opaque id, the one the URL holds. */
  id: string
  key: string
  label: string
  lead?: ReactNode
  /** 0 for a top group. */
  depth: number
  /** The keys from the top group down to this one. */
  path: readonly string[]
  /** Every leaf below this group that passes the search. */
  rows: readonly Row[]
  /** Child groups and leaves directly under it. */
  children: number
}

/**
 * Rows as a tree (topic mock-ups TopicBig, TopicPages): group rows with
 * totals in the same columns as leaf rows, arrows, an indent per level,
 * "Show N more" and Expand all / Collapse all.
 */
export interface ListTree<Row> {
  /**
   * The groups a leaf sits in, from the top: `[Stage, Result]`. Leaves may sit
   * at different depths (folders); an empty path is a top-level leaf.
   */
  path: (row: Row) => readonly ListTreeStep[]
  /**
   * The tree column's content of a group row, after the arrow, such as the
   * label with a "What to do" line or an "Open all 14" link. Default: the lead and label.
   */
  renderGroup?: (group: ListTreeGroup<Row>) => ReactNode
  /** Sibling group order by key, while no header sort is on. Unlisted groups follow in first-seen order. */
  order?: readonly string[]
  /** Leaves shown under an open group before "Show N more". Default 3. */
  moreAfter?: number
  /** An open group shows every leaf (no "Show N more") while there are this many leaves or fewer. Default 30. */
  openAllUpTo?: number
  /**
   * Which groups start open while the URL names none (no `<key>.open`), such
   * as the group of the fix open in a drawer. Absent: every group starts
   * closed, except a lone top group. "Show N more" still applies past `openAllUpTo`.
   */
  defaultOpen?: (group: ListTreeGroup<Row>) => boolean
  /** The column with the arrows and the indent. Default: the `fill` column, else the first. */
  column?: string
  /** The footer total row's label. False leaves the row out. Default "Total". */
  totalRow?: string | false
  /** Expand all / Collapse all in the toolbar. Default true. */
  expandControls?: boolean
  /** Extra `data-*` attributes on a group row. */
  groupProps?: (group: ListTreeGroup<Row>) => RowDataAttributes
  /** Opens a group (Enter while it is open), such as its drill page. Default: Enter toggles it. */
  onActivateGroup?: (group: ListTreeGroup<Row>) => void
}

/** Collapsible group headers: one group per row. */
export interface ListGroup<Row> {
  key: (row: Row) => { key: string; label: string }
  /** Fixed group order by key. Groups not listed follow, sorted by label. */
  order?: readonly string[]
  /** Text after the count chip, such as "Improve the target page" or "Intent · Commercial · MOFU". */
  meta?: (rows: readonly Row[], key: string) => ReactNode
  /** Group keys that start collapsed. */
  collapsed?: readonly string[]
}

/** Segmented filter in the toolbar. Controlled: the caller filters `rows` itself. */
export interface ListFilter {
  /** Accessible name, such as "Status". */
  label: string
  options: readonly SegmentOption<string>[]
  value: string
  onChange: (value: string) => void
  /** The value "Clear search" goes back to. Default: the first option. */
  resetValue?: string
  /**
   * Keeps the control in the toolbar row even when the row is full, for a
   * screen's view switch rather than a filter. Default: it moves into
   * Filter ▾ after the filter dropdowns (audit2 #7).
   */
  stay?: boolean
}

/**
 * The engine filter's fixed spot in the toolbar, right after the search box (audit #4).
 * Build it with engines/ `useEngineFilter(...).slot`; the caller filters `rows` itself.
 */
export interface ListEngineFilter {
  /** All plus each engine's logo, or one fixed logo. Null leaves the spot empty. */
  control: ReactNode
  /** One engine is picked: an emptied list says "match this filter" and Show all resets it. */
  active: boolean
  onReset: () => void
}

/** What the bulk bar's actions receive. */
export interface ListBulkContext<Row> {
  selected: readonly Row[]
  clear: () => void
}

/** Numbers the footer line is built from. */
export interface ListFooterInfo {
  /** First and last shown row, 1-based. 0 and 0 when nothing shows. */
  first: number
  last: number
  /** Rows that pass the search (and caller filters, which are already applied). */
  matching: number
  /** Every row passed in. */
  total: number
  /** Groups among the matching rows. 0 without grouping. */
  groups: number
}

export interface ListGridProps<Row> {
  /** Accessible name of the grid, such as "Keywords". */
  label: string
  /** Row noun, singular and plural, such as ['keyword', 'keywords']. */
  noun: readonly [string, string]
  rows: readonly Row[]
  rowKey: (row: Row) => string
  /** Name of a row for "Select …" and "Actions for …", such as "Q6". */
  rowLabel: (row: Row) => string
  columns: readonly ListColumn<Row>[]
  /**
   * Column ids the grid leaves out first, in this order, while it is narrower
   * than its row, so a narrow window never scrolls it sideways. Without it the
   * grid keeps every column and scrolls.
   */
  narrowDrops?: readonly string[]
  /**
   * Keeps the grid's sort, search, page and Show all in the hash URL under this
   * key (`<key>.sort`, `<key>.q`, `<key>.p`, `<key>.n`), so Back, Forward and a
   * copied link open the same view (R5). A controlled `sort` or `searchValue`
   * still wins. In a drawer, list `listUrlKeys(key)` in the drawer's params.
   */
  urlKey?: string
  /**
   * Saves column widths and hidden columns on this computer under this key
   * (R6). Default: `urlKey`. Without either they last until the screen closes.
   */
  saveKey?: string
  /** Adds the shared "Columns" button (show and hide columns, reset widths) to the toolbar. */
  columnsMenu?: boolean
  /** Placeholder rows under the header while the rows load (R13). */
  loading?: boolean
  /** A failed load: the shared error box with Retry in place of the rows (R13). */
  error?: { title?: string; message?: string | null; onRetry?: () => void } | null
  /** Toolbar search. The placeholder defaults to "Search N {noun}". */
  search?: { text: (row: Row) => string; placeholder?: string }
  /** Segmented filter in the toolbar (caller-controlled). */
  filter?: ListFilter
  /** The engine filter, in the same toolbar spot on every results screen (caller-controlled). */
  engine?: ListEngineFilter
  /**
   * Every other filter in one "Filter ▾" button after the engine filter (audit2
   * #7, one Filter button), such as Result and Change. Caller-controlled:
   * pass the filtered `rows`. An emptied list's "Show all" resets them.
   */
  filters?: readonly FilterGroup[]
  /**
   * Filters shown as their own dropdowns in the toolbar, such as Market, while
   * the row has room. When it has none they move into Filter ▾ by themselves
   * (the last first, then the segmented `filter`), so the toolbar keeps one
   * row (audit2 #7). Caller-controlled, like `filters`.
   */
  filterControls?: readonly FilterGroup[]
  /** Extra toolbar content after the filter, such as a suggestion chip. */
  toolbar?: ReactNode
  /** Right-aligned toolbar slot for the section's one AI menu (`<AiMenu …/>`). */
  ai?: ReactNode
  /** Right-aligned toolbar actions before the AI slot, such as "Add point". */
  actions?: ReactNode
  group?: ListGroup<Row>
  /**
   * Shows the rows as a tree instead of a flat list (no paging: long trees
   * draw a window of lines). With `urlKey` the open groups and "Show more"
   * live in the URL (`<key>.open`, `<key>.more`, opaque ids). Not with `group`
   * or `renderDetail`.
   */
  tree?: ListTree<Row>
  /** Bulk actions. Present: rows get checkboxes and a bulk bar replaces the toolbar on selection. */
  bulk?: (context: ListBulkContext<Row>) => ReactNode
  /**
   * The selected row keys, controlled (such as from the URL). Pair with
   * `onSelectionChange`. Unset: the grid keeps its own selection.
   */
  selection?: readonly string[]
  /** With `selection`: the new keys after a tick, Select all or Clear. */
  onSelectionChange?: (keys: readonly string[]) => void
  /** Row actions behind the right-hand `⋯`. Present: the grid gets a menu column. */
  rowMenu?: (row: Row) => readonly MenuItem[]
  /** Opens a row: Enter on the focused row, or a click that is not on a control inside it. */
  onActivate?: (row: Row) => void
  /** Starting sort, such as `[{ key: 'odds', dir: 'desc' }]`. */
  initialSort?: readonly GridSortKey[]
  /**
   * The sort, controlled (such as from the URL). Present: the grid shows it
   * and reports header clicks through `onSortChange` instead of keeping its own.
   */
  sort?: readonly GridSortKey[]
  /** Called with the new sort on every header click (controlled or not). */
  onSortChange?: (sort: readonly GridSortKey[]) => void
  /** The search text, controlled (such as from the URL). Pair with `onSearchChange`. */
  searchValue?: string
  /** Called with the new search text as the person types (controlled or not). */
  onSearchChange?: (value: string) => void
  /** Rows per page. Default 25. `all` shows every row in a virtualised list. */
  pageSize?: GridPageSize
  /**
   * Replaces the footer's left line ("1–25 of 118", "118 keywords"). Keep it a
   * count: no extra sentences (owner 2026-10-30).
   */
  summary?: (info: ListFooterInfo) => ReactNode
  /** Shown in the card when there are no rows at all. */
  empty: ReactNode
  /**
   * True: while the list is paged its rows are drawn in full with no height
   * cap, so the page scrolls and the grid has no scroll of its own; Show all
   * draws a window of rows in a body capped at `maxBodyHeight`.
   */
  fitPage?: boolean
  /** Fixed card height, such as 490 or '100%'. Unset: the body grows up to `maxBodyHeight`. */
  height?: number | string
  /** Largest body height before it scrolls, in pixels. Default 640. */
  maxBodyHeight?: number
  /** Marks a row (fox tint), such as the one open in a drawer. */
  isRowCurrent?: (row: Row) => boolean
  /**
   * Extra `data-*` attributes on a row element, such as a test hook or a
   * consistency marker (`data-nfr-series`). `index` is the row's place among
   * the rows shown, from 0. Undefined values are left out.
   */
  rowProps?: (row: Row, index: number) => RowDataAttributes
  /**
   * False renders every row instead of a window of them, for short lists in
   * a drawer (up to about 100 rows) whose outer panel scrolls. Without
   * `maxBodyHeight` the body then grows to fit its rows. Default true: lists
   * over 80 lines draw only the rows in view.
   */
  virtualize?: boolean
  /**
   * Expandable row detail: an expand button at the row's end (aria-expanded,
   * ArrowRight and ArrowLeft on a focused row) opens this under the row's
   * cells, across the whole row.
   */
  renderDetail?: (row: Row) => ReactNode
  /**
   * The expanded row keys, controlled (such as the open row in the URL). Pair
   * with `onExpandedChange`. Unset: the grid keeps its own.
   */
  expanded?: readonly string[]
  /** Called with the new expanded keys when a row opens or closes (controlled or not). */
  onExpandedChange?: (keys: readonly string[]) => void
  /** Rows that have a detail to expand. Default: every row, when `renderDetail` is set. */
  hasDetail?: (row: Row) => boolean
  /**
   * What the expand button opens, for its name ("Show …" / "Hide …"), such
   * as "the AI Overview for prompt 3". Default: "details for {rowLabel}".
   */
  detailLabel?: (row: Row) => string
  /** Vertical alignment of the cells in a row. `start` suits rows of wrapping text. Default `center`. */
  rowAlign?: 'center' | 'start'
  /**
   * `paged` shows the footer only while the list is paged (Show all and the
   * pager), for a list whose surroundings already state the count. Default `always`.
   */
  footer?: 'always' | 'paged'
  className?: string
}

/** `data-*` attributes for a row ({@link ListGridProps.rowProps}). */
export type RowDataAttributes = Readonly<Record<`data-${string}`, string | number | undefined>>
