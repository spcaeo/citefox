import { basename } from 'node:path'
import type { ExportPreview, ExportPreviewPage, ExportSection } from '@shared/domain'
import {
  REPORT_SECTIONS,
  isExportCheckSet,
  isExportFormat,
  isExportScope,
  isExportSection,
  normalizeExportSections
} from '@shared'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import { redactString } from '../logging'
import { safeJoin } from './atomic'
import type { JsonExportInput } from './json'
import { isCalendarDate, type PreparedPage } from './prepare'
import { rejectPdfRequest } from './pdf'
import { calendarDay, isIanaTimeZone } from './timezone'

/** Request checks, file naming and progress events shared by preview and start. */

const SECTION_ORDER = REPORT_SECTIONS satisfies readonly ExportSection[]

export const READ_FAILURE = {
  reason: 'Could not read the results for this export.',
  nextStep: 'Try again. If it still fails, run a check and export that page.'
}

export const WRITE_FAILURE = {
  reason: 'Could not write the export file.',
  nextStep: 'Check that the folder is writable and try again.'
}

export function rejectRequest(request: ExportRequest): { reason: string; nextStep: string } | null {
  if (!isIanaTimeZone(request.timeZone)) {
    return {
      reason: 'That time zone is not recognized.',
      nextStep: 'Use an IANA time zone such as America/Toronto.'
    }
  }
  if (!isExportFormat(request.format)) {
    return { reason: 'Choose a format.', nextStep: 'Choose PDF, Excel, CSV, HTML, or JSON.' }
  }
  if (request.sections.includes('raw') && request.format !== 'json') {
    return {
      reason: 'Raw search data is only included in JSON exports.',
      nextStep: 'Remove the raw section, or choose JSON.'
    }
  }
  if (request.format === 'pdf') {
    const problem = rejectPdfRequest(request)
    if (problem) return problem
  }
  if (request.format === 'csv' && request.csv === null) {
    return {
      reason: 'CSV options are missing.',
      nextStep: 'Choose a comma or semicolon delimiter, and whether to write a UTF-8 BOM.'
    }
  }
  if (request.format === 'xlsx' && request.xlsx === null) {
    return {
      reason: 'Excel options are missing.',
      nextStep: 'Set freeze headers and whether to use one sheet per market.'
    }
  }
  if (
    request.format === 'csv' &&
    request.csv !== null &&
    request.csv.delimiter !== 'comma' &&
    request.csv.delimiter !== 'semicolon'
  ) {
    return {
      reason: 'Choose a comma or semicolon delimiter.',
      nextStep: 'Pick comma or semicolon.'
    }
  }
  if (!isExportScope(request.scope)) {
    return {
      reason: 'Choose what to export.',
      nextStep: 'Choose this page, selected pages, the whole project, or a saved view.'
    }
  }
  if (!isExportCheckSet(request.checks)) {
    return {
      reason: 'Choose which checks to include.',
      nextStep:
        'Choose latest, baseline versus previous versus latest, every check, or a date range.'
    }
  }
  if (exportedSections(request.sections).length === 0 && !wantsRaw(request)) {
    return {
      reason: 'Pick at least one section.',
      nextStep: 'Choose a section such as results or prompt results.'
    }
  }
  if (request.marketIds.length === 0) {
    return { reason: 'Pick at least one market.', nextStep: 'Choose a market.' }
  }
  if (request.checks === 'range') {
    if (!isCalendarDate(request.from) || !isCalendarDate(request.to)) {
      return { reason: 'Choose a start and end date.', nextStep: 'Use YYYY-MM-DD for both dates.' }
    }
    if (request.from > request.to) {
      return {
        reason: 'The start date is after the end date.',
        nextStep: 'Put the earlier date first.'
      }
    }
  }
  return null
}

/** FR-22.3. Raw SerpApi JSON is read only for a JSON export that asks for it. */
export function wantsRaw(request: ExportRequest): boolean {
  return request.format === 'json' && request.sections.includes('raw')
}

export function jsonSelection(request: ExportRequest): JsonExportInput['selection'] {
  return {
    scope: request.scope,
    checks: request.checks,
    from: request.checks === 'range' ? request.from : null,
    to: request.checks === 'range' ? request.to : null,
    pageIds: [...request.pageIds],
    marketIds: [...request.marketIds]
  }
}

export function fileExtension(request: ExportRequest): string {
  if (request.format === 'csv') return 'zip'
  if (request.format === 'html') return request.html?.packaging === 'file' ? 'html' : 'zip'
  return request.format
}

