import type { PdfExportOptions } from '@shared/domain'
import { formatLongDate, formatShortDate } from '../model/format'
import type { Count, EmptyState, Pct, ReportModel } from '../model/types'
import { speak, type Speech } from './common'

/**
 * The v2 PDF report as a list of blocks, built from the report model only. Every string
 * in a block is already redacted and fitted to the embedded fonts.
 */

/** Chart colours by role. The painter maps them to the brand accent and fixed hues. */
export type Tone = 'accent' | 'blue' | 'aqua' | 'yellow' | 'violet' | 'slate' | 'gray' | 'light'

export interface KpiTile {
  label: string
  value: string
  detail: string | null
  definition: string | null
  accent: boolean
}

export interface BarRow {
  label: string
  value: number
  display: string
  tone: Tone
}

export interface StackedRow {
  label: string
  segments: readonly { tone: Tone; value: number }[]
  display: string
}

export interface LegendItem {
  tone: Tone
  label: string
}

export interface LineSeries {
  label: string
  tone: Tone
  values: readonly (number | null)[]
}

export interface LineChartBlock {
  kind: 'line'
  /** Milliseconds since the epoch, one per check. The x axis is time-true. */
  times: readonly number[]
  partial: readonly boolean[]
  xLabels: readonly string[]
  series: readonly LineSeries[]
  markers: readonly { at: number; label: string }[]
  yLabel: string
}

export type Align = 'left' | 'right'

export interface TableBlock {
  kind: 'table'
  headers: readonly string[]
  rows: readonly (readonly string[])[]
  /** Relative column widths. */
  widths: readonly number[]
  align: readonly Align[]
  /** A 0–100 bar drawn under the text of this column, one value per row. */
  meter?: { column: number; values: readonly (number | null)[] }
  size?: number
}

export interface CoverBlock {
  kind: 'cover'
  eyebrow: string
  title: string
  scope: string
  facts: readonly { label: string; value: string }[]
}

export type ReportBlock =
  | CoverBlock
  | { kind: 'section'; title: string; description: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string; tone: 'lead' | 'body' | 'muted' }
  | { kind: 'kpis'; tiles: readonly KpiTile[] }
  | { kind: 'bars'; rows: readonly BarRow[] }
  | {
      kind: 'stacked'
      rows: readonly StackedRow[]
      legend: readonly LegendItem[]
      scale: 'max' | 'share'
    }
  | LineChartBlock
  | TableBlock
  | { kind: 'empty'; title: string; message: string; nextStep: string | null }
  | { kind: 'list'; items: readonly string[] }
  | { kind: 'faq'; question: string; answer: string; words: string }

/** Rows shown before a long table is cut, with a pointer to the Excel export. */
export const PDF_TABLE_LIMIT = 25
export const PDF_PROMPT_LIMIT = 50

export const EXCEL_POINTER = 'the full table is in the Excel export.'

/** What every section builder gets. */
export interface BlockContext {
  model: ReportModel
  pdf: PdfExportOptions
  speech: Speech
  blocks: ReportBlock[]
  /** Redacted, font-safe text. Flags are dropped and arrows become "›". */
  say(value: string): string
  date(iso: string | null): string
  shortDate(iso: string | null): string
  marketLabel(marketId: string): string
  limit: number
  promptLimit: number
}

export function blockContext(
  model: ReportModel,
  pdf: PdfExportOptions,
  speech: Speech,
  limits: { table: number; prompts: number }
): BlockContext {
  const markets = new Map(model.markets.map((market) => [market.id, market.label]))
  const timeZone = model.cover.timeZone
  const say = (value: string): string => speak(pdfSafe(value), speech)
  return {
    model,
    pdf,
    speech,
    blocks: [],
    say,
    date: (iso) => (iso === null ? '—' : formatLongDate(iso, timeZone)),
    shortDate: (iso) => (iso === null ? '—' : formatShortDate(iso, timeZone)),
    marketLabel: (marketId) => say(markets.get(marketId) ?? marketId),
    limit: limits.table,
    promptLimit: limits.prompts
  }
}

/** Characters the embedded fonts lack, mapped to ones they have. Flags are dropped. */
export function pdfSafe(value: string): string {
  return value
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/\s*→\s*/g, ' › ')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/−/g, '-')
    .replace(/^ +| +$/g, '')
}

export function section(context: BlockContext, title: string, description: string): void {
  context.blocks.push({
    kind: 'section',
    title: context.say(title),
    description: context.say(description)
  })
}

export function h2(context: BlockContext, value: string): void {
  context.blocks.push({ kind: 'h2', text: context.say(value) })
}

export function h3(context: BlockContext, value: string): void {
  context.blocks.push({ kind: 'h3', text: context.say(value) })
}

export function para(
  context: BlockContext,
  value: string,
  tone: 'lead' | 'body' | 'muted' = 'body'
): void {
  if (value.trim().length === 0) return
  context.blocks.push({ kind: 'p', text: context.say(value), tone })
}

export function emptyBlock(context: BlockContext, empty: EmptyState): void {
  context.blocks.push({
    kind: 'empty',
    title: context.say(empty.title),
    message: context.say(empty.message),
    nextStep: empty.nextStep === null ? null : context.say(empty.nextStep)
  })
}

export interface TableSpec {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
  widths: readonly number[]
  /** Columns aligned right (numbers). */
  numeric?: readonly number[]
  meter?: { column: number; values: readonly (number | null)[] }
  size?: number
}

/**
 * Push a table, cut to the context's row limit with a "Showing N of M" pointer to the
 * Excel export. Text is redacted and fitted here.
 */
export function table(context: BlockContext, spec: TableSpec, limit = context.limit): void {
  const shown = spec.rows.slice(0, limit)
  const numeric = new Set(spec.numeric ?? [])
  context.blocks.push({
    kind: 'table',
    headers: spec.headers.map((header) => context.say(header)),
    rows: shown.map((row) => row.map((cell) => context.say(cell))),
    widths: spec.widths,
    align: spec.headers.map((_, index) => (numeric.has(index) ? 'right' : 'left')),
    ...(spec.meter === undefined
      ? {}
      : { meter: { column: spec.meter.column, values: spec.meter.values.slice(0, limit) } }),
    ...(spec.size === undefined ? {} : { size: spec.size })
  })
  if (spec.rows.length > shown.length) {
    para(context, showingLine(shown.length, spec.rows.length), 'muted')
  }
}

/** "Showing 25 of 140 — the full table is in the Excel export." */
export function showingLine(shown: number, total: number): string {
  return `Showing ${grouped(shown)} of ${grouped(total)} — ${EXCEL_POINTER}`
}

export function grouped(value: number): string {
  return Math.trunc(value).toLocaleString('en-US')
}

export function count(value: Count | null | undefined): string {
  return value === null || value === undefined ? '—' : grouped(value.n)
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? grouped(value) : String(Math.round(value * 10) / 10)
}

export function pctText(value: Pct | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`
}

/** Whole percent of a part, or null when the whole is 0. */
export function pctOf(part: number, whole: number): Pct {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/** `1 prompt`, `3 prompts`, with grouped digits. */
export function noun(value: number, singular: string, plural = `${singular}s`): string {
  return `${grouped(value)} ${value === 1 ? singular : plural}`
}

export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

export function signed(value: number): string {
  return value > 0 ? `+${grouped(value)}` : value < 0 ? `-${grouped(-value)}` : '0'
}
