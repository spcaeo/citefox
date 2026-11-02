/** Exports: scopes, formats, sections, and auto-export. */

import { isOneOf } from './one-of'

/** FR-22.1. */
const EXPORT_SCOPES = ['page', 'selected', 'project', 'view'] as const

export type ExportScope = (typeof EXPORT_SCOPES)[number]

/** FR-22.2. Raw SerpApi data is legal only when `format` is `json` (FR-22.3). */
const EXPORT_FORMATS = ['pdf', 'xlsx', 'csv', 'html', 'json'] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** FR-22.1. `trio` is baseline vs previous vs latest. `range` uses `from` and `to`. */
const EXPORT_CHECK_SETS = ['latest', 'trio', 'all', 'range'] as const

export type ExportCheckSet = (typeof EXPORT_CHECK_SETS)[number]

/**
 * Report sections, in report order (Docs/REPORT-SPEC.md "Sections and their data").
 * The cover is always included. `raw` is the raw SerpApi data section (JSON only, FR-22.3).
 * `topic_coverage` renders only for topic subjects (Docs/TOPICS-SPEC.md section 5); a page
 * export that selects it leaves it out.
 */
const EXPORT_SECTIONS = [
  'overview',
  'topic_coverage',
  'pages',
  'competition',
  'reputation',
  'trends',
  'universe',
  'sources',
  'answer_shape',
  'content_gaps',
  'prompts',
  'raw'
] as const

export type ExportSection = (typeof EXPORT_SECTIONS)[number]

/** Every report section except `raw`, in report order. */
export const REPORT_SECTIONS = EXPORT_SECTIONS.filter(
  (section): section is Exclude<ExportSection, 'raw'> => section !== 'raw'
)

export type ReportSectionId = Exclude<ExportSection, 'raw'>

/**
 * Section ids written before report v2 (stored on scheduled reports and older specs).
 * Each maps to the v2 section that now holds that content.
 */
export const LEGACY_EXPORT_SECTIONS = {
  results: 'overview',
  prompt_results: 'prompts',
  progress: 'trends',
  markets: 'universe',
  sentiment: 'reputation',
  gaps: 'content_gaps',
  communities: 'sources'
} as const satisfies Record<string, ExportSection>

/**
 * Known v2 ids and legacy ids, mapped to v2, de-duplicated, in report order.
 * Unknown values are dropped.
 */
export function normalizeExportSections(values: readonly string[]): ExportSection[] {
  const picked = new Set<ExportSection>()
  for (const value of values) {
    if (isExportSection(value)) picked.add(value)
    else if (Object.hasOwn(LEGACY_EXPORT_SECTIONS, value)) {
      picked.add(LEGACY_EXPORT_SECTIONS[value as keyof typeof LEGACY_EXPORT_SECTIONS])
    }
  }
  return EXPORT_SECTIONS.filter((section) => picked.has(section))
}

const EXPORT_PHASES = ['collect', 'render', 'write'] as const

export type ExportPhase = (typeof EXPORT_PHASES)[number]

const EXPORT_DESTINATIONS = ['folder', 'email'] as const

export type ExportDestination = (typeof EXPORT_DESTINATIONS)[number]

/** One market of a page in an export preview, with the checks the file holds. */
export interface ExportPreviewMarket {
  marketId: string
  /** Short code such as `us-en`. */
  code: string
  /** ISO-8601 UTC finish time of each check in the file, oldest first. */
  checks: readonly string[]
}

/**
 * One page in an export preview. The Export summary's page, market and check
 * counts drill into these, so each count equals the rows its list shows.
 */
export interface ExportPreviewPage {
  pageId: string
  url: string
  title: string | null
  markets: readonly ExportPreviewMarket[]
}

/** FR-22.4. The invoke resolves either way. `blocked` is the reason the file was not started. */
export interface ExportPreview {
  blocked: boolean
  reason: string | null
  nextStep: string | null
  pageCount: number
  marketCount: number
  checkCount: number
  sections: readonly ExportSection[]
  estimatedBytes: number
  /** First rows or a short text preview. Not the file. */
  preview: string
  /**
   * What the counts above are made of (pages, their markets and checks). Absent
   * when nothing could be read. `pageCount` is its length, `marketCount` its
   * distinct market ids, and `checkCount` the sum of the checks.
   */
  pages?: readonly ExportPreviewPage[]
}

/** FR-22.5. The file stays on this computer (NFR-6). */
export interface ExportFile {
  exportId: string
  filePath: string
  filename: string
  bytes: number
  format: ExportFormat
}

