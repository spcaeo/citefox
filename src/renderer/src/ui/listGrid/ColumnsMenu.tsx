import type { JSX, ReactNode } from 'react'
import { MenuButton, type MenuItem } from '../Menu'
import { IconButton } from '../IconButton'

export interface ColumnChoice {
  id: string
  label: string
}

/**
 * The shared "Columns" button (grid audit R6, from Check history's picker):
 * a menu that shows or hides each optional column, with a tick on the shown
 * ones. It stays open while someone picks. `onResetWidths` adds "Reset column
 * widths" at the end when any column was resized.
 */
export function ColumnsMenu({
  columns,
  shown,
  onChange,
  onResetWidths,
  footer
}: {
  /** The columns someone may hide, in grid order. */
  columns: readonly ColumnChoice[]
  /** Ids of the ones showing now. */
  shown: readonly string[]
  onChange: (shown: readonly string[]) => void
  /** Null or absent: no column was resized, so there is nothing to reset. */
  onResetWidths?: (() => void) | null
  /** A line under the items, such as "Date, page and status always show." */
  footer?: ReactNode
}): JSX.Element {
  const items: MenuItem[] = columns.map((column) => {
    const on = shown.includes(column.id)
    return {
      id: column.id,
      label: column.label,
      ariaLabel: `${column.label}: ${on ? 'shown' : 'hidden'}`,
      icon: on ? 'check' : 'plus',
      tone: on ? 'ok' : 'default',
      hint: on ? 'Shown' : 'Hidden',
      keepOpen: true,
      onSelect: () => onChange(on ? shown.filter((id) => id !== column.id) : [...shown, column.id])
    }
  })
  if (onResetWidths) {
    items.push({
      id: 'reset-widths',
      label: 'Reset column widths',
      icon: 'refresh',
      groupStart: true,
      onSelect: onResetWidths
    })
  }
  return (
    <MenuButton
      label="Columns"
      items={items}
      width={232}
      footer={footer}
      trigger={({ ref, ...props }) => (
        <IconButton ref={ref} icon="sliders" label="Columns" tip size="sm" {...props} />
      )}
    />
  )
}
