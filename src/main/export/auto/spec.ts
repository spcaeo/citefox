import {
  isExportCheckSet,
  isExportFormat,
  isExportScope,
  normalizeExportSections,
  type ExportSpec
} from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { rejectRequest } from '../service-request'

/**
 * Checks an `ExportSpec` before it is stored or repeated (FR-22.6). The shape is
 * checked field by field (it crossed IPC or came from the database), then the
 * same rules as a save-dialog export (`rejectRequest`). Returns null when the
 * spec cannot be repeated. `projectId` must match the scope it is stored under.
 */
export function parseAutoExportSpec(value: unknown, projectId: string): ExportSpec | null {
  if (!isRecord(value)) return null
  const {
    scope,
    pageIds,
    viewId,
    marketIds,
    checks,
    from,
    to,
    sections,
    format,
    pdf,
    xlsx,
    csv,
    html,
    filenamePattern,
    timeZone
  } = value
  if (value.projectId !== projectId) return null
  if (typeof scope !== 'string' || !isExportScope(scope)) return null
  if (!isIdList(pageIds) || !isIdList(marketIds)) return null
  if (viewId !== null && !isId(viewId)) return null
  if (typeof checks !== 'string' || !isExportCheckSet(checks)) return null
  if (!isNullableText(from, 10) || !isNullableText(to, 10)) return null
  if (!Array.isArray(sections) || !sections.every((item) => typeof item === 'string')) return null
  if (typeof format !== 'string' || !isExportFormat(format)) return null
  if (typeof filenamePattern !== 'string' || filenamePattern.length > 200) return null
  if (typeof timeZone !== 'string') return null
  const spec: ExportSpec = {
    projectId,
    scope,
    pageIds: [...pageIds],
    viewId,
    marketIds: [...marketIds],
    checks,
    from,
    to,
    sections: normalizeExportSections(sections),
    format,
    pdf: format === 'pdf' ? parsePdf(pdf) : null,
    xlsx: format === 'xlsx' ? parseXlsx(xlsx) : null,
    csv: format === 'csv' ? parseCsv(csv) : null,
    html: format === 'html' ? parseHtml(html) : null,
    filenamePattern,
    timeZone
  }
  if (format === 'pdf' && spec.pdf === null) return null
  if (format === 'xlsx' && spec.xlsx === null) return null
  if (format === 'csv' && spec.csv === null) return null
  if (scope === 'page' && spec.pageIds.length !== 1) return null
  if (scope === 'selected' && spec.pageIds.length === 0) return null
  if (scope === 'view' && spec.viewId === null) return null
  if (rejectRequest(autoExportRequest(spec)) !== null) return null
  return spec
}

/** The request an automatic export writes. Logo bytes are never stored, so there is no logo. */
export function autoExportRequest(spec: ExportSpec): ExportRequest {
  return { ...spec, logoBase64: null }
}

function parsePdf(value: unknown): ExportSpec['pdf'] {
  if (!isRecord(value)) return null
  const { pageSize, charts, preparedFor, hideBranding } = value
  if (pageSize !== 'letter' && pageSize !== 'a4') return null
  if (typeof charts !== 'boolean' || typeof hideBranding !== 'boolean') return null
  if (!isNullableText(preparedFor, 200)) return null
  return { pageSize, charts, preparedFor, hideBranding }
}

function parseXlsx(value: unknown): ExportSpec['xlsx'] {
  if (!isRecord(value)) return null
  const { freezeHeaders, sheetPerMarket } = value
  if (typeof freezeHeaders !== 'boolean' || typeof sheetPerMarket !== 'boolean') return null
  return { freezeHeaders, sheetPerMarket }
}

function parseCsv(value: unknown): ExportSpec['csv'] {
  if (!isRecord(value)) return null
  const { delimiter, bom } = value
  if (delimiter !== 'comma' && delimiter !== 'semicolon') return null
  if (typeof bom !== 'boolean') return null
  return { delimiter, bom }
}

function parseHtml(value: unknown): ExportSpec['html'] {
  if (!isRecord(value)) return { packaging: 'zip' }
  return { packaging: value.packaging === 'file' ? 'file' : 'zip' }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every(isId)
}

function isNullableText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= max)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
