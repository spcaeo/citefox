import type { JSX } from 'react'
import { cellClasses } from '../columns'
import { pinCell, type PinPlan } from '../pin'
import type { ListColumn } from '../types'

/**
 * The tree's footer total row: every leaf that passes the search, added up
 * by each column's `total`, the same sums its groups show. Sticks to the
 * bottom of the grid while the lines scroll.
 */
export function TreeTotal<Row>({
  label,
  rows,
  columns,
  template,
  treeColumn,
  selectable,
  menu,
  rowIndex,
  pins
}: {
  label: string
  rows: readonly Row[]
  columns: readonly ListColumn<Row>[]
  template: string
  treeColumn: string
  selectable: boolean
  menu: boolean
  rowIndex: number
  pins: PinPlan
}): JSX.Element {
  return (
    <div role="rowgroup" className="ui-lg-tree-totals">
      <div
        role="row"
        className="ui-lg-row ui-lg-tree-total"
        aria-rowindex={rowIndex}
        style={{ gridTemplateColumns: template }}
      >
        {selectable ? <div role="gridcell" {...pinCell(pins.select, 'ui-lg-check')} /> : null}
        {columns.map((column) => (
          <div
            role="gridcell"
            key={column.id}
            {...pinCell(pins.columns.get(column.id), cellClasses(column))}
          >
            {column.id === treeColumn ? label : column.total ? column.total(rows, null) : null}
          </div>
        ))}
        {menu ? <div role="gridcell" className="ui-lg-menu" /> : null}
      </div>
    </div>
  )
}
