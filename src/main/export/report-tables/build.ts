import type { CitationClass, CitationSourceType, ReportSectionId } from '@shared/domain'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import {
  boolCell,
  dateCell,
  numberCell,
  percentCell,
  textCell,
  type Cell,
  type ColumnDef,
  type ExportTable
} from '../cells'
import type { Count, EmptyState, ReportModel, ReportRow } from '../model/types'

/** Table helpers shared by the section table builders. */

/** A table before its sheet name is made unique and its CSV file is numbered. */
export interface DraftTable {
  id: string
  sheetName: string
  columns: readonly ColumnDef[]
  rows: readonly (readonly Cell[])[]
}

/** A column header, optionally totalled in the XLSX and CSV totals row. */
export type ColumnSpec = string | { header: string; total: true }

export function draft(
  id: string,
  sheetName: string,
  specs: readonly ColumnSpec[],
  rows: readonly (readonly Cell[])[]
): DraftTable {
  return {
    id,
    sheetName,
    columns: specs.map((spec) =>
      typeof spec === 'string'
        ? { header: spec, total: false }
        : { header: spec.header, total: true }
    ),
    rows
  }
}

export function total(header: string): ColumnSpec {
  return { header, total: true }
}

/** One row that explains why a section has no data, so the workbook says so too. */
export function emptyTable(section: ReportSectionId, empty: EmptyState): DraftTable {
  return draft(
    `${section.replaceAll('_', '-')}-empty`,
    REPORT_SECTION_COPY[section].title,
    ['Section', 'Status', 'Message', 'Next step'],
    [
      [
        textCell(REPORT_SECTION_COPY[section].title),
        textCell(empty.title),
        textCell(empty.message),
        textCell(empty.nextStep)
      ]
    ]
  )
}

/** Helpers that look things up in the model. */
export interface TableContext {
  model: ReportModel
  marketLabel(marketId: string): string
  pagePath(pageId: string): string
  row(rowId: string): ReportRow | undefined
}

export function tableContext(model: ReportModel): TableContext {
  const markets = new Map(model.markets.map((market) => [market.id, market.label]))
  const pages = new Map(model.pages.map((page) => [page.id, page.path]))
  const rows = new Map(model.rows.map((row) => [row.id, row]))
  return {
    model,
    marketLabel: (marketId) => markets.get(marketId) ?? marketId,
    pagePath: (pageId) => pages.get(pageId) ?? pageId,
    row: (rowId) => rows.get(rowId)
  }
}

export const n = (count: Count | null | undefined): Cell => numberCell(count?.n)
export const num = numberCell
export const pct = percentCell
export const text = textCell
export const date = dateCell
export const bool = boolCell

/** Regional-indicator flags are dropped: tables show `US · EN`. */
export function withoutFlag(value: string): string {
  return value.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim()
}

/** A share of a whole as a whole percentage cell, blank when the whole is 0. */
export function share(part: number, whole: number): Cell {
  if (whole <= 0) return { kind: 'blank' }
  return percentCell(Math.round((part / whole) * 100))
}

/** A 0–1 ratio as a whole percentage cell. */
export function ratio(value: number | null): Cell {
  if (value === null || !Number.isFinite(value)) return { kind: 'blank' }
  return percentCell(Math.round(value * 100))
}

export const CLASSIFICATION_LABELS: Record<CitationClass, string> = {
  target: 'Tracked page',
  own: 'Own page',
  competitor: 'Competitor',
  other: 'Other'
}

export const SOURCE_TYPE_LABELS: Record<CitationSourceType, string> = {
  web: 'Web page',
  youtube: 'YouTube',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  review: 'Review site',
  forum: 'Forum',
  other: 'Other'
}

export const WHO_LABELS = { you: 'You', competitor: 'Competitor', observed: 'Observed' } as const

const FORBIDDEN_SHEET_CHARS = /[:\\/?*[\]]/g
const MAX_SHEET_NAME = 31

/**
 * Excel-safe, unique sheet names (31 characters, none of `: \ / ? * [ ]`) and numbered
 * CSV file names `<nn>-<id>.csv`, in table order.
 */
export function finishTables(drafts: readonly DraftTable[]): ExportTable[] {
  const used = new Set<string>()
  const width = Math.max(2, String(drafts.length).length)
  return drafts.map((table, index) => {
    const sheetName = uniqueSheetName(table.sheetName, used)
    used.add(sheetName.toLowerCase())
    return {
      id: table.id,
      sheetName,
      fileName: `${String(index + 1).padStart(width, '0')}-${table.id}.csv`,
      columns: table.columns,
      rows: table.rows
    }
  })
}

function uniqueSheetName(wanted: string, used: ReadonlySet<string>): string {
  const base = cleanSheetName(wanted)
  if (!used.has(base.toLowerCase())) return base
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` (${suffix})`
    const candidate = `${base.slice(0, MAX_SHEET_NAME - tail.length).trimEnd()}${tail}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

function cleanSheetName(value: string): string {
  const cleaned = withoutFlag(value)
    .replace(FORBIDDEN_SHEET_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, MAX_SHEET_NAME)
    .trimEnd()
  return cleaned.length > 0 ? cleaned : 'Sheet'
}
