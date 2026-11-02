/**
 * PDF report (FR-22.2, Docs/REPORT-SPEC.md "Other outputs").
 * Drawn with PDFKit in this process from the report model. No browser and no network
 * (NFR-6, NFR-17). Dates use the export time zone (NFR-15). Text is redacted (NFR-5,
 * FR-22.7) and uses embedded Noto fonts; characters outside them are replaced and counted.
 */

export { PdfReportError, type PdfLogo } from './common'
export { chartOffsets } from './draw'
export { parsePdfLogo, rejectPdfRequest } from './options'
export { renderReportPdf, reportPdfPreviewText, type ReportPdfInput } from './render'
export {
  EXCEL_POINTER,
  PDF_PROMPT_LIMIT,
  PDF_TABLE_LIMIT,
  showingLine,
  type ReportBlock
} from './blocks'
