import {
  ANSWER_ENGINE_IDS,
  type AnswerEngineId,
  type PageSummary,
  type PromptCheckRow
} from '@shared/domain'
import type { MetricsRequest } from '@shared/ipc'
import {
  checksIn,
  computeMetrics,
  filterRows,
  firstCheckAt,
  pageKey,
  type MetricPage,
  type MetricRow,
  type MetricSegments,
  type MetricsResult,
  type MetricWindow
} from '@shared/metrics'
import type { TopicPromptMeta } from '@shared/topic-results'
import { readActivePrompts } from '../questions/reads'
import type { SqliteDatabase } from '../storage/database'
import { listAnswerRunSamples, type AnswerRunSample } from '../storage/engine-reads'
import { listFixFollowUps } from '../storage/fix-follow-ups'
import { latestIndexChecks } from '../storage/fix-loop-records'
import { listPages } from '../storage/pages'
import type { ProjectRecord } from '../storage/records'
import { stableKeys, topicPromptMetas } from '../topics/results'
import { answerOutcome } from '../topics/engine-runs'
import { enabledPromptCounts } from '../engine/allpages/rows'
import { buildTimeline, isWorkingPage, lineageRoot, readLineage } from '../engine/overview/timeline'
import type { SourceTimeline } from '../engine/overview/timeline'
import { funnelStage } from '../export/model/rows'
import { IpcRequestError } from '../ipc-request'
import { metricRowOf, NO_SEGMENTS } from './rows'

/**
 * `reports:metrics`: the stored checks of every tracked page and topic as plain metrics
 * rows, then `computeMetrics`. Pages and topics are read the way Summary reads them
 * (`engine/overview/timeline.ts`): finished checks only (a page's full checks, every check
 * of a topic), in the market asked for or each one's default market. Google AI Overview
 * rows come from the stored checks; the other engines from their stored answers in the
 * same checks. Nothing is searched.
 */
export function loadMetrics(
  db: SqliteDatabase,
  project: ProjectRecord,
  request: MetricsRequest
): MetricsResult {
  const enabled = enabledPromptCounts(db)
  const lineage = readLineage(db)
  const targets = new Map(
    readActivePrompts(db, request.marketId).map((prompt) => [prompt.id, prompt])
  )
  const rows: MetricRow[] = []
  for (const page of listPages(db, project.id)) {
    if (!isWorkingPage(page) || (enabled.get(page.id) ?? 0) === 0) continue
    if (!wanted(page, request)) continue
    const timeline = buildTimeline(db, {
      projectId: project.id,
      page,
      marketId: request.marketId,
      enabledPrompts: enabled.get(page.id) ?? 0,
      lineage
    })
    if (timeline === null || timeline.marketId === null) continue
    const source = sourceReader(
      db,
      timeline,
      (promptId) => targets.get(promptId)?.targetUrl ?? null
    )
    // Every engine is read, whatever the filter: the result lists the engines on offer.
    rows.push(...googleRows(timeline, source))
    for (const engine of ANSWER_ENGINE_IDS) {
      rows.push(
        ...answerRows(db, timeline, engine, source, lineage, (promptId) => {
          const text = targets.get(promptId)?.text
          return text === undefined || text.length === 0 ? null : text
        })
      )
    }
  }
  return computeMetrics({
    rows,
    pages: publishedPages(db, project.id),
    ownDomain: project.domain,
    scope: request.scope,
    marketId: request.marketId,
    engine: request.engine,
    window: windowOf(db, request, rows)
  })
}

/** Skip pages and topics outside a page or topic scope before reading their checks. */
function wanted(page: PageSummary, request: MetricsRequest): boolean {
  const { scope } = request
  if (scope.kind === 'project') return true
  const kind = page.kind === 'topic' ? 'topic' : 'page'
  return scope.kind === kind && scope.id === page.id
}

/** What a page's or topic's rows share: their segments and how a result is read. */
interface SourceReader {
  kind: 'page' | 'topic'
  segmentsOf: (
    questionId: string,
    row: Pick<PromptCheckRow, 'intentStage'> | null
  ) => MetricSegments
  /** A topic question's target page; undefined for a page question. */
  targetOf: (promptId: string) => string | null | undefined
  /** Question text by question id, filled as Google rows are read. */
  texts: Map<string, string>
}

function sourceReader(
  db: SqliteDatabase,
  timeline: SourceTimeline,
  targetUrl: (promptId: string) => string | null
): SourceReader {
  const { page } = timeline
  const name = page.label ?? page.title ?? page.url ?? page.id
  if (timeline.kind === 'page') {
    return {
      kind: 'page',
      segmentsOf: (_questionId, row) => ({
        ...NO_SEGMENTS,
        topic: name,
        funnel: row === null ? null : funnelStage(row.intentStage)
      }),
      targetOf: () => undefined,
      texts: new Map()
    }
  }
  const metas = new Map<string, TopicPromptMeta>(
    topicPromptMetas(db, page.id, timeline.marketId).map((meta) => [
      `${page.id}|${meta.stableKey}`,
      meta
    ])
  )
  return {
    kind: 'topic',
    segmentsOf: (questionId) => {
      const meta = metas.get(questionId)
      return {
        topic: name,
        group: meta?.kwGroup ?? null,
        funnel: meta?.funnel ?? null,
        intent: meta?.intent ?? null,
        pageType: meta?.pageType ?? null
      }
    },
    targetOf: (promptId) => targetUrl(promptId),
    texts: new Map([...metas].map(([key, meta]) => [key, meta.text]))
  }
}

