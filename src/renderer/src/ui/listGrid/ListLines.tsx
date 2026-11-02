import type { CSSProperties, JSX, ReactNode } from 'react'
import { CellDrill } from './CellDrill'
import { CopyText } from '../CopyText'
import type { RowIndex, TableLine } from '../../grid/model/rows'
import { IconButton } from '../IconButton'
import type { MenuItem } from '../Menu'
import { RowMenu } from '../RowMenu'
import { UiIcon } from '../UiIcon'
import { cellClasses } from './columns'
import { pinCell, type PinCell, type PinPlan } from './pin'
import type { ListColumn, ListGroup, RowDataAttributes } from './types'

export const ROW_HEIGHT = 44

/** Expandable row detail ({@link ListGridProps.renderDetail}), resolved for the lines. */
export interface LineDetail<Row> {
  render: (row: Row) => ReactNode
  has: (row: Row) => boolean
  label: (row: Row) => string
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  /** The detail region's id for a row key (the button's aria-controls). */
  id: (key: string) => string
}

/** One body cell: the column's content, its drill (every number drills) and its copy icon (R10). */
export function ListCell<Row>({
  column,
  row,
  lead,
  style,
  pin
}: {
  column: ListColumn<Row>
  row: Row
  /** Before the content, such as a tree row's indent. */
  lead?: ReactNode
  style?: CSSProperties
  /** Stays in place while the grid scrolls sideways (audit2 #6). */
  pin?: PinCell | null | undefined
}): JSX.Element {
  const drill = column.drill?.(row) ?? null
  const content = drill ? (
    <CellDrill drill={drill}>{column.render(row)}</CellDrill>
  ) : (
    column.render(row)
  )
  const copy = column.copy?.(row) ?? null
  return (
    <div role="gridcell" {...pinCell(pin, cellClasses(column), style)}>
      {lead}
      {copy ? <CopyText text={copy} label={content} className="ui-lg-copy" /> : content}
    </div>
  )
}

/** Leaves out undefined values so a row carries only the attributes that apply. */
function dataAttributes(attributes: RowDataAttributes | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!attributes) return out
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('data-') && value !== undefined) out[name] = String(value)
  }
  return out
}

/** The body lines in view: sticky group headers and rows (44px, or taller when cells wrap). */
export function ListLines<Row>({
  index,
  lines,
  start,
  end,
  columns,
  template,
  rowKey,
  rowLabel,
  group,
  selectable,
  isSelected,
  onToggleRow,
  onToggleGroup,
  rowMenu,
  isRowCurrent,
  rowProps,
  rowOrdinal,
  detail,
  colCount,
  pins
}: {
  index: RowIndex<Row>
  lines: readonly TableLine[]
  start: number
  end: number
  columns: readonly ListColumn<Row>[]
  template: string
  rowKey: (row: Row) => string
  rowLabel: (row: Row) => string
  group: ListGroup<Row> | undefined
  selectable: boolean
  isSelected: (key: string) => boolean
  onToggleRow: (key: string) => void
  onToggleGroup: (key: string) => void
  rowMenu: ((row: Row) => readonly MenuItem[]) | undefined
  isRowCurrent: ((row: Row) => boolean) | undefined
  rowProps: ((row: Row, index: number) => RowDataAttributes) | undefined
  /** A row line's place among the rows shown (group headers left out). */
  rowOrdinal: readonly number[]
  detail: LineDetail<Row> | null
  colCount: number
  /** The cells that stay in place while the grid scrolls sideways. */
  pins: PinPlan
}): JSX.Element {
  const wraps = columns.some((column) => column.wrap)
  return (
    <>
      {lines.slice(start, end).map((line, offset) => {
        const at = start + offset
        if (line.kind === 'group') {
          const groupRows = line.indices.map((item) => index.rows[item] as Row)
          const meta = group?.meta?.(groupRows, line.key)
          return (
            <div
              key={`group:${line.key}`}
              role="row"
              className="ui-lg-group"
              data-line={at}
              data-line-key={`group:${line.key}`}
              tabIndex={-1}
              aria-rowindex={at + 2}
            >
              <div role="gridcell" aria-colspan={colCount} className="ui-lg-group-cell">
                <button
                  type="button"
                  className="ui-lg-gbtn"
                  aria-expanded={line.open}
                  onClick={() => onToggleGroup(line.key)}
                >
                  <span className={line.open ? 'ui-lg-caret open' : 'ui-lg-caret'}>
                    <UiIcon name="chevron-right" />
                  </span>
                  {line.label}
                </button>
                <span className="ui-lg-count num">{line.count.toLocaleString('en-US')}</span>
                {meta ? <span className="ui-lg-meta">{meta}</span> : null}
              </div>
            </div>
          )
        }
        const row = index.rows[line.index] as Row
        const key = rowKey(row)
        const selected = selectable && isSelected(key)
        const current = isRowCurrent?.(row) ?? false
        const name = rowLabel(row)
        const expandable = detail !== null && detail.has(row)
        const open = expandable && detail.isOpen(key)
        const classes = [
          'ui-lg-row',
          wraps ? 'wrap' : '',
          open ? 'open' : '',
          selected ? 'sel' : '',
          current ? 'cur' : ''
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={key}
            {...dataAttributes(rowProps?.(row, rowOrdinal[at] ?? 0))}
            role="row"
            className={classes}
            data-line={at}
            data-line-key={`row:${key}`}
            data-row={at}
            tabIndex={-1}
            aria-rowindex={at + 2}
            aria-selected={selectable ? selected : undefined}
            aria-current={current ? 'true' : undefined}
            style={{ gridTemplateColumns: template }}
          >
            {selectable ? (
              <div role="gridcell" {...pinCell(pins.select, 'ui-lg-check')}>
                <input
                  type="checkbox"
                  className="ui-lg-cb"
                  aria-label={`Select ${name}`}
                  checked={selected}
                  onChange={() => onToggleRow(key)}
                />
              </div>
            ) : null}
            {columns.map((column) => (
              <ListCell
                key={column.id}
                column={column}
                row={row}
                pin={pins.columns.get(column.id)}
              />
            ))}
            {detail ? (
              <div role="gridcell" className="ui-lg-expand">
                {expandable ? (
                  <IconButton
                    icon="chevron-right"
                    size="sm"
                    className={open ? 'ui-lg-toggle open' : 'ui-lg-toggle'}
                    label={`${open ? 'Hide' : 'Show'} ${detail.label(row)}`}
                    aria-expanded={open}
                    aria-controls={detail.id(key)}
                    onClick={() => detail.toggle(key)}
                  />
                ) : null}
              </div>
            ) : null}
            {rowMenu ? (
              <div role="gridcell" className="ui-lg-menu">
                <RowMenu label={`Actions for ${name}`} items={rowMenu(row)} />
              </div>
            ) : null}
            {open ? (
              // Clicks and keys inside the detail stay there (data-no-row-open).
              <div
                role="gridcell"
                id={detail.id(key)}
                aria-colspan={colCount}
                className="ui-lg-detail"
                data-no-row-open=""
              >
                {detail.render(row)}
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
