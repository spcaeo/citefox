import * as ExcelJS from 'exceljs'

/**
 * Excel files for the importer, read with exceljs (already a dependency for exports).
 * Values, not formulas: a formula cell gives its last result. Hidden sheets are left
 * out of the sheet list. A merged header cell repeats its value in each column it
 * covers, so every column keeps a name. Dates come back as YYYY-MM-DD.
 */

export interface XlsxSheet {
  name: string
  rows: string[][]
}

export interface XlsxBook {
  /** Visible sheets, in workbook order. */
  sheets: XlsxSheet[]
}

export async function readXlsx(
  bytes: Uint8Array,
  limits: { rows: number; columns: number }
): Promise<XlsxBook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  const sheets: XlsxSheet[] = []
  for (const sheet of workbook.worksheets) {
    if (sheet.state === 'hidden' || sheet.state === 'veryHidden') continue
    sheets.push({ name: sheet.name, rows: sheetRows(sheet, limits) })
  }
  return { sheets }
}

function sheetRows(
  sheet: ExcelJS.Worksheet,
  limits: { rows: number; columns: number }
): string[][] {
  const rows: string[][] = []
  const width = Math.min(sheet.columnCount, limits.columns)
  // One more than the limit, so the caller can say rows were left out.
  const last = Math.min(sheet.rowCount, limits.rows + 2)
  for (let r = 1; r <= last; r += 1) {
    const row = sheet.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= width; c += 1) cells.push(cellText(row.getCell(c)))
    if (cells.some((cell) => cell.trim().length > 0)) rows.push(cells)
  }
  return rows
}

function cellText(cell: ExcelJS.Cell): string {
  // A merged cell reads its master's value.
  const source = cell.isMerged ? cell.master : cell
  return valueText(source.value)
}

function valueText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('')
    }
    if ('formula' in value || 'sharedFormula' in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result
      return result === undefined ? '' : valueText(result as ExcelJS.CellValue)
    }
    if ('hyperlink' in value) {
      const link = value as { text?: unknown; hyperlink?: unknown }
      if (typeof link.text === 'string') return link.text
      if (typeof link.text === 'object' && link.text !== null && 'richText' in link.text) {
        return valueText(link.text as ExcelJS.CellValue)
      }
      return typeof link.hyperlink === 'string' ? link.hyperlink : ''
    }
    if ('error' in value) return ''
  }
  return ''
}

/** A one-sheet workbook (the import template): header row in bold, then the rows. */
export async function writeXlsx(
  sheetName: string,
  header: readonly string[],
  rows: readonly (readonly string[])[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.addRow([...header]).font = { bold: true }
  for (const row of rows) sheet.addRow([...row])
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 60 : 22
  })
  const written = await workbook.xlsx.writeBuffer()
  return Buffer.from(written as ArrayBuffer)
}
