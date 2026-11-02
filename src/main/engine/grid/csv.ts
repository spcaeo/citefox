import { writeFile } from 'node:fs/promises'
import type { GridCsvRequest, GridCsvResult } from '@shared/ipc'
import { cellCsv, formatNumber, textCell } from '../../export/cells'
import { encodeCsv } from '../../export/csv'
import type { ExportSaveDialog } from '../../export/ipc'

/**
 * FR-21.1 and FR-21.8. One CSV of what the grid shows: UTF-8 with a BOM so
 * Excel opens it cleanly, formula text neutralized, known secrets redacted
 * (the same cell rules as Export, `export/cells.ts`).
 */
export function gridCsvText(request: GridCsvRequest, secrets: readonly string[]): string {
  const header = request.header.map((cell) => cellCsv(textCell(cell), secrets))
  const rows = request.rows.map((row) =>
    row.map((cell) => {
      if (cell === null) return ''
      if (typeof cell === 'number') return formatNumber(cell)
      return cellCsv(textCell(cell), secrets)
    })
  )
  return encodeCsv([header, ...rows], ',', true)
}

export async function exportGridCsv(
  request: GridCsvRequest,
  deps: {
    dialog: ExportSaveDialog | null
    secrets: readonly string[]
    write?: (filePath: string, text: string) => Promise<void>
  }
): Promise<GridCsvResult> {
  if (deps.dialog === null) {
    return { ok: false, reason: 'failed', message: 'Could not open the save dialog. Try again.' }
  }
  const picked = await deps.dialog({
    title: 'Export CSV',
    defaultPath: request.fileName,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (picked.canceled || picked.filePath === undefined || picked.filePath.length === 0) {
    return { ok: false, reason: 'cancelled', message: 'Export cancelled. Nothing was saved.' }
  }
  const text = gridCsvText(request, deps.secrets)
  const write =
    deps.write ?? ((filePath: string, body: string) => writeFile(filePath, body, 'utf8'))
  try {
    await write(picked.filePath, text)
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: 'Could not write the CSV. Choose another folder and try again.'
    }
  }
  return {
    ok: true,
    rowCount: request.rows.length,
    columnCount: request.header.length,
    fileName: baseName(picked.filePath)
  }
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}