/**
 * `exports:start`. `ok: false` means the same block as `ExportPreview` (nothing picked, or raw
 * data with a format other than JSON). No file is written.
 */
export type ExportStartResult =
  ({ ok: true } & ExportFile) | { ok: false; reason: string; nextStep: string | null }

/** FR-22.2. PDF options the file is built with. Logo bytes are not part of the stored spec. */
export interface PdfExportOptions {
  pageSize: 'letter' | 'a4'
  charts: boolean
  preparedFor: string | null
  hideBranding: boolean
}

/** FR-22.2. */
export interface XlsxExportOptions {
  freezeHeaders: boolean
  sheetPerMarket: boolean
}

/**
 * HTML report delivery (Docs/REPORT-SPEC.md "Delivery format"). `zip` is the folder
 * `<domain>-<scope>-ai-visibility-<date>/` with `index.html` and `README.txt`.
 * `file` is the bare `index.html`.
 */
export interface HtmlExportOptions {
  packaging: 'zip' | 'file'
}

/** FR-22.2 and FR-21.8. `bom` true writes a UTF-8 BOM so Excel opens the CSV cleanly. */
export interface CsvExportOptions {
  delimiter: 'comma' | 'semicolon'
  bom: boolean
}

/**
 * What an export contains (FR-22.1, FR-22.5).
 * `from` and `to` are local calendar dates `YYYY-MM-DD`, inclusive. Both null unless `checks` is `range`.
 * `filenamePattern` may use `{project}`, `{page}`, `{date}`, and `{ext}`.
 */
export interface ExportSpec {
  projectId: string
  scope: ExportScope
  /** Required for `page` and `selected`. Empty for `project` and `view`. */
  pageIds: readonly string[]
  /** Required for `view`. Null otherwise. */
  viewId: string | null
  marketIds: readonly string[]
  checks: ExportCheckSet
  from: string | null
  to: string | null
  sections: readonly ExportSection[]
  format: ExportFormat
  /** Null unless `format` is `pdf`. */
  pdf: PdfExportOptions | null
  /** Null unless `format` is `xlsx`. */
  xlsx: XlsxExportOptions | null
  /** Null unless `format` is `csv`. */
  csv: CsvExportOptions | null
  /** HTML packaging. Omitted or null is the zip folder. Ignored unless `format` is `html`. */
  html?: HtmlExportOptions | null
  filenamePattern: string
  /**
   * IANA time zone, such as `America/Toronto`.
   * Range day boundaries and the `{date}` token use this zone.
   */
  timeZone: string
}

/** FR-22.6. One automatic export attempt after a scheduled check, newest first. */
export interface AutoExportRun {
  id: string
  /** ISO-8601 UTC when the attempt finished. */
  finishedAt: string
  outcome: 'ok' | 'failed'
  format: ExportFormat
  /** The file written in the folder. Null when nothing was written. */
  filename: string | null
  bytes: number | null
  /** Plain words. Null when `outcome` is `ok`. */
  reason: string | null
  nextStep: string | null
}

/**
 * FR-22.6. Repeats `spec` after every scheduled check, into a folder the user
 * picked in the native folder dialog (`exports:chooseAutoFolder`). Logo bytes
 * are not stored. Email delivery is a scheduled report (FR-23.7).
 */
export interface AutoExport {
  projectId: string
  /** Null is the project default. A page id is that page's export screen. */
  pageId: string | null
  enabled: boolean
  destination: ExportDestination
  /** Absolute folder chosen in the dialog. Null until one is chosen. */
  folder: string | null
  emailTo: string | null
  /** Null until the settings are first saved. */
  spec: ExportSpec | null
  /** The latest attempts, newest first (at most 20). */
  runs: readonly AutoExportRun[]
}

export function isExportScope(value: string): value is ExportScope {
  return isOneOf(EXPORT_SCOPES, value)
}

export function isExportFormat(value: string): value is ExportFormat {
  return isOneOf(EXPORT_FORMATS, value)
}

export function isExportCheckSet(value: string): value is ExportCheckSet {
  return isOneOf(EXPORT_CHECK_SETS, value)
}

export function isExportSection(value: string): value is ExportSection {
  return isOneOf(EXPORT_SECTIONS, value)
}

export function isExportPhase(value: string): value is ExportPhase {
  return isOneOf(EXPORT_PHASES, value)
}

export function isExportDestination(value: string): value is ExportDestination {
  return isOneOf(EXPORT_DESTINATIONS, value)
}
