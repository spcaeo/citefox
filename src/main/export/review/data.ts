import {
  isAnswered,
  isCitedRow,
  type MetricResult,
  type MetricRow,
  type MetricsResult
} from '@shared/metrics'
import { pathOf, type ReviewReport } from '@shared/report/review'
import type { DataRef, DataRow } from '../html/data'

/**
 * The downloaded ready report's rows and drill lists, in the shape the report's browser
 * script reads (`html/data.ts` `ReportData`): every question as a drawer row, and every
 * question drill as a list of row ids. Each engine view has its own ids (`<view>|<id>`),
 * so a number in the ChatGPT view opens ChatGPT's rows.
 */

const RESULT_WORDS: Readonly<Record<MetricResult, string>> = {
  target: 'Right page cited',
  other: 'Your other page',
  not_cited: 'Not cited',
  no_answer: 'No AI answer',
  failed: 'Search failed'
}

const RESULT_CLASSES: Readonly<Record<MetricResult, string>> = {
  target: 's-target',
  other: 's-own',
  not_cited: 's-none',
  no_answer: 's-noaio',
  failed: 's-error'
}

export function rowsOf(
  view: string,
  report: ReviewReport,
  metrics: MetricsResult,
  meta: { marketLabel: string; engineLabel: string }
): DataRow[] {
  return Object.values(report.questionsById).map((item, index) => {
    const own = metrics.rows[item.id]
    // A question no longer checked keeps its From row: it counts as not checked now.
    const row = item.now === null ? undefined : own
    const result = item.now ?? item.before ?? 'failed'
    const engines = enginesOf(metrics, row)
    return {
      id: `${view}|${item.id}`,
      number: index + 1,
      text: item.text,
      label: meta.engineLabel,
      page: item.page === null ? '—' : pathOf(item.page),
      pageUrl: item.page,
      market: `${meta.marketLabel} · ${meta.engineLabel}`,
      stage: item.funnel ?? '—',
      source: item.topic,
      status: item.now === null ? 'Not checked now' : RESULT_WORDS[result],
      statusClass: RESULT_CLASSES[result],
      aio: row === undefined || row.result === 'failed' ? null : isAnswered(row),
      cited: row !== undefined && isCitedRow(row),
      pageCited: row?.result === 'target',
      named: item.namedNow ?? false,
      position: item.positionNow,
      checked: report.toLabel,
      excerpt: null,
      domains: (row?.domains ?? []).slice(0, 3),
      refs: refsOf(item, row?.domains ?? []),
      view,
      engine: metrics.engine,
      change: item.change,
      citedThrough: item.pageNow === null ? null : pathOf(item.pageNow),
      before:
        report.fromLabel === null
          ? null
          : {
              label: report.fromLabel,
              status: item.before === null ? 'Not checked' : RESULT_WORDS[item.before],
              statusClass: item.before === null ? 's-error' : RESULT_CLASSES[item.before],
              named: item.namedBefore,
              position: item.positionBefore,
              page: item.pageBefore === null ? null : pathOf(item.pageBefore)
            },
      ...(engines.length > 0 ? { engines } : {})
    }
  })
}

/** Under All engines: each engine's result now (an engine view has none). */
function enginesOf(
  metrics: MetricsResult,
  row: MetricRow | undefined
): (readonly [string, string, string])[] {
  if (row === undefined || row.engine !== 'all') return []
  return (row.parts ?? []).flatMap((id) => {
    const part = metrics.rows[id]
    if (part === undefined || part.engine === 'all') return []
    return [[part.engine, RESULT_CLASSES[part.result], RESULT_WORDS[part.result]] as const]
  })
}

/**
 * The answer's sources as the side panel lists them: your cited page first (when there is
 * one), then each other site the answer cites. Metrics rows keep sites, not their URLs.
 */
function refsOf(
  item: ReviewReport['questionsById'][string],
  domains: readonly string[]
): DataRef[] {
  const out: DataRef[] = []
  if (item.page !== null && (item.now === 'target' || item.now === 'other')) {
    let host: string
    try {
      host = new URL(item.page).hostname.replace(/^www\./, '')
    } catch {
      host = ''
    }
    out.push([item.positionNow ?? 1, item.page, host, '', item.now === 'target' ? 'target' : 'own'])
  }
  const start = out.length
  domains.forEach((domain, index) => out.push([start + index + 1, '', domain, '', 'other']))
  return out
}

/** Question drills as row-id lists. Page drills stay out: their tiles filter the tables. */
export function drillsOf(view: string, report: ReviewReport): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [id, drill] of Object.entries(report.drills)) {
    if (drill.kind !== 'questions') continue
    out[`${view}|${id}`] = drill.ids.map((item) => `${view}|${item}`)
  }
  return out
}
