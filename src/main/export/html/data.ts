import type { ReportReference, ReportRow } from '../model/types'
import type { RenderContext, TableData } from './context'
import {
  marketById,
  shortDate,
  SOURCE_LABELS,
  STAGE_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS
} from './format'

/**
 * What the browser script needs, embedded once as `<script id="report-data"
 * type="application/json">`: the prompt rows with display strings already formatted,
 * the drill lists, every table's CSV data and each answer's cited sites.
 */
export interface ReportData {
  /** File-name base for CSV downloads. */
  file: string
  rows: readonly DataRow[]
  drills: Readonly<Record<string, readonly string[]>>
  tables: Readonly<Record<string, TableData>>
  /** Ready reports, All engines: the engines the drawer gives a column each, in order. */
  engines?: readonly { id: string; label: string; logo: string }[]
}

/** Ready reports: a question's result at the From end, for the drawer's before → now. */
export interface DataBefore {
  /** The From check's day, such as "Sep 16". */
  label: string
  status: string
  statusClass: string
  named: boolean | null
  position: number | null
  /** Your page cited then, as a path; null: none. */
  page: string | null
}

export interface DataRow {
  id: string
  number: number
  text: string
  label: string
  page: string
  pageUrl: string | null
  market: string
  stage: string
  source: string
  status: string
  statusClass: string
  /** True, false, or null when the check failed. */
  aio: boolean | null
  cited: boolean
  pageCited: boolean
  named: boolean
  position: number | null
  checked: string
  excerpt: string | null
  domains: readonly string[]
  /** Every site cited in the answer, in citation order: the drawer's answer details. */
  refs: readonly DataRef[]
  /**
   * Ready reports: the engine view the row belongs to (`all` or an engine id). A drawer
   * opened from it lists only rows of the same view. Absent: the full report's one view.
   */
  view?: string
  /** The engine whose answer the row is (`all` for every engine). Absent: Google AI Overview. */
  engine?: string
  /** Ready reports comparing two checks: the movement (gained, kept, lost, notcited, noanswer). */
  change?: string | null
  /** Ready reports comparing two checks: the result at the From end. */
  before?: DataBefore | null
  /** Ready reports: your page cited now, as a path (null: none). */
  citedThrough?: string | null
  /** Ready reports, All engines: each engine's result now, `[engine, status class, words]`. */
  engines?: readonly (readonly [string, string, string])[]
}

/**
 * One cited source, kept short because a report can hold thousands:
 * `[position, url, domain, title, kind]`. Kind is `target` (this page), `own` (another
 * page on your site), `competitor` or `other`.
 */
export type DataRef = readonly [number, string, string, string, string]

function refsByRow(references: readonly ReportReference[]): Map<string, DataRef[]> {
  const byRow = new Map<string, DataRef[]>()
  const sorted = [...references].sort((a, b) => a.position - b.position)
  for (const ref of sorted) {
    const list = byRow.get(ref.rowId) ?? []
    list.push([ref.position, ref.url, ref.domain, ref.title ?? '', ref.classification])
    byRow.set(ref.rowId, list)
  }
  return byRow
}

export function reportData(ctx: RenderContext, file: string): ReportData {
  const { model } = ctx
  const pages = new Map(model.pages.map((page) => [page.id, page]))
  const refs = refsByRow(model.references)
  const row = (item: ReportRow): DataRow => {
    const page = pages.get(item.pageId)
    return {
      id: item.id,
      number: item.number,
      text: item.text,
      label: item.label,
      page: page?.path ?? '—',
      pageUrl: page?.url ?? null,
      market: marketById(model, item.marketId),
      stage: STAGE_LABELS[item.stage],
      source: SOURCE_LABELS[item.source],
      status: STATUS_LABELS[item.status],
      statusClass: STATUS_CLASSES[item.status],
      aio: item.status === 'error' ? null : item.aio,
      cited: item.cited,
      pageCited: item.pageCited,
      named: item.named,
      position: item.position,
      checked: shortDate(item.checkedAt, ctx.timeZone),
      excerpt: item.aioExcerpt,
      domains: item.topDomains,
      refs: refs.get(item.id) ?? []
    }
  }
  return { file, rows: model.rows.map(row), drills: model.drills, tables: ctx.tables }
}
