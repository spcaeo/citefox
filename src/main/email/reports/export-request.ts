import {
  REPORT_SECTIONS,
  normalizeExportSections,
  type ExportSection,
  type ReportFormat
} from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import type { ReportSchedule } from '../types'

/**
 * FR-22.6 and FR-23.7. The export a scheduled report attaches: the whole project (or the
 * schedule's scope, resolved to `pageIds` by the caller), every
 * check in the window (so Trends and "what changed" have history), the schedule's markets
 * and sections. `html_link` is the stored id of the interactive HTML report, which is
 * attached as the zipped folder (index.html + README.txt) because nothing is uploaded
 * (FR-22.5). Null for `summary`, which sends no file. Raw SerpApi data is never attached.
 */
export function reportExportRequest(
  schedule: ReportSchedule,
  projectId: string,
  pageIds: readonly string[] | null = null
): ExportRequest | null {
  if (schedule.format === 'summary') return null
  return { ...reportModelRequest(schedule, projectId, pageIds), ...formatOptions(schedule.format) }
}

/**
 * The request the email summary's report model is built from. Same scope, markets,
 * checks and sections as the attachment, so the body and the file agree. `pageIds`
 * is the schedule's scope resolved to page (and topic) ids: a non-empty list is a
 * `selected` export of exactly those; null or empty is the whole project.
 */
export function reportModelRequest(
  schedule: Pick<ReportSchedule, 'marketIds' | 'sections' | 'timeZone'>,
  projectId: string,
  pageIds: readonly string[] | null = null
): ExportRequest {
  const picked = pageIds !== null && pageIds.length > 0
  return {
    projectId,
    scope: picked ? 'selected' : 'project',
    pageIds: picked ? [...pageIds] : [],
    viewId: null,
    marketIds: [...schedule.marketIds],
    checks: 'all',
    from: null,
    to: null,
    sections: reportSections(schedule.sections),
    format: 'json',
    pdf: null,
    xlsx: null,
    csv: null,
    html: null,
    filenamePattern: '{project}-report-{date}.{ext}',
    timeZone: schedule.timeZone,
    logoBase64: null
  }
}

/** MIME type of the attached file. */
export function reportContentType(format: ReportFormat): string {
  if (format === 'excel') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (format === 'csv' || format === 'html_link') return 'application/zip'
  return 'application/pdf'
}

function formatOptions(format: Exclude<ReportFormat, 'summary'>): Partial<ExportRequest> {
  if (format === 'excel') {
    return { format: 'xlsx', xlsx: { freezeHeaders: true, sheetPerMarket: false } }
  }
  if (format === 'csv') return { format: 'csv', csv: { delimiter: 'comma', bom: true } }
  if (format === 'html_link') return { format: 'html', html: { packaging: 'zip' } }
  return {
    format: 'pdf',
    pdf: { pageSize: 'letter', charts: true, preparedFor: null, hideBranding: false }
  }
}

/** The schedule's sections in v2 ids (legacy ids mapped); every report section when none. */
function reportSections(sections: readonly string[]): ExportSection[] {
  const selected = normalizeExportSections(sections).filter((section) => section !== 'raw')
  return selected.length > 0 ? selected : [...REPORT_SECTIONS]
}
