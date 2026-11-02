import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ExportPreview, ExportStartResult } from '@shared/domain'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import {
  nodeExportIo,
  publishBytes,
  publishReadyFile,
  removeQuietly,
  temporaryPath,
  type ExportAtomicIo
} from './atomic'
import type { ExportTable } from './cells'
import { htmlReportPreviewText, packageHtmlReport, renderHtmlReport } from './html'
import { buildJsonExport, serializeJsonExport } from './json'
import { reportModelFor } from './model/from-dataset'
import type { ReportModel, ReportSectionBuilders } from './model/types'
import { prepareExport, type PreparedPage } from './prepare'
import { parsePdfLogo, PdfReportError, renderReportPdf, reportPdfPreviewText } from './pdf'
import { estimateCsvBytes, previewCsv, renderCsvEntries } from './render-csv'
import { buildReportTables } from './report-tables'
import {
  READ_FAILURE,
  WRITE_FAILURE,
  blockedPreview,
  chosenOutput,
  countPrepared,
  delimiterOf,
  exportDay,
  exportedSections,
  fileExtension,
  jsonSelection,
  phase,
  previewPages,
  rejectRequest,
  renderFilename,
  wantsRaw
} from './service-request'
import type { ExportDataSource, ExportDataset } from './types'
import { writeXlsx } from './xlsx'
import { zipStore } from './zip'

/**
 * Exports (FR-22). Every format renders one report model (src/main/export/model), so
 * the HTML report, PDF, XLSX and CSV tables, JSON v2 and the scheduled email body agree
 * for the same scope, markets and checks (Docs/REPORT-SPEC.md "Other outputs").
 */

/** Characters of JSON shown in the export preview (FR-22.4). */
const PREVIEW_CHARS = 2000

export interface PreviewExportInput {
  request: ExportRequest
  source: ExportDataSource
  /** Values removed from preview text (NFR-5). */
  secrets?: readonly string[]
  now?: () => Date
  /** Section builders that live with other features (sentiment, communities, structure). */
  builders?: ReportSectionBuilders
}

export interface StartExportInput extends PreviewExportInput {
  /** Directory the file is written into. The name comes from `filenamePattern` (FR-22.5). */
  directory: string
  /**
   * Pick the file after the default name is known.
   * Return null when the person cancels. When omitted, the file is `directory` plus that name.
   */
  chooseOutputPath?: (filename: string) => Promise<string | null>
  onProgress?: (progress: ExportProgress) => void
  createId?: () => string
  io?: ExportAtomicIo
}

interface Loaded {
  dataset: ExportDataset
  pages: readonly PreparedPage[]
  pageToken: string
  model: ReportModel
  now: Date
}

type LoadResult = { ok: true; loaded: Loaded } | { ok: false; reason: string; nextStep: string }

/** FR-22.4. Does not write a file. */
export async function previewExport(input: PreviewExportInput): Promise<ExportPreview> {
  const secrets = input.secrets ?? []
  const rejected = rejectRequest(input.request)
  if (rejected) return blockedPreview(input.request, rejected)
  const dataset = await readDataset(input)
  if (dataset === null) return blockedPreview(input.request, READ_FAILURE)
  const prepared = prepareExport(dataset, input.request)
  const counts = countPrepared(prepared.pages)
  const pages = previewPages(prepared.pages)
  if (prepared.block) return blockedPreview(input.request, prepared.block, counts, pages)
  const now = input.now?.() ?? new Date()
  const model = reportModelFor(dataset, prepared.pages, input.request, now, input.builders)
  const tables = tablesFor(model, input.request)
  return {
    blocked: false,
    reason: null,
    nextStep: null,
    pageCount: counts.pageCount,
    marketCount: counts.marketCount,
    checkCount: counts.checkCount,
    sections: exportedSections(input.request.sections),
    estimatedBytes: estimateBytes(tables, input.request, secrets),
    preview: previewText(
      tables,
      input.request,
      { dataset, pages: prepared.pages, model, now },
      secrets
    ),
    pages
  }
}

/**
 * The report model for a request, without writing a file. Scheduled report emails build
 * their plain-text body from this, so the body and the attachment agree.
 */
export async function loadReportModel(
  input: PreviewExportInput
): Promise<{ ok: true; model: ReportModel } | { ok: false; reason: string; nextStep: string }> {
  const result = await load(input)
  return result.ok ? { ok: true, model: result.loaded.model } : result
}

/**
 * Write a PDF report, a CSV zip, an XLSX workbook, an HTML report, or a JSON file.
 * `raw` returns `ok: false` for every format except JSON (FR-22.3). No other error channel is used.
 * Progress is `collect`, then `render`, then `write` (NFR-17).
 */
