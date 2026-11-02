import {
  REPORT_SECTIONS,
  type ExportDestination,
  type ExportFormat,
  type ExportSection,
  type ExportSpec,
  type PdfExportOptions,
  type ReportSectionId
} from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { REPORT_SECTION_COPY } from '@shared/report-copy'

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * What the export covers: the page you came from, pages you pick, a group, a
 * cluster, a topic, a saved All pages view, or the whole project. Every pick
 * kind is sent to main as `selected` with the page ids it resolves to.
 */
export const EXPORT_SCOPE_CHOICES = [
  'page',
  'pages',
  'group',
  'cluster',
  'topic',
  'view',
  'project'
] as const

export type ExportScopeChoice = (typeof EXPORT_SCOPE_CHOICES)[number]

/** The pick kinds: the ones that carry ids (`ExportForm.ids`). */
export type ExportPickKind = Exclude<ExportScopeChoice, 'page' | 'project'>

export function isExportScopeChoice(value: string | null | undefined): value is ExportScopeChoice {
  return typeof value === 'string' && (EXPORT_SCOPE_CHOICES as readonly string[]).includes(value)
}

export function isPickKind(scope: ExportScopeChoice): scope is ExportPickKind {
  return scope !== 'page' && scope !== 'project'
}

/** Data window. `trio` stays out of the UI. */
export type ExportWindow = 'latest' | 'all' | 'range'

/** `all`, or one market id. */
export type ExportMarketChoice = string

export const ALL_MARKETS: ExportMarketChoice = 'all'

export const DEFAULT_FILENAME_PATTERN = '{project}-{page}-{date}.{ext}'

export interface ExportForm {
  scope: ExportScopeChoice
  /** Picked ids for a pick kind (page, group, cluster, topic or view ids). Empty otherwise. */
  ids: readonly string[]
  checks: ExportWindow
  /** Local calendar dates `YYYY-MM-DD`, used only for `range`. */
  from: string
  to: string
  sections: Record<ReportSectionId, boolean>
  format: ExportFormat
  htmlPackaging: 'zip' | 'file'
  pageSize: 'letter' | 'a4'
  charts: boolean
  preparedFor: string
  hideBranding: boolean
  freezeHeaders: boolean
  sheetPerMarket: boolean
  delimiter: 'comma' | 'semicolon'
  bom: boolean
  /** Raw SerpApi data. Sent only with JSON (FR-22.3). */
  includeRaw: boolean
  auto: boolean
  destination: ExportDestination
  email: string
  pattern: string
  logoBase64: string | null
}

export function allSections(on: boolean): Record<ReportSectionId, boolean> {
  return Object.fromEntries(REPORT_SECTIONS.map((id) => [id, on])) as Record<
    ReportSectionId,
    boolean
  >
}

export function defaultExportForm(today: Date = new Date()): ExportForm {
  const monthAgo = new Date(today)
  monthAgo.setDate(monthAgo.getDate() - 30)
  return {
    scope: 'page',
    ids: [],
    checks: 'latest',
    from: localDate(monthAgo),
    to: localDate(today),
    sections: allSections(true),
    format: 'html',
    htmlPackaging: 'zip',
    pageSize: 'letter',
    charts: true,
    preparedFor: '',
    hideBranding: false,
    freezeHeaders: true,
    sheetPerMarket: false,
    delimiter: 'comma',
    bom: true,
    includeRaw: false,
    auto: false,
    destination: 'folder',
    email: '',
    pattern: DEFAULT_FILENAME_PATTERN,
    logoBase64: null
  }
}

/** `YYYY-MM-DD` in local time. */
export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Real project, page, and markets the request is built for. */
export interface ExportBuildSource {
  projectId: string
  /** The page for page scope. Ignored in the other scopes. */
  pageId: string | null
  /** The page (and topic) ids a pick kind resolves to. Ignored for page and project. */
  pageIds?: readonly string[]
  /** Every market, or the one picked. */
  marketIds: readonly string[]
  /**
   * The scope holds a topic (`pages.kind = 'topic'`): the picked subject in page
   * scope, any tracked subject in project scope. Topic coverage needs one.
   */
  hasTopic?: boolean
}

