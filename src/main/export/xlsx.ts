import * as ExcelJS from 'exceljs'
import { redactString } from '../logging'
import { fsyncFile } from './atomic'
import {
  RENDER_BATCH,
  XLSX_DATE_FORMAT,
  XLSX_PERCENT_FORMAT,
  cellCsv,
  hasTotals,
  totalsRow,
  utcWallTime,
  yieldToEventLoop,
  type Cell,
  type ExportTable
} from './cells'
import { neutralizeFormula } from './formula'

export interface XlsxWriteOptions {
  freezeHeaders: boolean
  secrets: readonly string[]
  onRow: (done: number, total: number) => void
}

/**
 * Stream one workbook, one sheet per table. The header row is frozen when `freezeHeaders`
 * is set (FR-22.2). A totals row is added only to tables with a totalled column.
 */
export async function writeXlsx(
  filePath: string,
  tables: readonly ExportTable[],
  options: XlsxWriteOptions
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false
  })
  workbook.creator = 'CiteFox'
  workbook.lastModifiedBy = 'CiteFox'

  const total = tables.reduce((sum, table) => sum + table.rows.length, 0)
  let done = 0

  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.sheetName, {
      views: options.freezeHeaders ? [{ state: 'frozen', ySplit: 1, xSplit: 0 }] : []
    })
    sheet.columns = table.columns.map((column, index) => ({
      header: column.header,
      key: `c${index}`,
      width: columnWidth(column.header, table.rows, index)
    }))
    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true }
    headerRow.commit()

    for (const dataRow of table.rows) {
      writeRow(sheet, dataRow, options.secrets)
      done += 1
      if (done === total || done % RENDER_BATCH === 0) {
        options.onRow(done, total)
        await yieldToEventLoop()
      }
    }

    const totals = hasTotals(table)
    if (totals) writeRow(sheet, totalsRow(table), options.secrets)
    const lastRow = Math.max(table.rows.length + (totals ? 2 : 1), 2)
    const lastColumn = table.columns.length
    if (lastColumn > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: lastRow, column: lastColumn }
      }
    }
    sheet.commit()
  }

  if (total === 0) options.onRow(1, 1)
  await workbook.commit()
  fsyncFile(filePath)
}

function writeRow(
  sheet: ExcelJS.Worksheet,
  cells: readonly Cell[],
  secrets: readonly string[]
): void {
  const row = sheet.addRow(cells.map(() => null))
  cells.forEach((cell, index) => {
    writeCell(row.getCell(index + 1), cell, secrets)
  })
  row.commit()
}

function writeCell(cell: ExcelJS.Cell, value: Cell, secrets: readonly string[]): void {
  if (value.kind === 'blank') {
    cell.value = null
    return
  }
  if (value.kind === 'number') {
    cell.value = value.value
    return
  }
  if (value.kind === 'bool') {
    cell.value = value.value
    return
  }
  if (value.kind === 'percent') {
    cell.value = value.value / 100
    cell.numFmt = XLSX_PERCENT_FORMAT
    return
  }
  if (value.kind === 'date') {
    const date = utcWallTime(value.value)
    if (date === null) {
      cell.value = neutralizeFormula(redactString(value.value, { secrets, hexKeys: false }))
      return
    }
    cell.value = date
    cell.numFmt = XLSX_DATE_FORMAT
    return
  }
  cell.value = cellCsv(value, secrets)
}

function columnWidth(header: string, rows: readonly (readonly Cell[])[], index: number): number {
  let width = header.length
  const sample = Math.min(rows.length, 40)
  for (let rowIndex = 0; rowIndex < sample; rowIndex += 1) {
    const cell = rows[rowIndex]?.[index]
    const length = cell === undefined ? 0 : cellCsv(cell, []).length
    if (length > width) width = length
  }
  return Math.min(48, Math.max(10, width + 2))
}
