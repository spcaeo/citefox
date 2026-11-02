import { SURE_FIT } from '@shared/topic-scoring'
import type { AnswerEngineId, PromptCheckRow, TopicSource, TopicSummary } from '@shared/domain'
import type { TopicMeta, TopicResults, TopicSavedSummary } from '@shared/ipc'
import {
  assembleTopicResults,
  type TopicPromptMeta,
  type TopicRunOutcomes
} from '@shared/topic-results'
import { targetRate, topicGoal, type TopicOutcome } from '@shared/topic-scoring'
import { askMarketLabel } from '../ask/query'
import {
  liveCheckOf,
  liveRowState,
  orderAt,
  readableRuns,
  type ReadableRun
} from '../engine/checks/live-runs'
import { loadPageResults, runPromptRows } from '../engine/checks/results'
import { normalizeUrl } from '../engine/checks/url'
import type { SqliteDatabase } from '../storage/database'
import { getPage, listPageMarkets, listPagesOfKind } from '../storage/pages'
import { listMarkets, readProjectProfile } from '../storage/project-profile'
import {
  getTopic,
  getTopicTargetPage,
  listTopicBatches,
  listTopicPrompts,
  listTopics,
  type TopicRecord
} from './records'
import { engineRunOutcomes } from './engine-runs'

/** The topic's active prompt set id, or null before one is saved. */
export function activePromptSetId(db: SqliteDatabase, pageId: string): string | null {
  const row = db
    .prepare<unknown[], { id: string }>(
      'SELECT id FROM prompt_sets WHERE page_id = ? AND is_active = 1'
    )
    .get(pageId)
  return row?.id ?? null
}

interface PromptTextRow {
  id: string
  position: number
  enabled: number
  text: string | null
  label: string
}

/**
 * Prompt metadata of the active set, numbered per kind (Q1…, K1…). Disabled prompts are left out.
 * A prompt with no target page of its own takes the topic's target page (migration 047).
 */
export function topicPromptMetas(
  db: SqliteDatabase,
  pageId: string,
  marketId: string | null
): TopicPromptMeta[] {
  const setId = activePromptSetId(db, pageId)
  if (setId === null) return []
  const texts = new Map(
    db
      .prepare<unknown[], PromptTextRow>(
        `SELECT prompts.id AS id, prompts.position AS position, prompts.enabled AS enabled,
                prompts.label AS label,
                (SELECT text FROM prompt_variants v WHERE v.prompt_id = prompts.id
                  ORDER BY (v.market_id = ?) DESC LIMIT 1) AS text
           FROM prompts WHERE prompt_set_id = ?`
      )
      .all(marketId ?? '', setId)
      .map((row) => [row.id, row])
  )
  const topicTarget = getTopicTargetPage(db, pageId)
  const counters = { question: 0, keyword: 0 }
  const out: TopicPromptMeta[] = []
  for (const record of listTopicPrompts(db, setId)) {
    const prompt = texts.get(record.promptId)
    if (prompt === undefined || prompt.enabled !== 1) continue
    counters[record.kind] += 1
    // An AI page below SURE_FIT is a hint only, never the yardstick for "other page".
    const unsure =
      record.matchSetBy === 'claude' &&
      !record.matchConfirmed &&
      (record.matchConfidence ?? 0) < SURE_FIT
    const own = record.targetUrl !== null && !unsure
    const targetUrl = own ? record.targetUrl : topicTarget
    out.push({
      promptId: record.promptId,
      stableKey: record.stableKey,
      number: counters[record.kind],
      kind: record.kind,
      text: prompt.text ?? prompt.label,
      stage: record.stage,
      kwGroup: record.kwGroup,
      kwGroupKind: record.kwGroupKind,
      intent: record.intent,
      funnel: record.funnel,
      pageType: record.pageType,
      targetPageId: own ? record.targetPageId : null,
      targetUrl,
      targetNormalizedUrl: targetUrl === null ? null : normalizeUrl(targetUrl),
      // Your other pages for it count only beside a target you set.
      alsoUrls: own ? (record.alsoUrls ?? []) : [],
      alsoNormalizedUrls: own ? (record.alsoUrls ?? []).map((url) => normalizeUrl(url) ?? url) : [],
      // Shown as a hint even when unsure; a reason means CiteFox AI has matched it.
      matchConfidence: record.matchConfidence,
      matchReason: record.matchReason,
      aiPageUrl: record.matchSetBy === 'claude' ? record.targetUrl : null,
      // The topic's target page is one the user picked.
      targetConfirmed: own
        ? record.matchSetBy === 'user' || record.matchConfirmed
        : targetUrl !== null
    })
  }
  return out
}

