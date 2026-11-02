import type { RowIndex, TableLine } from '../../grid/model/rows'
import type { GridColumn, GridGroupOption } from '../../grid/types'
import type { ListColumn, ListGroup, ListSortValue } from './types'
import type { ColumnLayout } from './useColumnLayout'

export const SELECT_WIDTH = 16
export const MENU_WIDTH = 28
/** The expand button's column (a 28px icon button). */
export const DETAIL_WIDTH = 28
export const CELL_GAP = 16
export const ROW_PAD = 16
/** The main text column's floor, so its text is not cut while other columns fit (audit2 #5). */
const FILL_MIN = 240
export const GROUP_OPTION_ID = 'ui-list-group'

/** The column's sort: its own, else its copy text, else none (`sort: false` or no value). */
export function sortOf<Row>(column: ListColumn<Row>): ((row: Row) => ListSortValue) | null {
  if (column.sort === false || column.rowAction) return null
  if (column.sort) return column.sort
  const copy = column.copy
  return copy ? (row: Row) => copy(row) : null
}

/**
 * True when someone can drag the column's edge: a set width that does not opt
 * out. A column with a hidden header (an icon column such as Ask) keeps its size.
 */
export function isResizable<Row>(column: ListColumn<Row>): boolean {
  return column.width !== 'fill' && column.resizable !== false && !column.hideLabel
}

/** True when the Columns menu may hide the column: not the main (`fill`) column. */
export function isHideable<Row>(column: ListColumn<Row>): boolean {
  return column.hideable ?? column.width !== 'fill'
}

/** A value that counts as an empty cell for `hideWhenEmpty`. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' || text === '—'
  }
  return false
}

/** The value a `hideWhenEmpty` or `hideWhenSame` rule reads, or null when it reads none. */
function ruleValue<Row>(
  column: ListColumn<Row>,
  rule: boolean | ((row: Row) => unknown) | undefined
): ((row: Row) => unknown) | null {
  if (!rule) return null
  return typeof rule === 'function' ? rule : sortOf(column)
}

/** True when two or more rows all read the same value. */
function allSame<Row>(rows: readonly Row[], value: (row: Row) => unknown): boolean {
  if (rows.length < 2) return false
  const first = value(rows[0] as Row)
  return rows.every((row) => Object.is(value(row), first))
}

/**
 * The columns without the `hideWhenEmpty` ones that no row fills and the
 * `hideWhenSame` ones whose rows all read the same. With no rows at all
 * (loading, or the empty state) every column stays.
 */
export function withoutEmptyColumns<Row>(
  columns: readonly ListColumn<Row>[],
  rows: readonly Row[]
): readonly ListColumn<Row>[] {
  if (rows.length === 0 || !columns.some((column) => column.hideWhenEmpty || column.hideWhenSame))
    return columns
  const kept = columns.filter((column) => {
    const empty = ruleValue(column, column.hideWhenEmpty)
    if (empty && !rows.some((row) => !isBlank(empty(row)))) return false
    const same = ruleValue(column, column.hideWhenSame)
    return !(same && allSame(rows, same))
  })
  return kept.length === columns.length ? columns : kept
}

/** The hidden column ids: the ones someone hid, and `defaultHidden` ones nobody showed. */
export function hiddenColumnIds<Row>(
  columns: readonly ListColumn<Row>[],
  layout: Pick<ColumnLayout, 'hidden' | 'shown'>
): readonly string[] {
  const byDefault = columns.filter(
    (column) => column.defaultHidden && !layout.shown.includes(column.id)
  )
  if (byDefault.length === 0) return layout.hidden
  return [...new Set([...layout.hidden, ...byDefault.map((column) => column.id)])]
}

/** The Columns menu's new pick as the layout's hidden ids and the default-hidden ones shown. */
export function columnsPicked<Row>(
  hideable: readonly ListColumn<Row>[],
  shownIds: readonly string[]
): { hidden: string[]; shown: string[] } {
  return {
    hidden: hideable.filter((column) => !shownIds.includes(column.id)).map((column) => column.id),
    shown: hideable
      .filter((column) => column.defaultHidden && shownIds.includes(column.id))
      .map((column) => column.id)
  }
}

/**
 * The columns with someone's layout applied: hidden ones left out, resized
 * ones at their new width (a raw `track` gives way to the width).
 */
