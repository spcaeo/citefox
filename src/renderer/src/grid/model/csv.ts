import type { GridCsvRequest } from '@shared/ipc'
import type { GridColumn } from '../types'

/** FR-21.1. The rows the grid shows, with its visible columns, in its order. */
export function csvRequest<Row>(
  fileName: string,
  columns: readonly GridColumn<Row>[],
  rows: readonly Row[]
): GridCsvRequest {
  return {
    fileName,
    header: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => column.csv(row)))
  }
}