/** Prompt id → stable key for every prompt-set version of the topic. */
export function stableKeys(db: SqliteDatabase, pageId: string): Map<string, string> {
  return new Map(
    db
      .prepare<unknown[], { prompt_id: string; stable_key: string }>(
        'SELECT prompt_id, stable_key FROM topic_prompts WHERE page_id = ?'
      )
      .all(pageId)
      .map((row) => [row.prompt_id, row.stable_key])
  )
}

function outcomeOf(
  row: PromptCheckRow,
  runId: string,
  checkedAt: string | null = row.checkedAt
): TopicOutcome {
  if (checkedAt === null) {
    return {
      status: null,
      references: [],
      named: null,
      runId: null,
      checkedAt: null,
      aioSummary: null
    }
  }
  return {
    status: row.status,
    references: row.references.map((ref) => ({
      url: ref.url,
      normalizedUrl: ref.normalizedUrl,
      domain: ref.domain,
      position: ref.position,
      classification: ref.classification
    })),
    named: row.named,
    runId,
    checkedAt,
    aioSummary: row.aioSummary
  }
}

/**
 * Runs of the topic in one market, oldest first, as outcomes per stable key: finished
 * runs, and the questions a running or stopped check has scored so far (`live-runs.ts`).
 */
export function topicRunOutcomes(
  db: SqliteDatabase,
  input: { projectId: string; pageId: string; marketId: string; domain: string; builtAt: string },
  readable: readonly ReadableRun[] = readableRuns(db, input)
): TopicRunOutcomes[] {
  const keys = stableKeys(db, input.pageId)
  const runs = readable.filter((item) => item.state !== 'finished' || item.run.finishedAt !== null)
  return runs.map(({ run, state }) => {
    if (state !== 'finished') {
      // Only questions with every sample stored have a row; each is a real result.
      const outcomes = new Map<string, TopicOutcome>()
      for (const row of runPromptRows(db, input.projectId, run)) {
        const key = keys.get(row.promptId)
        if (key !== undefined) outcomes.set(key, outcomeOf(row, run.id, orderAt(run)))
      }
      return { runId: run.id, finishedAt: orderAt(run), partial: true, state, outcomes }
    }
    const results = loadPageResults(db, {
      projectId: input.projectId,
      pageId: input.pageId,
      marketId: input.marketId,
      runId: run.id,
      builtAt: input.builtAt,
      domain: input.domain,
      keyLabels: new Map()
    })
    const outcomes = new Map<string, TopicOutcome>()
    for (const row of results.prompts) {
      const key = keys.get(row.promptId)
      if (key !== undefined) outcomes.set(key, outcomeOf(row, run.id))
    }
    return {
      runId: run.id,
      finishedAt: run.finishedAt ?? run.startedAt,
      partial: run.partial,
      state,
      outcomes
    }
  })
}

function marketsOf(
  db: SqliteDatabase,
  pageId: string,
  defaultMarketId: string | null
): TopicMeta['markets'] {
  const linked = new Set(listPageMarkets(db, pageId).map((row) => row.marketId))
  return listMarkets(db)
    .filter((market) => linked.has(market.id))
    .map((market) => ({
      id: market.id,
      label: askMarketLabel(market),
      isDefault: market.id === defaultMarketId
    }))
}