/** Each finished check's Google AI Overview rows: only the questions that check asked. */
function googleRows(timeline: SourceTimeline, source: SourceReader): MetricRow[] {
  const out: MetricRow[] = []
  for (const run of timeline.runs) {
    if (run.finishedAt === null) continue
    for (const outcome of timeline.stateAt(run.finishedAt)?.values() ?? []) {
      if (outcome.runId !== run.id) continue
      source.texts.set(outcome.key, outcome.text)
      const row = metricRowOf(outcome.row, {
        id: `google_aio:${run.id}:${outcome.promptId}`,
        questionId: outcome.key,
        text: outcome.text,
        engine: 'google_aio',
        marketId: outcome.marketId,
        sourceId: timeline.page.id,
        sourceKind: source.kind,
        checkId: run.id,
        checkedAt: run.finishedAt,
        segments: source.segmentsOf(outcome.key, outcome.row),
        topicTarget: source.targetOf(outcome.promptId)
      })
      if (row !== null) out.push(row)
    }
  }
  return out
}

/** One answer engine's outcomes in the same finished checks, one per question per check. */
function answerRows(
  db: SqliteDatabase,
  timeline: SourceTimeline,
  engine: AnswerEngineId,
  source: SourceReader,
  lineage: ReadonlyMap<string, string>,
  promptText: (promptId: string) => string | null
): MetricRow[] {
  const marketId = timeline.marketId
  if (marketId === null) return []
  const finished = new Map(
    timeline.runs.flatMap((run) => (run.finishedAt === null ? [] : [[run.id, run.finishedAt]]))
  )
  const byRun = new Map<string, Map<string, AnswerRunSample[]>>()
  for (const sample of listAnswerRunSamples(db, { pageId: timeline.page.id, marketId, engine })) {
    if (!finished.has(sample.runId)) continue
    const prompts = byRun.get(sample.runId) ?? new Map<string, AnswerRunSample[]>()
    prompts.set(sample.promptId, [...(prompts.get(sample.promptId) ?? []), sample])
    byRun.set(sample.runId, prompts)
  }
  const topicKeys = source.kind === 'topic' ? stableKeys(db, timeline.page.id) : null
  const out: MetricRow[] = []
  for (const [runId, prompts] of byRun) {
    const checkedAt = finished.get(runId) ?? ''
    for (const [promptId, samples] of prompts) {
      const key =
        topicKeys === null ? lineageRoot(lineage, promptId) : (topicKeys.get(promptId) ?? null)
      if (key === null) continue
      const questionId = `${timeline.page.id}|${key}`
      // A topic counts only its active questions, as its Google rows do.
      if (source.kind === 'topic' && !source.texts.has(questionId)) continue
      const outcome = answerOutcome(samples, runId)
      if (outcome === null) continue
      const row = metricRowOf(outcome, {
        id: `${engine}:${runId}:${promptId}`,
        questionId,
        text: source.texts.get(questionId) ?? promptText(promptId) ?? '',
        engine,
        marketId,
        sourceId: timeline.page.id,
        sourceKind: source.kind,
        checkId: runId,
        checkedAt,
        segments: source.segmentsOf(questionId, null),
        topicTarget: source.targetOf(promptId)
      })
      if (row !== null) out.push(row)
    }
  }
  return out
}

/**
 * Pages you published or changed (the changes ledger's fixes): new page or rewrite, go-live
 * and the last Google index check of that address. A fix is a rewrite of its page.
 */
export function publishedPages(db: SqliteDatabase, projectId: string): MetricPage[] {
  const pages = listPages(db, projectId)
  const byId = new Map(
    pages.filter((page) => page.status !== 'removed').map((page) => [page.id, page])
  )
  const index = new Map<string, boolean | null>()
  for (const check of latestIndexChecks(db).values()) {
    index.set(pageKey(check.url), check.state === 'unknown' ? null : check.state === 'indexed')
  }
  const out: MetricPage[] = []
  for (const fix of listFixFollowUps(db)) {
    const page = byId.get(fix.pageId)
    if (page === undefined) continue
    const url = fix.url ?? (page.kind === 'topic' ? null : page.url)
    if (url === null) continue
    out.push({
      url,
      title: fix.url === null ? (page.label ?? page.title) : null,
      kind: fix.kind === 'new_page' ? 'new' : 'rewrite',
      liveSince: fix.goLiveAt,
      indexed: index.get(pageKey(url)) ?? null
    })
  }
  return out
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A run id, a day or a time as a moment; `previous` and null pass through. */
function momentOf(db: SqliteDatabase, value: string | null): string | null {
  if (value === null || value === 'previous') return value
  if (DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    return `${value}T23:59:59.999Z`
  }
  const run = db
    .prepare<unknown[], { finished_at: string | null }>('SELECT finished_at FROM runs WHERE id = ?')
    .get(value)
  if (run !== undefined) {
    if (run.finished_at === null)
      throw new IpcRequestError('reports:metrics', 'That check has not finished')
    return run.finished_at
  }
  if (value.includes('T') && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  throw new IpcRequestError('reports:metrics', 'Pick a check, a day or a time')
}

function windowOf(
  db: SqliteDatabase,
  request: MetricsRequest,
  rows: readonly MetricRow[]
): MetricWindow {
  if (request.from === 'first') {
    const scoped = filterRows(rows, { ...request, engine: 'all' })
    return { from: firstCheckAt(checksIn(scoped)), to: momentOf(db, request.to) }
  }
  return { from: momentOf(db, request.from), to: momentOf(db, request.to) }
}
