import type { JSX, ReactNode } from 'react'
import type { MenuItem } from '../../Menu'
import { RowMenu } from '../../RowMenu'
import { UiIcon } from '../../UiIcon'
import { cellClasses } from '../columns'
import { ListCell } from '../ListLines'
import { pinCell, type PinPlan } from '../pin'
import type { ListColumn, ListTree, ListTreeGroup, RowDataAttributes } from '../types'
import { publicGroup, TREE_CARET, TREE_INDENT, type TreeLine, type TreeNode } from './model'

function dataAttributes(attributes: RowDataAttributes | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!attributes) return out
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('data-') && value !== undefined) out[name] = String(value)
  }
  return out
}

export interface TreeLinesProps<Row> {
  lines: readonly TreeLine<Row>[]
  start: number
  end: number
  columns: readonly ListColumn<Row>[]
  template: string
  treeColumn: string
  tree: ListTree<Row>
  rowLabel: (row: Row) => string
  selectable: boolean
  isSelected: (key: string) => boolean
  onToggleRow: (key: string) => void
  onToggleGroup: (node: TreeNode<Row>) => void
  onShowMore: (node: TreeNode<Row>) => void
  rowMenu: ((row: Row) => readonly MenuItem[]) | undefined
  isRowCurrent: ((row: Row) => boolean) | undefined
  rowProps: ((row: Row, index: number) => RowDataAttributes) | undefined
  colCount: number
  noun: readonly [string, string]
  /** A leaf line's place among the leaves shown (group and "more" lines left out). */
  leafOrdinal: readonly number[]
  /** The cells that stay in place while the grid scrolls sideways. */
  pins: PinPlan
}

/**
 * The tree lines in view: group rows (arrow, label, totals in the normal
 * columns), leaf rows indented under them, and "Show N more" lines.
 */
export function TreeLines<Row>(props: TreeLinesProps<Row>): JSX.Element {
  const { lines, start, end, columns, template, treeColumn, selectable, colCount } = props
  return (
    <>
      {lines.slice(start, end).map((line, offset) => {
        const at = start + offset
        if (line.kind === 'group') {
          return (
            <GroupRow
              key={`group:${line.node.id}`}
              at={at}
              node={line.node}
              open={line.open}
              {...props}
            />
          )
        }
        if (line.kind === 'more') {
          const indent = (line.depth + 1) * TREE_INDENT + TREE_CARET
          return (
            <div
              key={`more:${line.node.id}`}
              role="row"
              className="ui-lg-row ui-lg-tree-more"
              data-line={at}
              data-line-key={`more:${line.node.id}`}
              data-tree-more=""
              tabIndex={-1}
              aria-rowindex={at + 2}
              aria-level={line.depth + 2}
            >
              <div role="gridcell" aria-colspan={colCount} style={{ paddingLeft: indent }}>
                <button
                  type="button"
                  className="ui-lg-tree-morebtn"
                  onClick={() => props.onShowMore(line.node)}
                >
                  Show {line.hidden.toLocaleString('en-US')} more
                  <span className="sr-only">
                    {' '}
                    {line.hidden === 1 ? props.noun[0] : props.noun[1]} in {line.node.label}
                  </span>
                </button>
              </div>
            </div>
          )
        }
        const { row, key } = line
        const selected = selectable && props.isSelected(key)
        const current = props.isRowCurrent?.(row) ?? false
        const name = props.rowLabel(row)
        const indent = line.depth * TREE_INDENT + (line.depth > 0 ? TREE_CARET : 0)
        const classes = [
          'ui-lg-row',
          'ui-lg-tree-leaf',
          selected ? 'sel' : '',
          current ? 'cur' : ''
        ]
          .filter(Boolean)
          .join(' ')
        const ordinal = props.leafOrdinal[at] ?? 0
        return (
          <div
            key={`row:${key}`}
            {...dataAttributes(props.rowProps?.(row, ordinal))}
            role="row"
            className={classes}
            data-line={at}
            data-line-key={`row:${key}`}
            data-row={at}
            tabIndex={-1}
            aria-rowindex={at + 2}
            aria-level={line.depth + 1}
            aria-selected={selectable ? selected : undefined}
            aria-current={current ? 'true' : undefined}
            style={{ gridTemplateColumns: template }}
          >
            {selectable ? (
              <div role="gridcell" {...pinCell(props.pins.select, 'ui-lg-check')}>
                <input
                  type="checkbox"
                  className="ui-lg-cb"
                  aria-label={`Select ${name}`}
                  checked={selected}
                  onChange={() => props.onToggleRow(key)}
                />
              </div>
            ) : null}
            {columns.map((column) => (
              <ListCell
                key={column.id}
                column={column}
                row={row}
                pin={props.pins.columns.get(column.id)}
                {...(column.id === treeColumn && indent > 0
                  ? { style: { paddingLeft: indent } }
                  : {})}
              />
            ))}
            {props.rowMenu ? (
              <div role="gridcell" className="ui-lg-menu">
                <RowMenu label={`Actions for ${name}`} items={props.rowMenu(row)} />
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function GroupRow<Row>({
  at,
  node,
  open,
  columns,
  template,
  treeColumn,
  tree,
  selectable,
  rowMenu,
  onToggleGroup,
  pins
}: TreeLinesProps<Row> & { at: number; node: TreeNode<Row>; open: boolean }): JSX.Element {
  const group: ListTreeGroup<Row> = publicGroup(node)
  const label: ReactNode = tree.renderGroup ? (
    tree.renderGroup(group)
  ) : (
    <span className="ui-lg-tree-label">
      {group.lead}
      {group.label}
    </span>
  )
  return (
    <div
      {...dataAttributes(tree.groupProps?.(group))}
      role="row"
      className={`ui-lg-row ui-lg-tree-group ui-lg-tree-l${Math.min(node.depth, 2)}${open ? ' open' : ''}`}
      data-line={at}
      data-line-key={`group:${node.id}`}
      data-group={node.id}
      tabIndex={-1}
      aria-rowindex={at + 2}
      aria-level={node.depth + 1}
      aria-expanded={open}
      style={{ gridTemplateColumns: template }}
    >
      {selectable ? <div role="gridcell" {...pinCell(pins.select, 'ui-lg-check')} /> : null}
      {columns.map((column) =>
        column.id === treeColumn ? (
          <div
            role="gridcell"
            key={column.id}
            {...pinCell(pins.columns.get(column.id), 'ui-lg-td ui-lg-tree-cell', {
              paddingLeft: node.depth * TREE_INDENT
            })}
          >
            <button
              type="button"
              className="ui-lg-tree-toggle"
              aria-expanded={open}
              aria-label={`${open ? 'Close' : 'Open'} ${group.label}`}
              tabIndex={-1}
              onClick={() => onToggleGroup(node)}
            >
              <span className={open ? 'ui-lg-caret open' : 'ui-lg-caret'}>
                <UiIcon name="chevron-right" size={14} />
              </span>
            </button>
            {label}
          </div>
        ) : (
          <div
            role="gridcell"
            key={column.id}
            {...pinCell(pins.columns.get(column.id), cellClasses(column))}
          >
            {column.total ? column.total(node.rows, group) : null}
          </div>
        )
      )}
      {rowMenu ? <div role="gridcell" className="ui-lg-menu" /> : null}
    </div>
  )
}