export function exportedSections(sections: readonly string[]): ExportSection[] {
  const picked = new Set(normalizeExportSections(sections))
  return SECTION_ORDER.filter((section) => picked.has(section))
}

export function blockedPreview(
  request: ExportRequest,
  block: { reason: string; nextStep: string },
  counts?: { pageCount: number; marketCount: number; checkCount: number },
  pages?: readonly ExportPreviewPage[]
): ExportPreview {
  return {
    blocked: true,
    reason: block.reason,
    nextStep: block.nextStep,
    pageCount: counts?.pageCount ?? 0,
    marketCount: counts?.marketCount ?? request.marketIds.length,
    checkCount: counts?.checkCount ?? 0,
    sections: request.sections.filter((section): section is ExportSection =>
      isExportSection(section)
    ),
    estimatedBytes: 0,
    preview: '',
    ...(pages !== undefined ? { pages } : {})
  }
}

/** The pages, markets and checks behind the preview counts (drill-downs). */
export function previewPages(pages: readonly PreparedPage[]): ExportPreviewPage[] {
  return pages.map((page) => ({
    pageId: page.page.pageId,
    url: page.page.url,
    title: page.page.title,
    markets: page.markets.map((market) => ({
      marketId: market.marketId,
      code: market.code,
      checks: market.checks.map((selected) => selected.check.finishedAt)
    }))
  }))
}

export function countPrepared(pages: readonly PreparedPage[]): {
  pageCount: number
  marketCount: number
  checkCount: number
} {
  const markets = new Set<string>()
  let checkCount = 0
  for (const page of pages) {
    for (const market of page.markets) {
      markets.add(market.marketId)
      checkCount += market.checks.length
    }
  }
  return { pageCount: pages.length, marketCount: markets.size, checkCount }
}

export function delimiterOf(request: ExportRequest): ',' | ';' {
  return request.csv?.delimiter === 'semicolon' ? ';' : ','
}

export function phase(
  exportId: string,
  name: ExportProgress['phase'],
  state: ExportProgress['state'],
  done: number,
  total: number
): ExportProgress {
  const detail =
    name === 'collect'
      ? 'Collecting pages.'
      : name === 'render'
        ? 'Rendering rows.'
        : 'Writing the file.'
  return { exportId, phase: name, state, done, total, detail, nextStep: null }
}

export function exportDay(pages: readonly PreparedPage[], now: Date, timeZone: string): string {
  let latest = ''
  for (const page of pages) {
    for (const market of page.markets) {
      for (const selected of market.checks) {
        const day = calendarDay(selected.check.finishedAt, timeZone)
        if (day > latest) latest = day
      }
    }
  }
  return latest.length > 0 ? latest : calendarDay(now.toISOString(), timeZone)
}

export async function chosenOutput(
  input: {
    directory: string
    chooseOutputPath?: (filename: string) => Promise<string | null>
  },
  filename: string
): Promise<{ filePath: string; filename: string } | null> {
  if (input.chooseOutputPath === undefined) {
    return { filePath: safeJoin(input.directory, filename), filename }
  }
  const picked = await input.chooseOutputPath(filename)
  if (picked === null || picked.length === 0) return null
  const name = basename(picked)
  if (name.length === 0 || name === '.' || name === '..') return null
  return { filePath: picked, filename: name }
}

export function renderFilename(
  pattern: string,
  tokens: { project: string; page: string; date: string; ext: string },
  secrets: readonly string[]
): string {
  const template = pattern.trim().length > 0 ? pattern : '{project}-{page}-{date}.{ext}'
  const rendered = template
    .replaceAll('{project}', filenameToken(tokens.project, 'project', secrets))
    .replaceAll('{page}', filenameToken(tokens.page, 'page', secrets))
    .replaceAll('{date}', filenameToken(tokens.date, 'date', secrets))
    .replaceAll('{ext}', tokens.ext)
  const cleaned = stripUnsafeFilename(rendered).trim()
  const base = cleaned.length > 0 ? cleaned : 'export'
  return base.slice(0, 180)
}

export function filenameToken(value: string, fallback: string, secrets: readonly string[]): string {
  const redacted = redactString(value, { secrets, hexKeys: false })
  const cleaned = stripUnsafeFilename(redacted.normalize('NFKC')).trim().replace(/\s+/g, '-')
  const token = cleaned.length > 0 ? cleaned : fallback
  return token.slice(0, 80)
}

/** Drop characters that are unsafe in a file name, including ASCII controls. */
export function stripUnsafeFilename(value: string): string {
  let result = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code === 127) continue
    if ('\\/:*?"<>|'.includes(char)) continue
    result += char
  }
  return result
}
