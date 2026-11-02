import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import { isAnswered, isCitedRow, isMeasured } from '../../metrics/counts'
import { pageKey } from '../../metrics/pages'
import type { MetricCount, MetricRow, MetricsResult, PageRow } from '../../metrics/types'
import type { Drill, Movement, Num, PageItem, PageStatus, QuestionItem } from './types'

/**
 * The rows of one `MetricsResult` as report items, and the drill registry every number
 * points into. A question is listed by its `to` row id, so a number counted at the From
 * end ("cited on Sep 16") opens the same questions with both ends side by side.
 */

export class DrillBook {
  readonly drills: Record<string, Drill> = {}

  /** Registers a drill and returns its number. The first registration of an id wins. */
  add(id: string, drill: Drill): Num {
    if (this.drills[id] === undefined) this.drills[id] = drill
    return { n: this.drills[id].ids.length, drill: id }
  }
}

/** Maps `from` row ids to the `to` row id of the same question. */
export function toIdsOf(metrics: MetricsResult): (ids: readonly string[]) => string[] {
  const toOf = new Map<string, string>()
  for (const [to, from] of Object.entries(metrics.fromOf)) toOf.set(from, to)
  return (ids) => ids.map((id) => toOf.get(id) ?? id)
}

function changeOf(from: MetricRow | null, to: MetricRow | null): Movement | null {
  if (from === null || to === null || !isMeasured(from) || !isMeasured(to)) return null
  const before = isCitedRow(from)
  const after = isCitedRow(to)
  if (after) return before ? 'kept' : 'gained'
  if (before) return 'lost'
  return isAnswered(to) ? 'notcited' : 'noanswer'
}

export function questionItems(
  metrics: MetricsResult,
  comparing: boolean,
  targets: Readonly<Record<string, readonly string[]>> = {}
): QuestionItem[] {
  const rows = metrics.rows
  const out: QuestionItem[] = []
  const seen = new Set<string>()
  const item = (to: MetricRow | null, from: MetricRow | null): QuestionItem => {
    const base = (to ?? from) as MetricRow
    return {
      id: base.id,
      text: base.text,
      topic: base.segments.topic ?? 'Not set',
      funnel: base.segments.funnel,
      intent: base.segments.intent,
      pageType: base.segments.pageType,
      before: from?.result ?? null,
      now: to?.result ?? null,
      page: (to !== null && isCitedRow(to) ? to.citedUrl : null) ?? from?.citedUrl ?? null,
      positionBefore: from !== null && isCitedRow(from) ? from.position : null,
      positionNow: to !== null && isCitedRow(to) ? to.position : null,
      change: comparing ? changeOf(from, to) : null,
      targets: targets[base.questionId] ?? [],
      pageBefore: from !== null && isCitedRow(from) ? from.citedUrl : null,
      pageNow: to !== null && isCitedRow(to) ? to.citedUrl : null,
      namedBefore: from === null || !isMeasured(from) ? null : from.named,
      namedNow: to === null || !isMeasured(to) ? null : to.named
    }
  }
  for (const id of metrics.now.checked.ids) {
    const to = rows[id]
    if (to === undefined) continue
    const fromId = metrics.fromOf[id]
    const from = comparing && fromId !== undefined ? (rows[fromId] ?? null) : null
    out.push(item(to, from))
    seen.add(id)
  }
  for (const id of metrics.comparison?.excluded.noAfter.ids ?? []) {
    const from = rows[id]
    if (from === undefined || seen.has(id)) continue
    out.push(item(null, from))
  }
  return out
}

/** `/pricing` from `https://www.example.com/pricing/`; `/` for the home page. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    return path.length === 0 ? '/' : path
  } catch {
    return url
  }
}

/**
 * The 14-day rule (Docs/METRICS.md "Published pages"): AI answers take time to pick up a
 * page, so a page live under {@link VERDICT_WAIT_DAYS} days is listed but not judged.
 * Lost ground wins, then cited now, then too new, else not cited yet.
 */
export function pageStatus(row: PageRow): PageStatus {
  if (row.status === 'lost') return 'lost'
  if (row.cited.now.n > 0) return 'cited'
  if (row.daysLive === null || row.daysLive < VERDICT_WAIT_DAYS) return 'toonew'
  return 'notyet'
}

export function pageItems(metrics: MetricsResult, published: ReadonlySet<string>): PageItem[] {
  return metrics.pages.rows.map((row) => ({
    url: row.url,
    path: pathOf(row.url),
    title: row.title,
    kind: row.kind,
    liveSince: row.liveSince,
    daysLive: row.daysLive,
    indexed: row.indexed,
    before: row.cited.before?.n ?? null,
    now: row.cited.now.n,
    status: pageStatus(row),
    published: published.has(row.url)
  }))
}

/** Page ids (URLs) of a page count, as a page key set. */
export function pageSet(count: MetricCount): Set<string> {
  return new Set(count.ids.map(pageKey))
}

export const PAGE_STATUS_LABELS: Readonly<Record<PageStatus, string>> = {
  cited: 'Cited now',
  notyet: 'Not cited yet',
  toonew: 'Too new',
  lost: 'Lost ground'
}

export const MOVEMENT_LABELS: Readonly<Record<Movement, string>> = {
  gained: 'Gained',
  kept: 'Kept',
  lost: 'Lost',
  notcited: 'Not cited',
  noanswer: 'No AI answer'
}

/** Whole questions from tenths, signed: "+12", "−0.5", "0". */
export function signedTenths(tenths: number): string {
  const value = tenths / 10
  const text = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1)
  if (value > 0) return `+${text}`
  if (value < 0) return `−${text}`
  return '0'
}

export function tenthsText(tenths: number): string {
  const value = Math.abs(tenths) / 10
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** 0.231 → "23.1%"; null → "—". */
export function percent(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}
