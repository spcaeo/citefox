import type { JSX } from 'react'
import { alignOf } from './columns'
import type { ListColumn } from './types'

/** How many placeholder rows show while a grid loads. */
export const LOADING_ROWS = 6

/**
 * Placeholder rows while a grid loads (grid audit R13): the real header above
 * soft bars in each column, so the page keeps its shape and nothing jumps
 * when the rows arrive. Screen readers hear "Loading" once.
 */
export function LoadingRows<Row>({
  columns,
  template,
  label
}: {
  columns: readonly ListColumn<Row>[]
  template: string
  label: string
}): JSX.Element {
  return (
    <div role="rowgroup" aria-busy="true" aria-label={`Loading ${label}`}>
      {Array.from({ length: LOADING_ROWS }, (_, row) => (
        <div
          key={row}
          role="row"
          className="ui-lg-row ui-lg-row-loading"
          aria-hidden="true"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((column, at) => (
            <div
              key={column.id}
              className={alignOf(column) === 'end' ? 'ui-lg-td ui-lg-end' : 'ui-lg-td'}
            >
              <span
                className="ui-lg-skel"
                style={{
                  width: column.width === 'fill' ? `${70 - ((row * 7 + at * 13) % 30)}%` : '60%'
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
