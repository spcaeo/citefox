import type { ExportFormat } from '@shared/domain'
import type { ExportForm } from './model'

export const FORMAT_DEFS: readonly {
  id: ExportFormat
  name: string
  ext: string
  desc: string
}[] = [
  {
    id: 'html',
    name: 'HTML report',
    ext: '.zip',
    desc: 'Interactive and works offline. Click any number to see the questions behind it.'
  },
  {
    id: 'pdf',
    name: 'PDF',
    ext: '.pdf',
    desc: 'The same sections, ready to print or send to a client.'
  },
  {
    id: 'xlsx',
    name: 'Excel workbook',
    ext: '.xlsx',
    desc: 'One sheet per section table, plus every question.'
  },
  { id: 'csv', name: 'CSV tables', ext: '.zip', desc: 'One file per table, zipped.' },
  { id: 'json', name: 'JSON', ext: '.json', desc: 'Every field in schema v2, for scripts.' }
]

/** Short names: the format picker's segments. */
export const FORMAT_SHORT: Record<ExportFormat, string> = {
  html: 'HTML',
  pdf: 'PDF',
  xlsx: 'Excel',
  csv: 'CSV',
  json: 'JSON'
}

/** The screen's one primary action, such as "Save HTML report". */
export function saveLabel(format: ExportFormat): string {
  const name = FORMAT_DEFS.find((item) => item.id === format)?.name ?? FORMAT_SHORT[format]
  return `Save ${name}`
}

/** File extension main writes for this format. HTML is a zip unless packaged as one file. */
export function fileExtension(format: ExportFormat, htmlPackaging: 'zip' | 'file' = 'zip'): string {
  if (format === 'html') return htmlPackaging === 'file' ? 'html' : 'zip'
  if (format === 'csv') return 'zip'
  return format
}

/** Short name in the summary. */
export function formatSummary(form: ExportForm): string {
  switch (form.format) {
    case 'html':
      return form.htmlPackaging === 'file' ? 'HTML report · index.html' : 'HTML report · .zip'
    case 'pdf':
      return `PDF · ${form.pageSize === 'letter' ? 'Letter' : 'A4'}`
    case 'xlsx':
      return 'Excel workbook (.xlsx)'
    case 'csv':
      return 'CSV tables · zipped'
    case 'json':
      return 'JSON · schema v2'
  }
}

/**
 * Rows of the CSV-shaped preview (`exports:preview` text for CSV and Excel).
 * Other previews are prose, so they stay empty here. A trailing blank line is dropped.
 */
export function previewGridRows(preview: string, format: ExportFormat): string[][] {
  if (format !== 'csv' && format !== 'xlsx') return []
  const text = preview.replace(/^\uFEFF/, '').trim()
  if (!text.includes(',')) return []
  const rows = parsePreviewCsv(text).filter((row) => row.some((cell) => cell.length > 0))
  if (rows.length === 0 || (rows[0]?.length ?? 0) < 2) return []
  return rows
}

/** RFC 4180 subset for the preview string this screen shows. */
function parsePreviewCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? ''
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      pushField()
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      pushRow()
      continue
    }
    field += char
  }
  if (field.length > 0 || row.length > 0) pushRow()
  return rows
}
