import { gridTemplate } from './columns'
import type { ListColumn, ListGridProps } from './types'

/** The grid card's left and right border, outside the row's own width. */
export const GRID_CARD_BORDERS = 2

export interface FitOptions {
  /** Rows have a tick box (a bulk bar). */
  selectable?: boolean
  /** Rows have a `⋯` menu. */
  menu?: boolean
  /** Rows have an expand button. */
  detail?: boolean
}

/** True when the columns' smallest row fits `width` (the grid card's inner width). */
export function columnsFit<Row>(
  columns: readonly ListColumn<Row>[],
  width: number,
  options: FitOptions = {}
): boolean {
  const { minWidth } = gridTemplate(
    columns,
    options.selectable ?? false,
    options.menu ?? false,
    options.detail ?? false
  )
  return minWidth <= width
}

/**
 * Drops the columns named in `drops`, one by one in that order, until the row
 * fits `width`, so a narrow window never scrolls the grid sideways. A width of
 * 0 (not measured yet) keeps every column. Returns the columns to show and the
 * ids it dropped (a screen can show a dropped value another way).
 */
export function fitColumns<Row>(
  columns: readonly ListColumn<Row>[],
  drops: readonly string[],
  width: number,
  options: FitOptions = {}
): { columns: readonly ListColumn<Row>[]; dropped: readonly string[] } {
  if (width <= 0) return { columns, dropped: [] }
  let shown = columns
  const dropped: string[] = []
  for (const id of drops) {
    if (columnsFit(shown, width, options)) break
    if (!shown.some((column) => column.id === id)) continue
    shown = shown.filter((column) => column.id !== id)
    dropped.push(id)
  }
  return { columns: shown, dropped }
}

/** Lines a list or tree draws in full, with no scroll of its own, before it falls back to a window. */
export const FIT_LINES_UP_TO = 300

/**
 * True when a grid draws every line it shows with no height cap, so the page
 * is the one scroll (audit2 #6): `fitPage` says so for a paged list; with
 * neither `fitPage`, `maxBodyHeight` nor `height` set, any list of up to
 * {@link FIT_LINES_UP_TO} lines. `fitPage={false}` keeps the capped box.
 */
export function fitsPage(
  props: Pick<ListGridProps<unknown>, 'fitPage' | 'maxBodyHeight' | 'height'>,
  paged: boolean,
  lines: number
): boolean {
  if (props.fitPage === true) return paged
  if (props.fitPage === false) return false
  if (props.maxBodyHeight !== undefined || props.height !== undefined) return false
  return paged || lines <= FIT_LINES_UP_TO
}
