import { redactString } from '../logging'
import { neutralizeFormula } from './formula'

/**
 * CSV dates are ISO-8601 UTC with milliseconds (`2026-10-19T16:00:00.000Z`).
 * XLSX writes that instant as a date cell formatted `yyyy-mm-dd hh:mm:ss`,
 * using the UTC clock time so the displayed value does not shift with the computer's zone.
 */
export const EXPORT_DATE_FORMAT = 'ISO-8601 UTC'
export const XLSX_DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss'
/** A whole percentage. CSV writes `35%`; XLSX writes 0.35 formatted as a percentage. */
export const XLSX_PERCENT_FORMAT = '0%'
export const TOTAL_LABEL = 'Total'
export const STALENESS_NOTICE = 'Data is more than 7 days old. Run a check for fresh data.'
export const RENDER_BATCH = 400

export type Cell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'percent'; value: number }
  | { kind: 'date'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'blank' }

export interface ColumnDef {
  header: string
  total: boolean
}

export interface ExportTable {
  id: string
  sheetName: string
  fileName: string
  columns: readonly ColumnDef[]
  rows: readonly (readonly Cell[])[]
}

export function textCell(value: string | null | undefined): Cell {
  if (value === null || value === undefined || value.length === 0) return { kind: 'blank' }
  return { kind: 'text', value }
}

/** Shown wherever an export prints a missing prompt-set version. */
export const UNKNOWN_PROMPT_SET_VERSION = 'version unknown'

export function promptSetVersionCell(version: number | null): Cell {
  if (version === null) return textCell(UNKNOWN_PROMPT_SET_VERSION)
  return numberCell(version)
}

export function numberCell(value: number | null | undefined): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return { kind: 'blank' }
  return { kind: 'number', value }
}

/** A whole percentage 0–100. Null is a blank cell. */
export function percentCell(value: number | null | undefined): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return { kind: 'blank' }
  return { kind: 'percent', value }
}

export function dateCell(value: string | null | undefined): Cell {
  if (value === null || value === undefined || value.length === 0) return { kind: 'blank' }
  return { kind: 'date', value }
}

export function boolCell(value: boolean | null | undefined): Cell {
  if (value === null || value === undefined) return { kind: 'blank' }
  return { kind: 'bool', value }
}

export function columns(headers: readonly string[], totals: ReadonlySet<string>): ColumnDef[] {
  return headers.map((header) => ({ header, total: totals.has(header) }))
}

/**
 * Text for a CSV field.
 * Numbers, dates, and booleans are written as themselves.
 * Only text is redacted, then formula characters are neutralized.
 */
export function cellCsv(cell: Cell | undefined, secrets: readonly string[]): string {
  if (cell === undefined || cell.kind === 'blank') return ''
  if (cell.kind === 'bool') return cell.value ? 'true' : 'false'
  if (cell.kind === 'number') return formatNumber(cell.value)
  if (cell.kind === 'percent') return `${formatNumber(cell.value)}%`
  if (cell.kind === 'date') return cell.value
  return neutralizeFormula(redactString(cell.value, { secrets, hexKeys: false }))
}

/** True when at least one column is totalled, so a totals row makes sense. */
export function hasTotals(table: ExportTable): boolean {
  return table.columns.some((column) => column.total)
}

export function totalsRow(table: ExportTable): Cell[] {
  return table.columns.map((column, index) => {
    if (index === 0) return { kind: 'text', value: TOTAL_LABEL }
    if (!column.total) return { kind: 'blank' }
    let sum = 0
    for (const row of table.rows) {
      const cell = row[index]
      if (cell?.kind === 'number') sum += cell.value
    }
    return { kind: 'number', value: sum }
  })
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Object.is(value, -0)) return '0'
  return String(value)
}

/** UTC fields copied onto the local clock so Excel shows the UTC time. */
export function utcWallTime(iso: string): Date | null {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
    parsed.getUTCMilliseconds()
  )
}

export function joinParts(parts: readonly string[]): Cell {
  const cleaned = parts.map((part) => part.trim()).filter((part) => part.length > 0)
  if (cleaned.length === 0) return { kind: 'blank' }
  return { kind: 'text', value: cleaned.join(' | ') }
}

export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}
