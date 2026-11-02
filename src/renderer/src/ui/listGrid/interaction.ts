import type { KeyboardEvent, MouseEvent } from 'react'
import { clickedRow } from '../../components/rowActivation'
import type { RowIndex, TableLine } from '../../grid/model/rows'

export interface LineHandlers<Row> {
  lines: readonly TableLine[]
  index: RowIndex<Row>
  /** Arrow keys, Home, End, Page Up/Down. True when the key was handled. */
  moveFocus: (event: KeyboardEvent<HTMLDivElement>) => boolean
  toggleGroup: (key: string) => void
  /** Space on a row. Null when rows cannot be selected. */
  toggleRow: ((row: Row) => void) | null
  onActivate: ((row: Row) => void) | undefined
  /** ArrowRight opens a row's detail, ArrowLeft closes it. Null without `renderDetail`. */
  expand: ((row: Row, open: boolean) => void) | null
}

/**
 * Keys on the grid: arrows move between lines; Enter or Space on a group header
 * toggles it; Enter on a row opens it; Space on a row selects it; ArrowRight
 * and ArrowLeft on a row open and close its detail. Keys from controls inside
 * a line (checkbox, menu, drill, the detail) keep their own behaviour.
 */
export function onGridKeyDown<Row>(
  event: KeyboardEvent<HTMLDivElement>,
  handlers: LineHandlers<Row>
): void {
  if (handlers.moveFocus(event)) return
  const target = event.target as HTMLElement
  if (target.dataset.line === undefined) return
  const line = handlers.lines[Number(target.dataset.line)]
  if (!line) return
  if (line.kind === 'group') {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handlers.toggleGroup(line.key)
    }
    return
  }
  const row = handlers.index.rows[line.index] as Row
  if (event.key === 'Enter' && handlers.onActivate) {
    event.preventDefault()
    handlers.onActivate(row)
  } else if (event.key === ' ' && handlers.toggleRow) {
    event.preventDefault()
    handlers.toggleRow(row)
  } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handlers.expand) {
    event.preventDefault()
    handlers.expand(row, event.key === 'ArrowRight')
  }
}

/** A click on a row, not on a control inside it, opens the row the same as Enter. */
export function onGridClick<Row>(
  event: MouseEvent<HTMLDivElement>,
  handlers: Pick<LineHandlers<Row>, 'lines' | 'index' | 'onActivate'>
): void {
  if (!handlers.onActivate) return
  const at = clickedRow(event.target, 'data-row')?.dataset.line
  if (at === undefined) return
  const line = handlers.lines[Number(at)]
  if (line?.kind === 'row') handlers.onActivate(handlers.index.rows[line.index] as Row)
}
