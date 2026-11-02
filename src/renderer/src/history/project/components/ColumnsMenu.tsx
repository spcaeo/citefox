import type { JSX } from 'react'
import { ColumnsMenu as SharedColumnsMenu } from '../../../ui/listGrid/ColumnsMenu'
import { OPTIONAL_COLUMNS, type ColumnId } from '../model'

/**
 * Columns: show or hide the grid's optional columns, with the shared Columns
 * button. The choice is in the URL (`cols=`), so a copied link shows the same
 * grid. Date, the page or topic and the status always show.
 */
export function ColumnsMenu({
  shown,
  onChange
}: {
  shown: readonly ColumnId[]
  onChange: (next: readonly ColumnId[]) => void
}): JSX.Element {
  return (
    <SharedColumnsMenu
      columns={OPTIONAL_COLUMNS}
      shown={shown}
      onChange={(next) =>
        onChange(OPTIONAL_COLUMNS.map((column) => column.id).filter((id) => next.includes(id)))
      }
      footer="Date, page and status always show."
    />
  )
}
