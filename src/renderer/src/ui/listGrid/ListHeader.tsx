import type { JSX, MouseEvent } from 'react'
import type { GridSortKey } from '@shared/domain'
import { UiIcon } from '../UiIcon'
import { alignOf, isResizable, sortOf } from './columns'
import { NO_PINS, pinCell, type PinPlan } from './pin'
import { ResizeHandle } from './ResizeHandle'
import type { ListColumn } from './types'

/** Column resizing for the header: each set-width column gets a drag edge. */
export interface HeaderResize {
  /** The column's width now (someone's or its own). */
  widthOf: (id: string) => number
  onResize: (id: string, width: number, commit: boolean) => void
  onReset: (id: string) => void
  onDragging: (dragging: boolean) => void
}

export type PageCheck = 'all' | 'some' | 'none'

function ariaSort(
  sort: readonly GridSortKey[],
  id: string
): 'ascending' | 'descending' | 'none' | undefined {
  const at = sort.findIndex((key) => key.key === id)
  if (at !== 0) return at > 0 ? undefined : 'none'
  return sort[0]?.dir === 'desc' ? 'descending' : 'ascending'
}

/**
 * The 40px header row: select-all, sortable column headers with arrows, and
 * the expand and menu columns.
 */
export function ListHeader<Row>({
  columns,
  sort,
  template,
  selectable,
  pageCheck,
  onTogglePage,
  menu,
  detail = false,
  onSort,
  resize,
  pins = NO_PINS
}: {
  columns: readonly ListColumn<Row>[]
  sort: readonly GridSortKey[]
  template: string
  selectable: boolean
  pageCheck: PageCheck
  onTogglePage: () => void
  menu: boolean
  /** Rows expand (`renderDetail`): a column for the expand button. */
  detail?: boolean
  onSort: (id: string, additive: boolean) => void
  /** Absent: no drag edges. */
  resize?: HeaderResize
  /** The cells that stay in place while the grid scrolls sideways. */
  pins?: PinPlan
}): JSX.Element {
  return (
    <div role="rowgroup" className="ui-lg-headgroup">
      <div
        role="row"
        aria-rowindex={1}
        className="ui-lg-head"
        style={{ gridTemplateColumns: template }}
      >
        {selectable ? (
          <div role="columnheader" {...pinCell(pins.select, 'ui-lg-check')}>
            <input
              type="checkbox"
              className="ui-lg-cb"
              aria-label="Select every row on this page"
              checked={pageCheck === 'all'}
              ref={(node) => {
                if (node) node.indeterminate = pageCheck === 'some'
              }}
              onChange={onTogglePage}
            />
          </div>
        ) : null}
        {columns.map((column) => {
          const at = sort.findIndex((key) => key.key === column.id)
          const dir = at >= 0 ? sort[at]?.dir : undefined
          const end = alignOf(column) === 'end'
          const sortable = sortOf(column) !== null
          const resizable = resize !== undefined && isResizable(column)
          const text = column.hideLabel ? (
            <span className="sr-only">{column.label}</span>
          ) : (
            column.label
          )
          return (
            <div
              key={column.id}
              role="columnheader"
              data-col={column.id}
              aria-sort={sortable ? ariaSort(sort, column.id) : undefined}
              // The drag edge has its own name; the header stays the column's name.
              aria-label={resizable ? column.label : undefined}
              title={column.hint}
              {...pinCell(pins.columns.get(column.id), end ? 'ui-lg-th ui-lg-end' : 'ui-lg-th')}
            >
              {sortable ? (
                <button
                  type="button"
                  className={dir ? 'ui-lg-sort on' : 'ui-lg-sort'}
                  onClick={(event: MouseEvent<HTMLButtonElement>) =>
                    onSort(column.id, event.shiftKey)
                  }
                >
                  {text}
                  <UiIcon
                    name={dir === 'asc' ? 'arrow-up' : dir === 'desc' ? 'arrow-down' : 'sort-both'}
                    size={12}
                    className={dir ? 'ui-lg-arrow on' : 'ui-lg-arrow'}
                  />
                </button>
              ) : (
                text
              )}
              {resize && resizable ? (
                <ResizeHandle
                  label={column.label}
                  width={resize.widthOf(column.id)}
                  onResize={(width, commit) => resize.onResize(column.id, width, commit)}
                  onReset={() => resize.onReset(column.id)}
                  onDragging={resize.onDragging}
                />
              ) : null}
            </div>
          )
        })}
        {detail ? (
          <div role="columnheader" className="ui-lg-th">
            <span className="sr-only">Details</span>
          </div>
        ) : null}
        {menu ? (
          <div role="columnheader" className="ui-lg-th">
            <span className="sr-only">Actions</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