export async function startExport(input: StartExportInput): Promise<ExportStartResult> {
  const secrets = input.secrets ?? []
  const request = input.request
  const exportId = input.createId?.() ?? randomUUID()
  const emit = (event: ExportProgress): void => {
    input.onProgress?.(event)
  }
  const rejected = rejectRequest(request)
  if (rejected) return { ok: false, ...rejected }

  emit(phase(exportId, 'collect', 'running', 0, 1))
  const result = await load(input)
  if (!result.ok) return result
  const { dataset, pages, pageToken, model, now } = result.loaded
  emit(phase(exportId, 'collect', 'ok', 1, 1))

  const htmlPackage =
    request.format === 'html'
      ? packageHtmlReport(
          model,
          renderHtmlReport(model, { secrets }),
          request.html?.packaging === 'file' ? 'file' : 'zip'
        )
      : null
  const filename =
    htmlPackage?.filename ??
    renderFilename(
      request.filenamePattern,
      {
        project: dataset.projectName,
        page: pageToken,
        date: exportDay(pages, now, request.timeZone),
        ext: fileExtension(request)
      },
      secrets
    )
  const output = await chosenOutput(input, filename)
  if (output === null) {
    return { ok: false, reason: 'Export cancelled', nextStep: 'Choose a file name and save.' }
  }
  const io = input.io ?? nodeExportIo()
  const written = (bytes: number, filePath: string): ExportStartResult => ({
    ok: true,
    exportId,
    filePath,
    filename: output.filename,
    bytes,
    format: request.format
  })
  const publish = async (bytes: Buffer): Promise<ExportStartResult> => {
    emit(phase(exportId, 'write', 'running', 0, 1))
    const filePath = await publishBytes(dirname(output.filePath), output.filename, bytes, io)
    emit(phase(exportId, 'write', 'ok', 1, 1))
    return written(bytes.length, filePath)
  }

  try {
    if (htmlPackage !== null) {
      emit(phase(exportId, 'render', 'ok', 1, 1))
      return await publish(htmlPackage.bytes)
    }

    if (request.format === 'json') {
      emit(phase(exportId, 'render', 'running', 0, 1))
      const text = serializeJsonExport(
        buildJsonExport({
          projectName: dataset.projectName,
          projectSlug: dataset.projectSlug,
          clientName: dataset.clientName,
          pages,
          sections: exportedSections(request.sections),
          includeRaw: wantsRaw(request),
          selection: jsonSelection(request),
          timeZone: request.timeZone,
          now,
          secrets,
          model
        })
      )
      emit(phase(exportId, 'render', 'ok', 1, 1))
      return await publish(Buffer.from(text, 'utf8'))
    }

    if (request.format === 'pdf') {
      if (request.pdf === null) {
        return {
          ok: false,
          reason: 'PDF options are missing.',
          nextStep: 'Choose Letter or A4, and whether to include charts.'
        }
      }
      const logo = parsePdfLogo(request.logoBase64)
      if (!logo.ok) return { ok: false, reason: logo.reason, nextStep: logo.nextStep }
      let bytes: Buffer
      let renderTotal = 1
      try {
        bytes = await renderReportPdf(model, {
          pdf: request.pdf,
          logo: logo.logo,
          secrets,
          onProgress: (done, reported) => {
            renderTotal = reported
            emit(phase(exportId, 'render', 'running', done, reported))
          }
        })
      } catch (error) {
        if (error instanceof PdfReportError) {
          return { ok: false, reason: error.message, nextStep: error.nextStep }
        }
        throw error
      }
      emit(phase(exportId, 'render', 'ok', renderTotal, renderTotal))
      return await publish(bytes)
    }

    const tables = tablesFor(model, request)
    const total = Math.max(
      tables.reduce((sum, table) => sum + table.rows.length, 0),
      1
    )
    emit(phase(exportId, 'render', 'running', 0, total))

    if (request.format === 'csv') {
      const csv = request.csv
      if (csv === null) {
        return {
          ok: false,
          reason: 'CSV options are missing.',
          nextStep: 'Choose a comma or semicolon delimiter, and whether to write a UTF-8 BOM.'
        }
      }
      const entries = await renderCsvEntries(
        tables,
        csv.delimiter === 'semicolon' ? ';' : ',',
        csv.bom,
        secrets,
        (done, reported) => {
          emit(phase(exportId, 'render', 'running', done, reported))
        }
      )
      emit(phase(exportId, 'render', 'ok', total, total))
      return await publish(zipStore(entries))
    }

    if (request.xlsx === null) {
      return { ok: false, reason: 'Excel options are missing.', nextStep: 'Choose Excel or CSV.' }
    }
    const finalPath = output.filePath
    const tempPath = temporaryPath(finalPath)
    try {
      await writeXlsx(tempPath, tables, {
        freezeHeaders: request.xlsx.freezeHeaders,
        secrets,
        onRow: (done, reported) => {
          emit(phase(exportId, 'render', 'running', done, reported))
        }
      })
      emit(phase(exportId, 'render', 'ok', total, total))
      emit(phase(exportId, 'write', 'running', 0, 1))
      await publishReadyFile(tempPath, finalPath, io)
    } catch (error) {
      await removeQuietly(io, tempPath)
      throw error
    }
    emit(phase(exportId, 'write', 'ok', 1, 1))
    return written(statSync(finalPath).size, finalPath)
  } catch {
    return { ok: false, ...WRITE_FAILURE }
  }
}

