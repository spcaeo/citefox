import PDFDocument from 'pdfkit'
import type { PdfExportOptions } from '@shared/domain'
import { yieldToEventLoop } from '../cells'
import { PdfFontError, registerPdfFonts } from '../fonts'
import type { ReportModel } from '../model/types'
import type { ReportBlock } from './blocks'
import { PdfReportError, metadataText, speak, type PdfLogo, type Speech } from './common'
import {
  MARGINS,
  accentColor,
  keepWithNext,
  drawPageFooter,
  drawPageHeader,
  paintBlock,
  type Frame,
  type Painter
} from './paint'
import { buildReportBlocks, reportBlocksPreview } from './report-model'
import { preparedFor } from './report-sections/cover'

/**
 * The v2 PDF report (Docs/REPORT-SPEC.md "Other outputs"), drawn with PDFKit from the
 * report model only. No browser and no network (NFR-6, NFR-17). Text is redacted
 * (NFR-5) and uses the embedded Noto fonts; characters outside them are replaced and
 * counted. Charts are vector paths.
 */

export interface ReportPdfInput {
  pdf: PdfExportOptions
  logo: PdfLogo | null
  secrets: readonly string[]
  onProgress?: (done: number, total: number) => void
  /** Rows shown before a table is cut. Defaults to 25, and 50 for the Prompts table. */
  tableLimit?: number
  promptLimit?: number
}

/** Short text for the export preview. Not the file (FR-22.4). */
export function reportPdfPreviewText(model: ReportModel, pdf: PdfExportOptions): string {
  return reportBlocksPreview(buildReportBlocks(model, pdf, { secrets: [] }).blocks)
}

export async function renderReportPdf(model: ReportModel, input: ReportPdfInput): Promise<Buffer> {
  let built: { blocks: ReportBlock[]; speech: Speech }
  try {
    built = buildReportBlocks(model, input.pdf, {
      secrets: input.secrets,
      ...(input.tableLimit === undefined ? {} : { tableLimit: input.tableLimit }),
      ...(input.promptLimit === undefined ? {} : { promptLimit: input.promptLimit })
    })
  } catch (error) {
    throw asReportError(error)
  }
  const builtAt = new Date(model.cover.builtAt)
  const doc = new PDFDocument({
    size: input.pdf.pageSize === 'a4' ? 'A4' : 'LETTER',
    margins: { ...MARGINS },
    bufferPages: true,
    info: documentInfo(
      model,
      input,
      built.speech,
      Number.isNaN(builtAt.getTime()) ? new Date(0) : builtAt
    )
  })
  const chunks: Buffer[] = []
  let settled = false
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    doc.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    doc.on('error', (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })

  try {
    registerPdfFonts(doc)
    await paint(doc, model, input, built)
    doc.end()
  } catch (error) {
    if (!settled) {
      settled = true
      doc.destroy()
    }
    throw asReportError(error)
  }
  return done
}

function asReportError(error: unknown): unknown {
  if (error instanceof PdfFontError) return new PdfReportError(error.message, error.nextStep)
  return error
}

function documentInfo(
  model: ReportModel,
  input: ReportPdfInput,
  speech: Speech,
  when: Date
): PDFKit.DocumentInfo {
  const cover = model.cover
  const project = metadataText(speak(cover.projectName, speech))
  const prepared = preparedFor(input.pdf.preparedFor, cover.clientName)
  const hide = input.pdf.hideBranding
  const author = hide ? metadataText(speak(prepared ?? cover.projectName, speech)) : 'CiteFox'
  return {
    Title: metadataText(speak(`${cover.projectName} AI visibility report`, speech)),
    Author: author.length > 0 ? author : project,
    Creator: hide ? project || 'Report' : 'CiteFox',
    Producer: hide ? project || 'Report' : 'CiteFox',
    Subject: metadataText(speak(`${cover.domain} · ${cover.scopeLabel}`, speech)),
    CreationDate: when,
    ModDate: when
  }
}

async function paint(
  doc: PDFKit.PDFDocument,
  model: ReportModel,
  input: ReportPdfInput,
  built: { blocks: readonly ReportBlock[]; speech: Speech }
): Promise<void> {
  const painter: Painter = { doc, accent: accentColor(model.cover.brandColor) }
  const prepared = preparedFor(input.pdf.preparedFor, model.cover.clientName)
  const frame: Frame = {
    logo: input.logo,
    title: speak(
      `${model.cover.domain} · AI visibility report · ${model.cover.scopeLabel}`,
      built.speech
    ),
    prepared: prepared === null ? '' : `Prepared for ${speak(prepared, built.speech)}`,
    branding: input.pdf.hideBranding ? '' : 'Built with CiteFox'
  }
  let framing = false
  doc.on('pageAdded', () => {
    if (framing) return
    framing = true
    try {
      drawPageHeader(painter, frame)
    } finally {
      framing = false
    }
  })

  const onProgress = input.onProgress ?? (() => undefined)
  const blocks = built.blocks
  const total = Math.max(blocks.length, 1)
  onProgress(0, total)
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block !== undefined) {
      keepWithNext(painter, blocks, index)
      paintBlock(painter, block, input.logo)
    }
    if (index % 20 === 19) await yieldToEventLoop()
    onProgress(index + 1, total)
  }
  if (blocks.length === 0) onProgress(1, 1)

  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    drawPageFooter(painter, frame, index + 1, range.count)
  }
}
