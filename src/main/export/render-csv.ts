import { encodeCsv } from './csv'
import {
  RENDER_BATCH,
  cellCsv,
  hasTotals,
  totalsRow,
  yieldToEventLoop,
  type ExportTable
} from './cells'
import type { ZipEntry } from './zip'

/** One CSV file per table, named by `table.fileName`, for the CSV zip (FR-22.2). */
export async function renderCsvEntries(
  tables: readonly ExportTable[],
  delimiter: ',' | ';',
  bom: boolean,
  secrets: readonly string[],
  onRow: (done: number, total: number) => void
): Promise<ZipEntry[]> {
  const total = tables.reduce((sum, table) => sum + table.rows.length, 0)
  let done = 0
  const entries: ZipEntry[] = []

  for (const table of tables) {
    const lines: string[][] = [table.columns.map((column) => column.header)]
    for (const row of table.rows) {
      lines.push(row.map((cell) => cellCsv(cell, secrets)))
      done += 1
      if (done === total || done % RENDER_BATCH === 0) {
        onRow(done, Math.max(total, 1))
        await yieldToEventLoop()
      }
    }
    if (hasTotals(table)) lines.push(totalsRow(table).map((cell) => cellCsv(cell, secrets)))
    entries.push({
      name: table.fileName,
      data: Buffer.from(encodeCsv(lines, delimiter, bom), 'utf8')
    })
  }

  if (total === 0) onRow(1, 1)
  return entries
}

/** Header plus up to three data rows, for the export preview (FR-22.4). */
export function previewCsv(
  table: ExportTable,
  delimiter: ',' | ';',
  secrets: readonly string[]
): string {
  const lines: string[][] = [table.columns.map((column) => column.header)]
  for (const row of table.rows.slice(0, 3)) {
    lines.push(row.map((cell) => cellCsv(cell, secrets)))
  }
  return encodeCsv(lines, delimiter, false).replaceAll('\r\n', '\n').trimEnd()
}

export function estimateCsvBytes(
  tables: readonly ExportTable[],
  delimiter: ',' | ';',
  bom: boolean,
  secrets: readonly string[]
): number {
  let bytes = 0
  for (const table of tables) {
    const lines: string[][] = [table.columns.map((column) => column.header)]
    for (const row of table.rows) lines.push(row.map((cell) => cellCsv(cell, secrets)))
    if (hasTotals(table)) lines.push(totalsRow(table).map((cell) => cellCsv(cell, secrets)))
    bytes += Buffer.byteLength(encodeCsv(lines, delimiter, bom), 'utf8')
    bytes += 64
  }
  return bytes + 22
}