export function applyLayout<Row>(
  columns: readonly ListColumn<Row>[],
  layout: Pick<ColumnLayout, 'widths' | 'hidden'>
): readonly ListColumn<Row>[] {
  if (layout.hidden.length === 0 && Object.keys(layout.widths).length === 0) return columns
  const hidden = new Set(layout.hidden)
  return columns.flatMap((column) => {
    if (hidden.has(column.id) && isHideable(column)) return []
    const width = layout.widths[column.id]
    if (width === undefined || !isResizable(column)) return [column]
    const resized: ListColumn<Row> = { ...column, width }
    delete resized.track
    return [resized]
  })
}

/** What drops first on a narrow grid: the caller's list, then the low-priority columns, last first. */
export function dropOrder<Row>(
  columns: readonly ListColumn<Row>[],
  narrowDrops: readonly string[] | undefined
): readonly string[] {
  const listed = narrowDrops ?? []
  const low = columns
    .filter((column) => column.priority === 'low' && !listed.includes(column.id))
    .map((column) => column.id)
    .reverse()
  return low.length === 0 ? listed : [...listed, ...low]
}

/**
 * ListGrid columns as grid-model columns, so ListGrid runs on the same row model
 * (search, multi-key sort, grouping, paging) as every other grid in the app.
 */
export function toGridColumns<Row>(columns: readonly ListColumn<Row>[]): GridColumn<Row>[] {
  return columns.map((column) => {
    const sort = sortOf(column)
    return {
      id: column.id,
      label: column.label,
      fixed: true,
      width: column.width === 'fill' ? (column.minWidth ?? FILL_MIN) : column.width,
      align: column.align ?? (column.numeric ? 'end' : 'start'),
      ...(sort ? { sort } : {}),
      render: column.render,
      csv: () => null,
      ...(column.drill ? { drill: column.drill } : {})
    }
  })
}

export function toGroupOption<Row>(group: ListGroup<Row> | undefined): GridGroupOption<Row>[] {
  if (!group) return []
  return [
    {
      id: GROUP_OPTION_ID,
      label: 'Group',
      key: group.key,
      ...(group.order ? { order: group.order } : {})
    }
  ]
}

/** CSS grid template shared by the header and every row. */
export function gridTemplate<Row>(
  columns: readonly ListColumn<Row>[],
  selectable: boolean,
  menu: boolean,
  detail = false
): { template: string; minWidth: number } {
  const parts: string[] = []
  let min = ROW_PAD * 2
  if (selectable) {
    parts.push(`${SELECT_WIDTH}px`)
    min += SELECT_WIDTH
  }
  for (const column of columns) {
    if (column.width === 'fill') {
      const floor = column.minWidth ?? FILL_MIN
      parts.push(column.track ?? `minmax(${floor}px, 1fr)`)
      min += floor
    } else {
      parts.push(column.track ?? `${column.width}px`)
      min += column.width
    }
  }
  if (detail) {
    parts.push(`${DETAIL_WIDTH}px`)
    min += DETAIL_WIDTH
  }
  if (menu) {
    parts.push(`${MENU_WIDTH}px`)
    min += MENU_WIDTH
  }
  min += Math.max(0, parts.length - 1) * CELL_GAP
  return { template: parts.join(' '), minWidth: min }
}

/** The classes of a body cell of `column`. */
export function cellClasses<Row>(column: ListColumn<Row>): string {
  return [
    'ui-lg-td',
    alignOf(column) === 'end' ? 'ui-lg-end' : '',
    column.numeric ? 'num' : '',
    column.wrap ? 'wrap' : '',
    column.rowAction ? 'ui-lg-action' : '',
    column.cellClassName ?? ''
  ]
    .filter(Boolean)
    .join(' ')
}

export function alignOf<Row>(column: ListColumn<Row>): 'start' | 'end' {
  return column.align ?? (column.numeric ? 'end' : 'start')
}

/** The key a line's measured height is kept under (`useRowWindow`). */
export function lineKey<Row>(
  line: TableLine,
  index: RowIndex<Row>,
  rowKey: (row: Row) => string
): string {
  return line.kind === 'group'
    ? `group:${line.key}`
    : `row:${rowKey(index.rows[line.index] as Row)}`
}