/** Why a section can't be picked in this scope. Null when it can. */
export function sectionUnavailable(
  id: ReportSectionId,
  scope: ExportScopeChoice,
  hasTopic = false
): string | null {
  if (id === 'content_gaps' && scope !== 'page') {
    return 'Content gaps are built for one page. Choose This page to include them.'
  }
  if (id === 'topic_coverage' && !hasTopic) {
    if (scope === 'page') return 'Topic coverage is built for topics. Pick a topic to include it.'
    if (scope === 'project') {
      return 'Topic coverage is built for topics, and this project has none yet.'
    }
    return 'Topic coverage is built for topics. Choose A topic to include it.'
  }
  return null
}

/** Extra line under a section that may have nothing to show yet. */
export function sectionNote(id: ReportSectionId): string | null {
  if (id === 'reputation' || id === 'answer_shape') {
    return 'Shows a “Not measured yet” panel when there is no data.'
  }
  return null
}

/** Sections the request carries, in report order. `raw` only with JSON. */
export function chosenSections(form: ExportForm, hasTopic = false): ExportSection[] {
  const picked: ExportSection[] = REPORT_SECTIONS.filter(
    (id) => form.sections[id] && sectionUnavailable(id, form.scope, hasTopic) === null
  )
  if (form.format === 'json' && form.includeRaw) picked.push('raw')
  return picked
}

export function sectionTitle(id: ExportSection): string {
  return REPORT_SECTION_COPY[id].title
}

export function buildExportRequest(form: ExportForm, source: ExportBuildSource): ExportRequest {
  const pdf: PdfExportOptions | null =
    form.format === 'pdf'
      ? {
          pageSize: form.pageSize,
          charts: form.charts,
          preparedFor: form.preparedFor.trim() === '' ? null : form.preparedFor.trim(),
          hideBranding: form.hideBranding
        }
      : null
  return {
    projectId: source.projectId,
    scope: form.scope === 'page' ? 'page' : form.scope === 'project' ? 'project' : 'selected',
    pageIds:
      form.scope === 'page'
        ? source.pageId
          ? [source.pageId]
          : []
        : form.scope === 'project'
          ? []
          : [...(source.pageIds ?? [])],
    viewId: null,
    marketIds: [...source.marketIds],
    checks: form.checks,
    from: form.checks === 'range' ? form.from : null,
    to: form.checks === 'range' ? form.to : null,
    sections: chosenSections(form, source.hasTopic ?? false),
    format: form.format,
    pdf,
    xlsx:
      form.format === 'xlsx'
        ? { freezeHeaders: form.freezeHeaders, sheetPerMarket: form.sheetPerMarket }
        : null,
    csv: form.format === 'csv' ? { delimiter: form.delimiter, bom: form.bom } : null,
    html: form.format === 'html' ? { packaging: form.htmlPackaging } : null,
    filenamePattern: form.pattern || DEFAULT_FILENAME_PATTERN,
    logoBase64: form.format === 'pdf' ? form.logoBase64 : null,
    timeZone: localTimeZone()
  }
}

/** The stored spec for automatic export. The logo is never stored. */
export function specOf(request: ExportRequest): ExportSpec {
  return {
    projectId: request.projectId,
    scope: request.scope,
    pageIds: request.pageIds,
    viewId: request.viewId,
    marketIds: request.marketIds,
    checks: request.checks,
    from: request.from,
    to: request.to,
    sections: request.sections,
    format: request.format,
    pdf: request.pdf,
    xlsx: request.xlsx,
    csv: request.csv,
    html: request.html ?? null,
    filenamePattern: request.filenamePattern,
    timeZone: request.timeZone
  }
}

export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`
}

/** "128 bytes", "About 40 KB", "About 2.4 MB". */
/** A saved file's size in plain units: "128 bytes", "17 KB", "1.2 MB". Decimal units, like Finder. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 999_500) return `${Math.round(bytes / 1000).toLocaleString('en-US')} KB`
  const mb = bytes / 1_000_000
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb).toLocaleString('en-US')} MB`
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return countLabel(bytes, 'byte')
  if (bytes < 1024 * 1024) return `About ${Math.round(bytes / 1024)} KB`
  return `About ${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
