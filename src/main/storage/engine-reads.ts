import {
  isAnswerEngineId,
  isCitationClass,
  isEngineAnswerStatus,
  isPromptCheckStatus,
  isSearchProvider,
  type AnswerEngineId,
  type CitationClass,
  type EngineAnswerStatus,
  type EngineId,
  type PromptCheckStatus,
  type SearchProvider
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { assertId } from './values'

/**
 * Per-engine reads for the engine views (project migration 045). Google AI Overview rows
 * come from `serp_results` (runs that searched Google), the other engines from
 * `engine_answers`. Only finished, not cancelled runs count, and only questions of each
 * page's active prompt set on pages that are not removed.
 */

/** One stored sample, the latest two checks per question × market × engine. */
export interface EngineStatusRow {
  engine: EngineId
  pageId: string
  marketId: string
  promptId: string
  runId: string
  startedAt: string
  checkedAt: string
  /** 1 for the latest check of this question × market × engine, 2 for the one before. */
  rank: 1 | 2
  /** Google rows: the sample status; other engines: null (see `status`). */
  googleStatus: PromptCheckStatus | null
  status: EngineAnswerStatus | null
  /** Answer engines: the own pages (target or another own page) among the sources. */
  ownUrls: readonly string[]
}

export interface EngineScope {
  /** Null: every page and topic. */
  pageIds: readonly string[] | null
  /** Null: every market. */
  marketId: string | null
}

const LIVE_RUN = `r.status != 'cancelled' AND r.finished_at IS NOT NULL
  AND r.page_id IN (SELECT id FROM pages WHERE status != 'removed')`

const ACTIVE_PROMPT = `IN (
  SELECT prompts.id FROM prompts
  JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
  WHERE prompt_sets.is_active = 1 AND prompts.enabled = 1
)`

function scopeSql(scope: EngineScope): { sql: string; args: unknown[] } {
  const clauses: string[] = []
  const args: unknown[] = []
  if (scope.pageIds !== null) {
    if (scope.pageIds.length === 0) clauses.push('0 = 1')
    else {
      clauses.push(`r.page_id IN (${scope.pageIds.map(() => '?').join(', ')})`)
      args.push(...scope.pageIds.map((id) => assertId(id)))
    }
  }
  if (scope.marketId !== null) {
    clauses.push('r.market_id = ?')
    args.push(assertId(scope.marketId))
  }
  return { sql: clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`, args }
}

/** The latest two checks of every question × market on every engine, each sample a row. */
export function listEngineStatusRows(db: SqliteDatabase, scope: EngineScope): EngineStatusRow[] {
  const where = scopeSql(scope)
  const google = db
    .prepare<
      unknown[],
      {
        page_id: string
        market_id: string
        prompt_id: string
        run_id: string
        started_at: string
        finished_at: string
        status: string
        rk: number
      }
    >(
      `SELECT page_id, market_id, prompt_id, run_id, started_at, finished_at, status, rk FROM (
         SELECT r.page_id, r.market_id, s.prompt_id, r.id AS run_id, r.started_at, r.finished_at,
                s.status,
                DENSE_RANK() OVER (
                  PARTITION BY r.page_id, r.market_id, s.prompt_id
                  ORDER BY r.started_at DESC, r.id DESC
                ) AS rk
         FROM serp_results s JOIN runs r ON r.id = s.run_id
         WHERE r.google_aio = 1 AND ${LIVE_RUN} AND s.prompt_id ${ACTIVE_PROMPT}${where.sql}
       ) WHERE rk <= 2`
    )
    .all(...where.args)
  const answers = db
    .prepare<
      unknown[],
      {
        engine: string
        page_id: string
        market_id: string
        prompt_id: string
        run_id: string
        started_at: string
        checked_at: string
        status: string
        own_urls: string | null
        rk: number
      }
    >(
      `SELECT engine, page_id, market_id, prompt_id, run_id, started_at, checked_at, status,
              own_urls, rk
       FROM (
         SELECT a.engine, r.page_id, r.market_id, a.prompt_id, r.id AS run_id, r.started_at,
                a.checked_at, a.status,
                (SELECT group_concat(es.url, char(10)) FROM engine_sources es
                  WHERE es.answer_id = a.id AND es.classification IN ('target', 'own')) AS own_urls,
                DENSE_RANK() OVER (
                  PARTITION BY a.engine, r.page_id, r.market_id, a.prompt_id
                  ORDER BY r.started_at DESC, r.id DESC
                ) AS rk
         FROM engine_answers a JOIN runs r ON r.id = a.run_id
         WHERE ${LIVE_RUN} AND a.prompt_id ${ACTIVE_PROMPT}${where.sql}
       ) WHERE rk <= 2`
    )
    .all(...where.args)
  const rows: EngineStatusRow[] = []
  for (const row of google) {
    if (!isPromptCheckStatus(row.status)) continue
    rows.push({
      engine: 'google_aio',
      pageId: row.page_id,
      marketId: row.market_id,
      promptId: row.prompt_id,
      runId: row.run_id,
      startedAt: row.started_at,
      checkedAt: row.finished_at,
      rank: row.rk === 1 ? 1 : 2,
      googleStatus: row.status,
      status: null,
      ownUrls: []
    })
  }
  for (const row of answers) {
    if (!isAnswerEngineId(row.engine) || !isEngineAnswerStatus(row.status)) continue
    rows.push({
      engine: row.engine,
      pageId: row.page_id,
      marketId: row.market_id,
      promptId: row.prompt_id,
      runId: row.run_id,
      startedAt: row.started_at,
      checkedAt: row.checked_at,
      rank: row.rk === 1 ? 1 : 2,
      googleStatus: null,
      status: row.status,
      ownUrls: row.own_urls === null ? [] : row.own_urls.split('\n')
    })
  }
  return rows
}

/** One answer-engine sample of a page's checks in one market, with its sources. */
export interface AnswerRunSample {
  runId: string
  promptId: string
  sampleNo: number
  status: EngineAnswerStatus
  named: boolean
  checkedAt: string
  sources: {
    url: string
    normalizedUrl: string
    domain: string
    position: number
    classification: CitationClass
  }[]
}

/**
 * Every stored answer of one engine on one page in one market, oldest check first, each
 * with its sources (a topic's results on that engine, audit #4). The caller picks the
 * runs that count (finished, running or stopped, as `readableRuns` lists them).
 */
export function listAnswerRunSamples(
  db: SqliteDatabase,
  scope: { pageId: string; marketId: string; engine: AnswerEngineId }
): AnswerRunSample[] {
  const args = [assertId(scope.pageId), assertId(scope.marketId), scope.engine]
  const answers = db
    .prepare<
      unknown[],
      {
        id: string
        run_id: string
        prompt_id: string
        sample_no: number
        status: string
        named: number
        checked_at: string
      }
    >(
      `SELECT a.id, a.run_id, a.prompt_id, a.sample_no, a.status, a.named, a.checked_at
       FROM engine_answers a JOIN runs r ON r.id = a.run_id
       WHERE r.page_id = ? AND r.market_id = ? AND a.engine = ?
       ORDER BY r.started_at ASC, r.id ASC, a.prompt_id ASC, a.sample_no ASC`
    )
    .all(...args)
  const sources = new Map<string, AnswerRunSample['sources']>()
  const sourceRows = db
    .prepare<
      unknown[],
      {
        answer_id: string
        url: string
        normalized_url: string
        domain: string
        position: number
        classification: string
      }
    >(
      `SELECT es.answer_id, es.url, es.normalized_url, es.domain, es.position, es.classification
       FROM engine_sources es
       JOIN engine_answers a ON a.id = es.answer_id
       JOIN runs r ON r.id = a.run_id
       WHERE r.page_id = ? AND r.market_id = ? AND a.engine = ?
       ORDER BY es.position ASC`
    )
    .all(...args)
  for (const row of sourceRows) {
    if (!isCitationClass(row.classification)) continue
    const list = sources.get(row.answer_id) ?? []
    list.push({
      url: row.url,
      normalizedUrl: row.normalized_url,
      domain: row.domain,
      position: row.position,
      classification: row.classification
    })
    sources.set(row.answer_id, list)
  }
  return answers.flatMap((row) =>
    isEngineAnswerStatus(row.status)
      ? [
          {
            runId: row.run_id,
            promptId: row.prompt_id,
            sampleNo: row.sample_no,
            status: row.status,
            named: row.named === 1,
            checkedAt: row.checked_at,
            sources: sources.get(row.id) ?? []
          }
        ]
      : []
  )
}

export interface LatestSample {
  id: string
  runId: string
  sampleNo: number
  checkedAt: string
  provider: SearchProvider | null
  googleStatus: PromptCheckStatus | null
  status: EngineAnswerStatus | null
  named: boolean
  citedUrl: string | null
  position: number | null
  text: string | null
  markdown: string | null
  message: string | null
  credits: number
  costMicros: number
}

export interface LatestSource {
  sampleId: string
  position: number
  url: string
  domain: string
  title: string | null
  classification: CitationClass
}

/** The samples of a question's latest Google AI Overview check in one market. */
export function latestGoogleSamples(
  db: SqliteDatabase,
  pageId: string,
  marketId: string,
  promptId: string
): { samples: LatestSample[]; sources: LatestSource[] } {
  const rows = db
    .prepare<
      unknown[],
      {
        id: string
        run_id: string
        sample_no: number
        finished_at: string
        provider: string
        status: string
        named: number | null
        cited_url: string | null
        position: number | null
        aio_text: string | null
        aio_markdown: string | null
        message: string | null
        credits: number
        cost_micros: number
      }
    >(
      `SELECT s.id, s.run_id, s.sample_no, r.finished_at, s.provider, s.status, s.named,
              s.cited_url, s.position, s.aio_text, s.aio_markdown, s.message, s.credits,
              s.cost_micros
       FROM serp_results s JOIN runs r ON r.id = s.run_id
       WHERE r.id = (
         SELECT r.id FROM serp_results s JOIN runs r ON r.id = s.run_id
         WHERE r.page_id = ? AND r.market_id = ? AND s.prompt_id = ? AND r.google_aio = 1
           AND r.status != 'cancelled' AND r.finished_at IS NOT NULL
         ORDER BY r.started_at DESC, r.id DESC LIMIT 1
       ) AND s.prompt_id = ?
       ORDER BY s.sample_no ASC`
    )
    .all(assertId(pageId), assertId(marketId), assertId(promptId), promptId)
  const samples: LatestSample[] = []
  for (const row of rows) {
    if (!isPromptCheckStatus(row.status)) continue
    samples.push({
      id: row.id,
      runId: row.run_id,
      sampleNo: row.sample_no,
      checkedAt: row.finished_at,
      provider: isSearchProvider(row.provider) ? row.provider : null,
      googleStatus: row.status,
      status: null,
      named: row.named === 1,
      citedUrl: row.cited_url,
      position: row.position,
      text: row.aio_text,
      markdown: row.aio_markdown,
      message: row.message,
      credits: row.credits,
      costMicros: row.cost_micros
    })
  }
  const sources = sourcesOf(
    db,
    `SELECT serp_result_id AS sample_id, position, url, domain, title, classification
     FROM aio_references WHERE serp_result_id IN`,
    samples.map((sample) => sample.id)
  )
  return { samples, sources }
}

/** The samples of a question's latest answer on each answer engine in one market. */
export function latestAnswerSamples(
  db: SqliteDatabase,
  pageId: string,
  marketId: string,
  promptId: string
): { samples: (LatestSample & { engine: EngineId })[]; sources: LatestSource[] } {
  const rows = db
    .prepare<
      unknown[],
      {
        id: string
        engine: string
        run_id: string
        sample_no: number
        checked_at: string
        status: string
        named: number
        cited_url: string | null
        position: number | null
        answer_text: string | null
        answer_markdown: string | null
        message: string | null
        credits: number
        cost_micros: number
        rk: number
      }
    >(
      `SELECT * FROM (
         SELECT a.id, a.engine, a.run_id, a.sample_no, a.checked_at, a.status, a.named,
                a.cited_url, a.position, a.answer_text, a.answer_markdown, a.message, a.credits,
                a.cost_micros,
                DENSE_RANK() OVER (PARTITION BY a.engine ORDER BY r.started_at DESC, r.id DESC) AS rk
         FROM engine_answers a JOIN runs r ON r.id = a.run_id
         WHERE r.page_id = ? AND r.market_id = ? AND a.prompt_id = ?
           AND r.status != 'cancelled' AND r.finished_at IS NOT NULL
       ) WHERE rk = 1
       ORDER BY engine ASC, sample_no ASC`
    )
    .all(assertId(pageId), assertId(marketId), assertId(promptId))
  const samples: (LatestSample & { engine: EngineId })[] = []
  for (const row of rows) {
    if (!isAnswerEngineId(row.engine) || !isEngineAnswerStatus(row.status)) continue
    samples.push({
      id: row.id,
      engine: row.engine,
      runId: row.run_id,
      sampleNo: row.sample_no,
      checkedAt: row.checked_at,
      provider: 'cloro',
      googleStatus: null,
      status: row.status,
      named: row.named === 1,
      citedUrl: row.cited_url,
      position: row.position,
      text: row.answer_text,
      markdown: row.answer_markdown,
      message: row.message,
      credits: row.credits,
      costMicros: row.cost_micros
    })
  }
  const sources = sourcesOf(
    db,
    `SELECT answer_id AS sample_id, position, url, domain, title, classification
     FROM engine_sources WHERE answer_id IN`,
    samples.map((sample) => sample.id)
  )
  return { samples, sources }
}

function sourcesOf(db: SqliteDatabase, select: string, ids: readonly string[]): LatestSource[] {
  if (ids.length === 0) return []
  return db
    .prepare<
      unknown[],
      {
        sample_id: string
        position: number
        url: string
        domain: string
        title: string | null
        classification: string
      }
    >(`${select} (${ids.map(() => '?').join(', ')}) ORDER BY position ASC`)
    .all(...ids)
    .flatMap((row) =>
      isCitationClass(row.classification)
        ? [
            {
              sampleId: row.sample_id,
              position: row.position,
              url: row.url,
              domain: row.domain,
              title: row.title,
              classification: row.classification
            }
          ]
        : []
    )
}

export interface StoredJobSpend {
  jobId: string
  startedAt: string
  finishedAt: string | null
  status: string
  provider: SearchProvider | null
  searches: number
  credits: number
  costMicros: number
  enginesJson: string | null
}

/** Jobs started between two instants (inclusive), newest first, with what each spent. */
export function listJobSpend(db: SqliteDatabase, from: string, to: string): StoredJobSpend[] {
  return db
    .prepare<
      unknown[],
      {
        id: string
        started_at: string
        finished_at: string | null
        status: string
        provider: string | null
        searches_used: number
        credits_used: number
        cost_micros: number
        engines_json: string | null
      }
    >(
      `SELECT j.id, j.started_at, j.finished_at, j.status, j.provider, j.searches_used,
              j.credits_used, j.cost_micros,
              (SELECT r.engines_json FROM runs r WHERE r.job_id = j.id
               ORDER BY r.started_at ASC LIMIT 1) AS engines_json
       FROM check_jobs j
       WHERE j.started_at >= ? AND j.started_at <= ?
       ORDER BY j.started_at DESC, j.rowid DESC`
    )
    .all(from, to)
    .map((row) => ({
      jobId: row.id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      provider: isSearchProvider(row.provider) ? row.provider : null,
      searches: row.searches_used,
      credits: row.credits_used,
      costMicros: row.cost_micros,
      enginesJson: row.engines_json
    }))
}

/** Searches, credits and money per engine of these jobs. Brand prompts count as Google. */
export function sumEngineSpend(
  db: SqliteDatabase,
  jobIds: readonly string[]
): { engine: EngineId; searches: number; credits: number; costMicros: number }[] {
  if (jobIds.length === 0) return []
  const out = new Map<EngineId, { searches: number; credits: number; costMicros: number }>()
  const add = (engine: EngineId, searches: number, credits: number, cost: number): void => {
    const current = out.get(engine) ?? { searches: 0, credits: 0, costMicros: 0 }
    out.set(engine, {
      searches: current.searches + searches,
      credits: current.credits + credits,
      costMicros: current.costMicros + cost
    })
  }
  for (let at = 0; at < jobIds.length; at += 400) {
    const ids = jobIds.slice(at, at + 400).map((id) => assertId(id))
    const marks = ids.map(() => '?').join(', ')
    const google = db
      .prepare<unknown[], { searches: number; credits: number; cost: number }>(
        `SELECT
           (SELECT COALESCE(SUM(s.searches), 0) FROM serp_results s JOIN runs r ON r.id = s.run_id
            WHERE r.job_id IN (${marks}))
           + (SELECT COALESCE(SUM(b.searches), 0) FROM brand_captures b JOIN runs r ON r.id = b.run_id
            WHERE r.job_id IN (${marks})) AS searches,
           (SELECT COALESCE(SUM(s.credits), 0) FROM serp_results s JOIN runs r ON r.id = s.run_id
            WHERE r.job_id IN (${marks}))
           + (SELECT COALESCE(SUM(b.credits), 0) FROM brand_captures b JOIN runs r ON r.id = b.run_id
            WHERE r.job_id IN (${marks})) AS credits,
           (SELECT COALESCE(SUM(s.cost_micros), 0) FROM serp_results s JOIN runs r ON r.id = s.run_id
            WHERE r.job_id IN (${marks}))
           + (SELECT COALESCE(SUM(b.cost_micros), 0) FROM brand_captures b JOIN runs r ON r.id = b.run_id
            WHERE r.job_id IN (${marks})) AS cost`
      )
      .get(...ids, ...ids, ...ids, ...ids, ...ids, ...ids)
    if (google !== undefined && (google.searches > 0 || google.credits > 0)) {
      add('google_aio', google.searches, google.credits, google.cost)
    }
    const answers = db
      .prepare<unknown[], { engine: string; searches: number; credits: number; cost: number }>(
        `SELECT a.engine, SUM(a.searches) AS searches, SUM(a.credits) AS credits,
                SUM(a.cost_micros) AS cost
         FROM engine_answers a JOIN runs r ON r.id = a.run_id
         WHERE r.job_id IN (${marks})
         GROUP BY a.engine`
      )
      .all(...ids)
    for (const row of answers) {
      if (isAnswerEngineId(row.engine)) add(row.engine, row.searches, row.credits, row.cost)
    }
  }
  return [...out.entries()].map(([engine, spend]) => ({ engine, ...spend }))
}
