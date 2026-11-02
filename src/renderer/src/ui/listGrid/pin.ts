import type { CSSProperties } from 'react'
import { ROW_PAD, SELECT_WIDTH } from './columns'
import type { ListColumn } from './types'

/**
 * One pinned cell (audit2 #6, a frozen first column): it stays in place
 * while the grid scrolls sideways. `left` is where it sticks, the same spot it
 * has before any scroll, so the pinned cells stick together at once.
 */
export interface PinCell {
  /** CSS `left`: 0, or a calc on the row gap (`--lg-gap`, 16px by default). */
  left: string | 0
  /** The first cell of the row: its ground also covers the row's left padding. */
  first: boolean
  /** The last pinned cell: it casts the soft edge shadow while scrolled. */
  last: boolean
}

/** The pinned cells of a grid: the tick box column, then the columns up to the main one. */
export interface PinPlan {
  select: PinCell | null
  columns: ReadonlyMap<string, PinCell>
}

export const NO_PINS: PinPlan = { select: null, columns: new Map() }

/**
 * The column that stays in place: one marked `pin: true`, else `main` (a
 * tree's arrow column), else the `fill` column. None when that column says
 * `pin: false`, or when the grid has no main text column.
 */
function pinnedColumn<Row>(
  columns: readonly ListColumn<Row>[],
  main: string | undefined
): ListColumn<Row> | null {
  const column =
    columns.find((item) => item.pin === true) ??
    (main !== undefined ? columns.find((item) => item.id === main) : undefined) ??
    columns.find((item) => item.width === 'fill')
  return column && column.pin !== false ? column : null
}

/** True when a column before the main one can pin too: a plain pixel width. */
function pinsBefore<Row>(column: ListColumn<Row>): boolean {
  return typeof column.width === 'number' && column.track === undefined && column.pin !== false
}

/**
 * Which cells stay in place while the grid scrolls sideways: the tick box
 * column and every column up to and including the main text column. When a
 * column before it has no plain pixel width, only the main column pins.
 */
export function pinPlan<Row>(
  columns: readonly ListColumn<Row>[],
  selectable: boolean,
  main?: string
): PinPlan {
  const target = pinnedColumn(columns, main)
  if (!target) return NO_PINS
  const at = columns.indexOf(target)
  const before = columns.slice(0, at)
  const run = before.every(pinsBefore)
  const cells: { id: string | null; width: number }[] = []
  if (run && selectable) cells.push({ id: null, width: SELECT_WIDTH })
  if (run) for (const column of before) cells.push({ id: column.id, width: column.width as number })
  cells.push({ id: target.id, width: 0 })
  const out = new Map<string, PinCell>()
  let select: PinCell | null = null
  // The first track starts after the row's padding; each pinned cell's ground
  // reaches half the gap before and after its track, so the cells meet with no
  // seam and each sticks where it already sits.
  let widths = ROW_PAD
  for (const [index, cell] of cells.entries()) {
    const first = index === 0 && run
    const pin: PinCell = {
      left: first || !run ? 0 : `calc(${widths}px + ${index - 0.5} * var(--lg-gap, 16px))`,
      first,
      last: index === cells.length - 1
    }
    if (cell.id === null) select = pin
    else out.set(cell.id, pin)
    widths += cell.width
  }
  return { select, columns: out }
}

/** A pinned cell's class and its sticking spot; nothing for a cell that scrolls. */
export function pinCell(
  pin: PinCell | null | undefined,
  className: string,
  style?: CSSProperties
): { className: string; style?: CSSProperties } {
  if (!pin) return style ? { className, style } : { className }
  const classes = [
    className,
    'ui-lg-pin',
    pin.first ? 'ui-lg-pin-first' : '',
    pin.last ? 'ui-lg-pin-last' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return { className: classes, style: { ...style, left: pin.left } }
}

/** True when a plan pins anything. */
export function hasPins(plan: PinPlan): boolean {
  return plan.select !== null || plan.columns.size > 0
}
