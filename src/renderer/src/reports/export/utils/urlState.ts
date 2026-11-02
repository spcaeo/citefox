import { REPORT_SECTIONS, type ExportFormat, type ReportSectionId } from '@shared/domain'
import { formatIds, parseIds } from '../../../scope'
import {
  ALL_MARKETS,
  isExportScopeChoice,
  isPickKind,
  type ExportForm,
  type ExportScopeChoice,
  type ExportWindow
} from '../model'

/**
 * The export form on the URL, so a copied link reproduces it:
 *
 *   #/export?scope=group&ids=g1&fmt=pdf&sec=overview,trends&mk=us-en&win=latest
 *
 * - `scope`: page | pages | group | cluster | topic | view | project (default page).
 * - `ids`: the picked ids of a pick kind. `page`: the page of page scope (old links too).
 * - `fmt`: pdf | xlsx | csv | html | json (default html).
 * - `sec`: the picked report sections in report order (missing: all; `none`: none).
 * - `mk`: one market id (missing: every market). The old `market` key still seeds it.
 * - `win`: latest | all | range, with `from` and `to` (YYYY-MM-DD) for a range.
 * - `pq`: the picker's search text.
 */
export const EXPORT_URL_KEYS = [
  'scope',
  'ids',
  'page',
  'fmt',
  'sec',
  'mk',
  'market',
  'win',
  'from',
  'to',
  'pq'
] as const

export type ExportUrlKey = (typeof EXPORT_URL_KEYS)[number]

export type ExportUrl = Readonly<Record<ExportUrlKey, string | null>>

const FORMATS: readonly ExportFormat[] = ['pdf', 'xlsx', 'csv', 'html', 'json']
const WINDOWS: readonly ExportWindow[] = ['latest', 'all', 'range']
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The form fields the URL holds. */
export type ExportUrlFields = Pick<
  ExportForm,
  'scope' | 'ids' | 'format' | 'sections' | 'checks' | 'from' | 'to'
>

/** The URL's form fields over `base` (the defaults). Unknown values fall back to `base`. */
export function formFromUrl(url: ExportUrl, base: ExportUrlFields): ExportUrlFields {
  const scope: ExportScopeChoice = isExportScopeChoice(url.scope) ? url.scope : base.scope
  const format = FORMATS.find((item) => item === url.fmt) ?? base.format
  const checks = WINDOWS.find((item) => item === url.win) ?? base.checks
  return {
    scope,
    ids: isPickKind(scope) ? parseIds(url.ids) : [],
    format,
    sections: url.sec === null ? base.sections : sectionsFromUrl(url.sec),
    checks,
    from: url.from && DATE.test(url.from) ? url.from : base.from,
    to: url.to && DATE.test(url.to) ? url.to : base.to
  }
}

function sectionsFromUrl(value: string): Record<ReportSectionId, boolean> {
  const picked = new Set(value === 'none' ? [] : value.split(','))
  return Object.fromEntries(REPORT_SECTIONS.map((id) => [id, picked.has(id)])) as Record<
    ReportSectionId,
    boolean
  >
}

/** `sec`: null when every section is on (the default), `none` when none is. */
export function sectionsToUrl(sections: Readonly<Record<ReportSectionId, boolean>>): string | null {
  const on = REPORT_SECTIONS.filter((id) => sections[id])
  if (on.length === REPORT_SECTIONS.length) return null
  return on.length === 0 ? 'none' : on.join(',')
}

/** The URL patch for the form fields in `partial` (null removes a key). */
export function urlPatch(
  partial: Partial<ExportUrlFields>
): Partial<Record<ExportUrlKey, string | null>> {
  const out: Partial<Record<ExportUrlKey, string | null>> = {}
  if (partial.scope !== undefined) {
    out.scope = partial.scope === 'page' ? null : partial.scope
    if (!isPickKind(partial.scope)) out.ids = null
  }
  if (partial.ids !== undefined) out.ids = formatIds(partial.ids)
  if (partial.format !== undefined) out.fmt = partial.format === 'html' ? null : partial.format
  if (partial.sections !== undefined) out.sec = sectionsToUrl(partial.sections)
  if (partial.checks !== undefined) {
    out.win = partial.checks === 'latest' ? null : partial.checks
    if (partial.checks !== 'range') {
      out.from = null
      out.to = null
    }
  }
  if (partial.from !== undefined) out.from = partial.from || null
  if (partial.to !== undefined) out.to = partial.to || null
  return out
}

/** The market choice on the URL: `mk`, else the old `market` key, else every market. */
export function marketFromUrl(url: ExportUrl): string {
  return url.mk ?? url.market ?? ALL_MARKETS
}

/** True when the patch changes what is exported, not just a value typed in place. */
export function pushesHistory(partial: Partial<ExportUrlFields>): boolean {
  return partial.scope !== undefined || partial.format !== undefined || partial.checks !== undefined
}