async function load(input: PreviewExportInput): Promise<LoadResult> {
  const rejected = rejectRequest(input.request)
  if (rejected) return { ok: false, ...rejected }
  const dataset = await readDataset(input)
  if (dataset === null) return { ok: false, ...READ_FAILURE }
  const prepared = prepareExport(dataset, input.request)
  if (prepared.block) return { ok: false, ...prepared.block }
  const now = input.now?.() ?? new Date()
  return {
    ok: true,
    loaded: {
      dataset,
      pages: prepared.pages,
      pageToken: prepared.pageToken,
      model: reportModelFor(dataset, prepared.pages, input.request, now, input.builders),
      now
    }
  }
}

async function readDataset(input: PreviewExportInput): Promise<ExportDataset | null> {
  try {
    return await input.source.loadExportDataset({
      projectId: input.request.projectId,
      scope: input.request.scope,
      pageIds: input.request.pageIds,
      viewId: input.request.viewId,
      marketIds: input.request.marketIds,
      checks: input.request.checks,
      from: input.request.from,
      to: input.request.to,
      timeZone: input.request.timeZone,
      includeRaw: wantsRaw(input.request)
    })
  } catch {
    return null
  }
}

function tablesFor(model: ReportModel, request: ExportRequest): ExportTable[] {
  return buildReportTables(model, { sheetPerMarket: request.xlsx?.sheetPerMarket === true })
}

function estimateBytes(
  tables: readonly ExportTable[],
  request: ExportRequest,
  secrets: readonly string[]
): number {
  const rows = tables.reduce((sum, table) => sum + table.rows.length, 0)
  if (request.format === 'pdf') {
    const logo =
      request.logoBase64 === null || request.logoBase64.trim().length === 0
        ? 0
        : Math.ceil(request.logoBase64.length * 0.75)
    const charts = request.pdf?.charts === true ? 6000 : 0
    return 24576 + rows * 240 + logo + charts
  }
  const csvBytes = estimateCsvBytes(
    tables,
    delimiterOf(request),
    request.csv?.bom ?? false,
    secrets
  )
  if (request.format === 'xlsx') return Math.round(csvBytes * 1.15) + 4096
  // HTML adds markup, inline CSS, the client script and the embedded data.
  if (request.format === 'html') return Math.round(csvBytes * 3) + 60000
  if (request.format === 'json') return Math.round(csvBytes * 4) + 4096
  return csvBytes
}

function previewText(
  tables: readonly ExportTable[],
  request: ExportRequest,
  loaded: Omit<Loaded, 'pageToken'>,
  secrets: readonly string[]
): string {
  const { dataset, pages, model, now } = loaded
  if (request.format === 'html') return htmlReportPreviewText(model)
  if (request.format === 'pdf' && request.pdf !== null) {
    return reportPdfPreviewText(model, request.pdf)
  }
  if (request.format === 'json') {
    // Raw responses are left out of the preview text; the file has them.
    const text = serializeJsonExport(
      buildJsonExport({
        projectName: dataset.projectName,
        projectSlug: dataset.projectSlug,
        clientName: dataset.clientName,
        pages,
        sections: exportedSections(request.sections),
        includeRaw: false,
        selection: jsonSelection(request),
        timeZone: request.timeZone,
        now,
        secrets,
        model
      })
    )
    return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…` : text
  }
  const previewTable = tables.find((table) => table.id === 'prompts') ?? tables[0]
  return previewTable === undefined ? '' : previewCsv(previewTable, delimiterOf(request), secrets)
}
