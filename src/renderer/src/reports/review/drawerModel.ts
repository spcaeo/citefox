import type { EngineId } from '@shared/domain'
import type { GridCsvRequest } from '@shared/ipc'
import {
  isCitedRow,
  pageKey,
  type MetricResult,
  type MetricRow,
  type MetricsResult
} from '@shared/metrics'
import {
  drawerStrip,
  MOVEMENT_LABELS,
  pathOf,
  type PageItem,
  type QuestionItem,
  type ReviewReport
} from '@shared/report/review'
import { csvFileName } from '../../grid/model/labels'

/** What the first drawer lists: exactly the drill's rows, with a strip of counts. */
export type DrillView =
  | {
      kind: 'questions'
      title: string
      sub: string | null
      /** An answer journey's "Write a page in this order". */
      outline?: readonly string[]
      rows: readonly QuestionItem[]
      stats: readonly { label: string; value: number }[]
    }
  | {
      kind: 'pages'
      title: string
      sub: string | null
      rows: readonly PageItem[]
      stats: readonly { label: string; value: number }[]
    }

export function drillView(report: ReviewReport, id: string): DrillView | null {
  const drill = report.drills[id]
  if (drill === undefined) return null
  if (drill.kind === 'pages') {
    const rows = drill.ids.flatMap((url) => {
      const page = report.pagesByUrl[url]
      return page === undefined ? [] : [page]
    })
    return {
      kind: 'pages',
      title: drill.title,
      sub: drill.sub ?? null,
      rows,
      stats: [
        { label: rows.length === 1 ? 'page' : 'pages', value: rows.length },
        { label: 'cited now', value: rows.filter((row) => row.now > 0).length },
        { label: 'questions citing them', value: rows.reduce((sum, row) => sum + row.now, 0) }
      ]
    }
  }
  const rows = drill.ids.flatMap((qid) => {
    const item = report.questionsById[qid]
    return item === undefined ? [] : [item]
  })
  return {
    kind: 'questions',
    title: drill.title,
    sub: drill.sub ?? null,
    ...(drill.outline ? { outline: drill.outline } : {}),
    rows,
    stats: stripStats(rows)
  }
}

/** The strip on every question drawer: questions, answer shown, cited, brand named, gap. */
export function stripStats(rows: readonly QuestionItem[]): { label: string; value: number }[] {
  const strip = drawerStrip(rows)
  return [
    { label: strip.questions === 1 ? 'question' : 'questions', value: strip.questions },
    { label: 'AI answer shown', value: strip.answered },
    { label: 'cite you', value: strip.cited },
    { label: 'brand named', value: strip.named },
    { label: 'gap: answer without you', value: strip.gap }
  ]
}

export interface EngineColumns {
  list: readonly EngineId[]
  byId: Record<string, Partial<Record<EngineId, MetricResult>>>
}

/** Under All engines with two or more engines: each engine's result now, by question id. */
export function engineColumns(
  report: ReviewReport,
  metrics: MetricsResult,
  rows: readonly QuestionItem[]
): EngineColumns | undefined {
  if (report.engine !== 'all' || metrics.offeredEngines.length < 2) return undefined
  const byId: Record<string, Partial<Record<EngineId, MetricResult>>> = {}
  for (const row of rows) {
    if (row.now === null) continue
    const cells: Partial<Record<EngineId, MetricResult>> = {}
    for (const part of metrics.rows[row.id]?.parts ?? []) {
      const answer = metrics.rows[part]
      if (answer !== undefined && answer.engine !== 'all') cells[answer.engine] = answer.result
    }
    byId[row.id] = cells
  }
  return { list: metrics.offeredEngines, byId }
}

/** One engine's answer to a question at one end. */
export interface EngineAnswer {
  engine: EngineId
  result: MetricResult
  position: number | null
  page: string | null
}

export interface QuestionDetail {
  item: QuestionItem
  now: MetricRow | null
  before: MetricRow | null
  enginesNow: readonly EngineAnswer[]
  enginesBefore: readonly EngineAnswer[]
  sitesNow: readonly string[]
  sitesBefore: readonly string[]
  history: readonly { at: string; result: MetricResult; position: number | null }[]
  named: boolean
}

function answers(metrics: MetricsResult, row: MetricRow | null): EngineAnswer[] {
  if (row === null) return []
  const parts = row.parts ?? [row.id]
  return parts.flatMap((id) => {
    const part = metrics.rows[id]
    if (part === undefined || part.engine === 'all') return []
    return [
      {
        engine: part.engine,
        result: part.result,
        position: isCitedRow(part) ? part.position : null,
        page: isCitedRow(part) ? part.citedUrl : null
      }
    ]
  })
}

export function questionDetailOf(
  report: ReviewReport,
  metrics: MetricsResult,
  id: string
): QuestionDetail | null {
  const item = report.questionsById[id]
  if (item === undefined) return null
  const own = metrics.rows[id] ?? null
  const isTo = item.now !== null
  const now = isTo ? own : null
  const fromId = metrics.fromOf[id]
  const before = isTo ? (fromId === undefined ? null : (metrics.rows[fromId] ?? null)) : own
  const history = metrics.history.find((entry) => entry.points.at(-1)?.rowId === id)
  return {
    item,
    now,
    before: report.comparing ? before : null,
    enginesNow: answers(metrics, now),
    enginesBefore: report.comparing ? answers(metrics, before) : [],
    sitesNow: now?.domains ?? [],
    sitesBefore: report.comparing ? (before?.domains ?? []) : [],
    history: (history?.points ?? []).map((point) => ({
      at: point.checkedAt,
      result: point.result,
      position: point.position
    })),
    named: now?.named ?? false
  }
}

/** The CSV of exactly what a drawer lists. */
export function drillCsvOf(
  report: ReviewReport,
  view: DrillView,
  now = new Date()
): GridCsvRequest {
  const fileName = csvFileName(`citefox-${view.title}`, now)
  if (view.kind === 'pages') {
    return {
      fileName,
      header: ['Page', 'Kind', 'Days live', 'Google index', 'Questions now', 'Status'],
      rows: view.rows.map((row) => [
        row.url,
        row.kind ?? '',
        row.daysLive,
        row.indexed === null ? '' : row.indexed ? 'Indexed' : 'Not indexed',
        row.now,
        row.status
      ])
    }
  }
  return {
    fileName,
    header: [
      'Question',
      'Topic',
      ...(report.fromLabel === null ? [] : [report.fromLabel]),
      report.toLabel,
      'Change',
      'Your page'
    ],
    rows: view.rows.map((row) => [
      row.text,
      row.topic,
      ...(report.fromLabel === null ? [] : [row.before ?? '']),
      row.now ?? '',
      row.change === null ? '' : MOVEMENT_LABELS[row.change],
      row.page === null ? '' : pathOf(row.page)
    ])
  }
}

/** The page keys a report can open in the page drawer. */
export function knownPagesOf(report: ReviewReport): ReadonlySet<string> {
  return new Set(Object.keys(report.pagesByUrl).map(pageKey))
}