const SOURCE_LABEL: Readonly<Record<TopicSource, string>> = {
  seed: 'From a seed',
  questions: 'From your own questions',
  competitor: "From a competitor's page"
}

export function latestTopicSummary(
  db: SqliteDatabase,
  pageId: string,
  marketId: string
): TopicSavedSummary | null {
  const row = db
    .prepare<unknown[], { line: string; created_at: string; run_id: string | null }>(
      `SELECT line, created_at, run_id FROM topic_summaries
        WHERE page_id = ? AND market_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(pageId, marketId)
  return row === undefined ? null : { text: row.line, createdAt: row.created_at, runId: row.run_id }
}

function editsBetween(
  db: SqliteDatabase,
  pageId: string,
  from: string | null
): { date: string; text: string }[] {
  if (from === null) return []
  return db
    .prepare<unknown[], { date: string; text: string }>(
      'SELECT date, text FROM notes WHERE page_id = ? AND date >= ? ORDER BY date'
    )
    .all(pageId, from.slice(0, 10))
}

export interface LoadTopicResultsInput {
  projectId: string
  topicId: string
  marketId: string | null
  runId: string | null
  domain: string
  builtAt: string
  /** An answer engine reads its stored answers instead of Google's (audit #4). */
  engine?: AnswerEngineId | null
}

function brandOf(db: SqliteDatabase): { name: string; aliases: string[] } {
  const names = (readProjectProfile(db)?.brandNames ?? []).filter((name) => name.trim().length > 0)
  return { name: names[0] ?? '', aliases: names.slice(1) }
}

export class TopicNotFoundError extends Error {
  constructor() {
    super('That topic was not found')
    this.name = 'TopicNotFoundError'
  }
}

/** `topics:results`. Reads stored checks only; never searches or calls Claude. */
export function loadTopicResults(db: SqliteDatabase, input: LoadTopicResultsInput): TopicResults {
  const page = getPage(db, input.topicId, input.projectId)
  const topic = getTopic(db, input.topicId)
  if (page === null || page.kind !== 'topic' || topic === null) throw new TopicNotFoundError()
  const markets = marketsOf(db, page.id, page.defaultMarketId)
  const marketId = input.marketId ?? page.defaultMarketId ?? markets[0]?.id ?? null
  if (marketId === null) throw new TopicNotFoundError()
  const metas = topicPromptMetas(db, page.id, marketId)
  const readable = readableRuns(db, { projectId: input.projectId, pageId: page.id, marketId })
  const engine = input.engine ?? null
  const runs =
    engine === null
      ? topicRunOutcomes(
          db,
          {
            projectId: input.projectId,
            pageId: page.id,
            marketId,
            domain: input.domain,
            builtAt: input.builtAt
          },
          readable
        )
      : engineRunOutcomes(
          db,
          { pageId: page.id, marketId, engine },
          readable,
          stableKeys(db, page.id)
        )
  const newest = readable.at(-1)
  const live = newest === undefined || input.runId !== null ? null : liveCheckOf(db, newest)
  const questions = metas.filter((meta) => meta.kind === 'question')
  const targets = new Set(metas.map((meta) => meta.targetUrl).filter((url) => url !== null))
  const pending = listTopicBatches(db, page.id).filter(
    (batch) => batch.startedAt === null && batch.cancelledAt === null
  ).length
  const sourceLine = [
    SOURCE_LABEL[topic.source],
    questions.length > 0 ? `${questions.length} questions` : null,
    metas.length > questions.length ? `${metas.length - questions.length} keywords` : null,
    `${targets.size} target ${targets.size === 1 ? 'page' : 'pages'}`,
    page.intervalDays === 1 ? 'every day' : `every ${page.intervalDays} days`
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const meta: TopicMeta = {
    id: page.id,
    name: page.title ?? topic.seed,
    source: topic.source,
    sourceLine,
    seed: topic.seed,
    competitorUrl: topic.competitorUrl,
    intervalDays: page.intervalDays,
    status: page.status,
    checkedAt: runs.filter((run) => run.state === 'finished').at(-1)?.finishedAt ?? null,
    markets,
    marketId,
    bands: topic.bands,
    questions: questions.length,
    keywords: metas.length - questions.length,
    targetPages: targets.size,
    targetPage: getTopicTargetPage(db, page.id),
    pendingBatches: pending,
    brand: brandOf(db),
    domain: input.domain
  }
  const full = runs.filter((run) => !run.partial)
  const sinceAt = full.length >= 2 ? (full[full.length - 2]?.finishedAt ?? null) : null
  const assembled = assembleTopicResults({
    topic: meta,
    bands: topic.bands,
    metas,
    runs,
    pinnedRunId: input.runId,
    savedSummary: latestTopicSummary(db, page.id, marketId),
    edits: editsBetween(db, page.id, sinceAt),
    builtAt: input.builtAt
  })
  if (live === null) return { ...assembled, live: null }
  const liveRunId = newest?.run.id ?? null
  return {
    ...assembled,
    live: live.live,
    // Questions the running check has not scored yet: "waiting" or "checking…", never
    // "not cited". A re-check keeps the earlier result on screen until the new one lands.
    rows:
      live.live.state !== 'running'
        ? assembled.rows
        : assembled.rows.map((row) =>
            row.runId === liveRunId
              ? row
              : { ...row, live: liveRowState(live.progress, row.promptId) }
          )
  }
}

/** `topics:list`: every topic with its goals in the default market. */
export function listTopicSummaries(
  db: SqliteDatabase,
  input: { projectId: string; domain: string; builtAt: string }
): TopicSummary[] {
  const records = new Map(listTopics(db).map((record) => [record.pageId, record]))
  const out: TopicSummary[] = []
  for (const page of listPagesOfKind(db, input.projectId, 'topic')) {
    const record = records.get(page.id)
    if (record === undefined) continue
    out.push(summaryOf(db, input, page.id, page.title ?? record.seed, record, page))
  }
  return out
}

function summaryOf(
  db: SqliteDatabase,
  input: { projectId: string; domain: string; builtAt: string },
  pageId: string,
  name: string,
  record: TopicRecord,
  page: { status: TopicSummary['status']; intervalDays: number; defaultMarketId: string | null }
): TopicSummary {
  const metas = topicPromptMetas(db, pageId, page.defaultMarketId)
  const questions = metas.filter((meta) => meta.kind === 'question').length
  let questionsGoal: number | null = null
  let keywordsGoal: number | null = null
  let targetPct: number | null = null
  let checkedAt: string | null = null
  if (page.defaultMarketId !== null) {
    const runs = topicRunOutcomes(db, {
      projectId: input.projectId,
      pageId,
      marketId: page.defaultMarketId,
      domain: input.domain,
      builtAt: input.builtAt
    })
    if (runs.length > 0) {
      const results = assembleTopicResults({
        topic: {} as TopicMeta,
        bands: record.bands,
        metas,
        runs,
        pinnedRunId: null,
        savedSummary: null,
        builtAt: input.builtAt
      })
      questionsGoal = topicGoal(results.rows, 'question', record.bands.questions).rate
      keywordsGoal = topicGoal(results.rows, 'keyword', record.bands.keywords).rate
      targetPct = targetRate(results.rows)
      checkedAt = runs.filter((run) => run.state === 'finished').at(-1)?.finishedAt ?? null
    }
  }
  return {
    id: pageId,
    projectId: input.projectId,
    name,
    source: record.source,
    status: page.status,
    questions,
    keywords: metas.length - questions,
    questionsGoal,
    keywordsGoal,
    targetPct,
    bands: record.bands,
    intervalDays: page.intervalDays,
    checkedAt,
    pendingBatches: listTopicBatches(db, pageId).filter(
      (batch) => batch.startedAt === null && batch.cancelledAt === null
    ).length
  }
}
