import { dirname } from 'node:path'
import {
  REPORT_TABLES,
  type ReportDownloadRequest,
  type ReportDownloadResult,
  type ReportTable
} from '@shared/ipc'
import { REPORT_KINDS, type ReportKind } from '@shared/report/review'
import { IpcRequestError } from '../../ipc-request'
import { parseMetricsRequest } from '../../metrics/parse'
import type { SqliteDatabase } from '../../storage/database'
import type { ProjectRecord } from '../../storage/records'
import { nodeExportIo, publishBytes } from '../atomic'
import { currentExportSaveDialog } from '../ipc'
import { isIanaTimeZone } from '../timezone'
import {
  buildReviewDownload,
  reviewCsv,
  reviewFileBase,
  reviewHtml,
  type DownloadSender
} from './index'
import { htmlProblems, qualityMessage } from './quality'

const CHANNEL = 'reports:download'

/** Prints an HTML file to PDF (Electron's printToPDF in a hidden window), or a test double. */
export type HtmlPdfPrinter = (html: string) => Promise<Buffer>

let printer: HtmlPdfPrinter | null = null

export function configureReviewPdfPrinter(next: HtmlPdfPrinter | null): void {
  printer = next
}

/** The printer Download uses; scheduled ready-report emails print with the same one. */
export function reviewPdfPrinter(): HtmlPdfPrinter | null {
  return printer
}

/** `{ ...MetricsRequest, report, format, table, timeZone }`. */
export function parseDownloadRequest(value: unknown): ReportDownloadRequest {
  if (typeof value !== 'object' || value === null) throw new IpcRequestError(CHANNEL)
  const { report, format, table, timeZone, rival, ...rest } = value as Record<string, unknown>
  const base = parseMetricsRequest(rest)
  if (!REPORT_KINDS.includes(report as ReportKind)) throw new IpcRequestError(CHANNEL)
  if (format !== 'html' && format !== 'pdf' && format !== 'csv') throw new IpcRequestError(CHANNEL)
  const pickedTable =
    table === null || table === undefined
      ? null
      : REPORT_TABLES.includes(table as ReportTable)
        ? (table as ReportTable)
        : undefined
  if (pickedTable === undefined || (format === 'csv' && pickedTable === null)) {
    throw new IpcRequestError(CHANNEL)
  }
  if (!isIanaTimeZone(timeZone)) throw new IpcRequestError(CHANNEL)
  if (rival !== undefined && rival !== null && !isRivalDomain(rival)) {
    throw new IpcRequestError(CHANNEL)
  }
  return {
    ...base,
    report: report as ReportKind,
    format,
    table: pickedTable,
    timeZone,
    ...(typeof rival === 'string' && rival !== '' ? { rival } : {})
  }
}

/** A bare host such as `twilio.com`: letters, digits, dots and dashes, at most 253. */
function isRivalDomain(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9.-]{0,253}$/i.test(value)
}

const FILTERS: Record<ReportDownloadRequest['format'], { name: string; extensions: string[] }> = {
  html: { name: 'HTML report', extensions: ['html'] },
  pdf: { name: 'PDF report', extensions: ['pdf'] },
  csv: { name: 'CSV table', extensions: ['csv'] }
}

/** Builds the file, asks where to save it, and writes it. Spends no searches. */
export async function saveReviewDownload(
  db: SqliteDatabase,
  project: ProjectRecord,
  request: ReportDownloadRequest,
  now: Date,
  from: DownloadSender | null = null
): Promise<ReportDownloadResult> {
  const dialog = currentExportSaveDialog()
  if (dialog === null) {
    return { ok: false, reason: 'Could not open the save dialog.', nextStep: 'Try again.' }
  }
  const build = buildReviewDownload(db, project, request, now, from)
  const base = reviewFileBase(build, now, request.timeZone)
  let bytes: Buffer
  let filename: string
  if (request.format === 'csv') {
    filename = `${base}-${request.table}.csv`
    bytes = Buffer.from(reviewCsv(build, request.table ?? 'questions'), 'utf8')
  } else {
    const html = reviewHtml(build, now, request.timeZone)
    const problems = htmlProblems(html, build.variants)
    if (problems.length > 0) return { ok: false, ...qualityMessage(problems) }
    if (request.format === 'html') {
      filename = `${base}.html`
      bytes = Buffer.from(html, 'utf8')
    } else {
      if (printer === null) {
        return {
          ok: false,
          reason: 'PDF is not available in this build.',
          nextStep: 'Download the HTML report and print it from your browser.'
        }
      }
      filename = `${base}.pdf`
      bytes = await printer(html)
    }
  }
  const picked = await dialog({
    title: 'Save report',
    defaultPath: filename,
    filters: [FILTERS[request.format]]
  })
  if (picked.canceled || !picked.filePath) {
    return { ok: false, reason: 'Save cancelled', nextStep: null }
  }
  const name = picked.filePath.split(/[\\/]/).pop() ?? filename
  const filePath = await publishBytes(dirname(picked.filePath), name, bytes, nodeExportIo())
  return { ok: true, filePath, filename: name, bytes: bytes.length }
}
