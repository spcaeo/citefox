import { parseRecords } from '../import/csv'

/** RFC 4180. Fields that contain the delimiter, a quote, or a line break are quoted. */
export function quoteCsvField(value: string, delimiter: ',' | ';'): string {
  const escaped = value.replaceAll('"', '""')
  if (
    escaped.includes('"') ||
    escaped.includes(delimiter) ||
    escaped.includes('\n') ||
    escaped.includes('\r')
  ) {
    return `"${escaped}"`
  }
  return escaped
}

/**
 * Encode rows as CSV.
 * Dates are already ISO-8601 UTC strings. Callers neutralize formula text first.
 * A leading U+FEFF is the UTF-8 BOM Excel uses to detect the encoding (FR-21.8, FR-22.2).
 */
export function encodeCsv(
  rows: readonly (readonly string[])[],
  delimiter: ',' | ';',
  bom: boolean
): string {
  const lines = rows.map((row) =>
    row.map((field) => quoteCsvField(field, delimiter)).join(delimiter)
  )
  const body = `${lines.join('\r\n')}\r\n`
  return bom ? `\uFEFF${body}` : body
}

/** Parse a CSV this module wrote. The delimiter must match the file. */
export function parseCsv(text: string, delimiter: ',' | ';'): string[][] {
  // Blank rows are kept: callers filter them (an export may hold empty lines).
  return parseRecords(text, { delimiter, keepEmpty: true }).map((record) => record.cells)
}
