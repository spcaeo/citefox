import {
  DEFAULT_ENGINES,
  ENGINE_LABEL,
  isAnswerEngineId,
  isCitationClass,
  isEngineAnswerStatus,
  isProviderChoice,
  normaliseEngines,
  type AnswerEngineId,
  type CitationClass,
  type EngineAnswerStatus,
  type EngineId,
  type ProviderChoice,
  type SearchProvider
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { recordTrackingChange } from './tracking-changes'
import { assertId, requireUtcTimestamp } from './values'

/**
 * Engine choices, answer-engine replies and what a check spent (project migration 045).
 * Google AI Overview samples stay in `serp_results` (check-records.ts).
 */

export interface EngineSettings {
  /** In display order. Never empty. */
  engines: EngineId[]
  provider: ProviderChoice
  /** Null when the project never saved a choice (the defaults). */
  updatedAt: string | null
}

/** No row: Google AI Overview only, provider `auto`, as every project before 045. */
export function readEngineSettings(db: SqliteDatabase): EngineSettings {
  const row = db
    .prepare<unknown[], { engines_json: string; provider: string; updated_at: string }>(
      `SELECT engines_json, provider, updated_at FROM engine_settings WHERE id = 1`
    )
    .get()
  if (row === undefined) return { engines: [...DEFAULT_ENGINES], provider: 'auto', updatedAt: null }
  const engines = enginesFromJson(row.engines_json)
  return {
    engines: engines.length === 0 ? [...DEFAULT_ENGINES] : engines,
    provider: isProviderChoice(row.provider) ? row.provider : 'auto',
    updatedAt: row.updated_at
  }
}

/** Saves the fields given; the others keep their stored (or default) value. */
export function saveEngineSettings(
  db: SqliteDatabase,
  input: { engines?: readonly EngineId[]; provider?: ProviderChoice },
  now: string
): EngineSettings {
  const current = readEngineSettings(db)
  const engines = input.engines === undefined ? current.engines : normaliseEngines(input.engines)
  if (engines.length === 0) throw new StorageError('Pick at least one engine')
  const provider = input.provider ?? current.provider
  db.prepare(
    `INSERT INTO engine_settings (id, engines_json, provider, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       engines_json = excluded.engines_json,
       provider = excluded.provider,
       updated_at = excluded.updated_at`
  ).run(JSON.stringify(engines), provider, requireUtcTimestamp(now))
  // An engine turned on or off changes what the charts count: mark it.
  for (const engine of engines) {
    if (!current.engines.includes(engine)) {
      recordTrackingChange(db, { at: now, kind: 'engine_on', detail: ENGINE_LABEL[engine] })
    }
  }
  for (const engine of current.engines) {
    if (!engines.includes(engine)) {
      recordTrackingChange(db, { at: now, kind: 'engine_off', detail: ENGINE_LABEL[engine] })
    }
  }
  return { engines, provider, updatedAt: now }
}

/** A page's or topic's own engines. Null: it follows the project. */
export function readPageEngines(db: SqliteDatabase, pageId: string): EngineId[] | null {
  const row = db
    .prepare<unknown[], { engines_json: string }>(
      `SELECT engines_json FROM page_engines WHERE page_id = ?`
    )
    .get(assertId(pageId))
  if (row === undefined) return null
  const engines = enginesFromJson(row.engines_json)
  return engines.length === 0 ? null : engines
}

/** Every page's own engines by page id. */
export function listPageEngines(db: SqliteDatabase): Map<string, EngineId[]> {
  const rows = db
    .prepare<unknown[], { page_id: string; engines_json: string }>(
      `SELECT page_id, engines_json FROM page_engines`
    )
    .all()
  const found = new Map<string, EngineId[]>()
  for (const row of rows) {
    const engines = enginesFromJson(row.engines_json)
    if (engines.length > 0) found.set(row.page_id, engines)
  }
  return found
}

/** Null (or an empty list) removes the page's own choice, so it follows the project again. */
export function savePageEngines(
  db: SqliteDatabase,
  pageId: string,
  engines: readonly EngineId[] | null,
  now: string
): void {
  const id = assertId(pageId)
  const list = engines === null ? [] : normaliseEngines(engines)
  if (list.length === 0) {
    db.prepare(`DELETE FROM page_engines WHERE page_id = ?`).run(id)
    return
  }
  db.prepare(
    `INSERT INTO page_engines (page_id, engines_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (page_id) DO UPDATE SET
       engines_json = excluded.engines_json,
       updated_at = excluded.updated_at`
  ).run(id, JSON.stringify(list), requireUtcTimestamp(now))
}

export interface NewEngineSource {
  id: string
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
}

export interface NewEngineAnswer {
  id: string
  runId: string
  promptId: string
  sampleNo: number
  engine: AnswerEngineId
  keyId: string | null
  status: EngineAnswerStatus
  citedUrl: string | null
  position: number | null
  named: boolean
  answerText: string | null
  answerMarkdown: string | null
  errorCode: string | null
  message: string | null
  searches: number
  credits: number
  costMicros: number
  rawJson: string | null
  checkedAt: string
  sources: readonly NewEngineSource[]
}

export function insertEngineAnswer(db: SqliteDatabase, answer: NewEngineAnswer): void {
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO engine_answers (
         id, run_id, prompt_id, sample_no, engine, provider, key_id, status, cited_url, position,
         named, answer_text, answer_markdown, error_code, message, searches, credits, cost_micros,
         raw_json, checked_at
       ) VALUES (?, ?, ?, ?, ?, 'cloro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      assertId(answer.id),
      assertId(answer.runId),
      assertId(answer.promptId),
      answer.sampleNo,
      answer.engine,
      answer.keyId,
      answer.status,
      answer.status === 'cited' ? answer.citedUrl : null,
      answer.position,
      answer.named ? 1 : 0,
      answer.answerText,
      answer.answerMarkdown,
      answer.errorCode,
      answer.message,
      answer.searches,
      answer.status === 'unavailable' ? 0 : answer.credits,
      answer.status === 'unavailable' ? 0 : answer.costMicros,
      answer.rawJson,
      requireUtcTimestamp(answer.checkedAt)
    )
    const insertSource = db.prepare(
      `INSERT INTO engine_sources (
         id, answer_id, position, url, normalized_url, domain, title, classification
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const source of answer.sources) {
      insertSource.run(
        assertId(source.id),
        answer.id,
        source.position,
        source.url,
        source.normalizedUrl,
        source.domain,
        source.title,
        source.classification
      )
    }
  })
  write()
}

export interface StoredEngineAnswer {
  id: string
  runId: string
  promptId: string
  sampleNo: number
  engine: AnswerEngineId
  keyId: string | null
  status: EngineAnswerStatus
  citedUrl: string | null
  position: number | null
  named: boolean
  answerText: string | null
  answerMarkdown: string | null
  errorCode: string | null
  message: string | null
  searches: number
  credits: number
  costMicros: number
  checkedAt: string
}

interface AnswerSql {
  id: string
  run_id: string
  prompt_id: string
  sample_no: number
  engine: string
  key_id: string | null
  status: string
  cited_url: string | null
  position: number | null
  named: number
  answer_text: string | null
  answer_markdown: string | null
  error_code: string | null
  message: string | null
  searches: number
  credits: number
  cost_micros: number
  checked_at: string
}

const ANSWER_COLUMNS = `engine_answers.id, engine_answers.run_id, engine_answers.prompt_id,
  engine_answers.sample_no, engine_answers.engine, engine_answers.key_id, engine_answers.status,
  engine_answers.cited_url, engine_answers.position, engine_answers.named,
  engine_answers.answer_text, engine_answers.answer_markdown, engine_answers.error_code,
  engine_answers.message, engine_answers.searches, engine_answers.credits,
  engine_answers.cost_micros, engine_answers.checked_at`

/** Answers of these runs, optionally one question, in run, question, engine, sample order. */
export function listEngineAnswers(
  db: SqliteDatabase,
  runIds: readonly string[],
  promptId: string | null = null
): StoredEngineAnswer[] {
  const out: StoredEngineAnswer[] = []
  for (let at = 0; at < runIds.length; at += CHUNK) {
    const ids = runIds.slice(at, at + CHUNK).map((id) => assertId(id))
    const args: unknown[] = [...ids]
    let sql = `SELECT ${ANSWER_COLUMNS} FROM engine_answers
      WHERE engine_answers.run_id IN (${ids.map(() => '?').join(', ')})`
    if (promptId !== null) {
      sql += ' AND engine_answers.prompt_id = ?'
      args.push(assertId(promptId))
    }
    sql +=
      ' ORDER BY engine_answers.run_id, engine_answers.prompt_id, engine_answers.engine, engine_answers.sample_no'
    for (const row of db.prepare<unknown[], AnswerSql>(sql).all(...args))
      out.push(answerFromSql(row))
  }
  return out
}

export interface StoredEngineSource {
  answerId: string
  position: number
  url: string
  domain: string
  title: string | null
  classification: CitationClass
}

/** Sources of these answers, in position order. */
export function listEngineSources(
  db: SqliteDatabase,
  answerIds: readonly string[]
): StoredEngineSource[] {
  const out: StoredEngineSource[] = []
  for (let at = 0; at < answerIds.length; at += CHUNK) {
    const ids = answerIds.slice(at, at + CHUNK)
    const rows = db
      .prepare<
        unknown[],
        {
          answer_id: string
          position: number
          url: string
          domain: string
          title: string | null
          classification: string
        }
      >(
        `SELECT answer_id, position, url, domain, title, classification FROM engine_sources
         WHERE answer_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY answer_id ASC, position ASC`
      )
      .all(...ids)
    for (const row of rows) {
      if (!isCitationClass(row.classification)) continue
      out.push({
        answerId: row.answer_id,
        position: row.position,
        url: row.url,
        domain: row.domain,
        title: row.title,
        classification: row.classification
      })
    }
  }
  return out
}

/** What a job spent: who ran its Google search, cloro credits and money. */
export function setStoredJobSpend(
  db: SqliteDatabase,
  jobId: string,
  spend: { provider: SearchProvider | null; credits: number; costMicros: number }
): void {
  db.prepare(
    `UPDATE check_jobs SET provider = ?, credits_used = ?, cost_micros = ? WHERE id = ?`
  ).run(
    spend.provider,
    Math.max(0, Math.round(spend.credits)),
    Math.max(0, Math.round(spend.costMicros)),
    assertId(jobId)
  )
}

/** Credits and money already stored on a job's captures and answers (a resume adds to them). */
export function sumStoredJobSpend(
  db: SqliteDatabase,
  jobId: string
): { credits: number; costMicros: number } {
  const row = db
    .prepare<unknown[], { credits: number; cost: number }>(
      `SELECT
         (SELECT COALESCE(SUM(s.credits), 0) FROM serp_results s JOIN runs r ON r.id = s.run_id
          WHERE r.job_id = ?)
         + (SELECT COALESCE(SUM(b.credits), 0) FROM brand_captures b JOIN runs r ON r.id = b.run_id
          WHERE r.job_id = ?)
         + (SELECT COALESCE(SUM(a.credits), 0) FROM engine_answers a JOIN runs r ON r.id = a.run_id
          WHERE r.job_id = ?) AS credits,
         (SELECT COALESCE(SUM(s.cost_micros), 0) FROM serp_results s JOIN runs r ON r.id = s.run_id
          WHERE r.job_id = ?)
         + (SELECT COALESCE(SUM(b.cost_micros), 0) FROM brand_captures b JOIN runs r ON r.id = b.run_id
          WHERE r.job_id = ?)
         + (SELECT COALESCE(SUM(a.cost_micros), 0) FROM engine_answers a JOIN runs r ON r.id = a.run_id
          WHERE r.job_id = ?) AS cost`
    )
    .get(...Array.from({ length: 6 }, () => assertId(jobId)))
  return { credits: row?.credits ?? 0, costMicros: row?.cost ?? 0 }
}

/** Sums what a job's captures and answers spent and stores it on the job. */
export function saveJobSpend(
  db: SqliteDatabase,
  jobId: string,
  provider: SearchProvider | null
): { credits: number; costMicros: number } {
  const spend = sumStoredJobSpend(db, jobId)
  setStoredJobSpend(db, jobId, { provider, ...spend })
  return spend
}

/** The engines a run checked, from `runs.engines_json`. */
export function runEngines(db: SqliteDatabase, runId: string): EngineId[] {
  const row = db
    .prepare<unknown[], { engines_json: string }>(`SELECT engines_json FROM runs WHERE id = ?`)
    .get(assertId(runId))
  return row === undefined ? [] : enginesFromJson(row.engines_json)
}

const CHUNK = 400

function enginesFromJson(encoded: string): EngineId[] {
  try {
    const parsed = JSON.parse(encoded) as unknown
    return Array.isArray(parsed) ? normaliseEngines(parsed) : []
  } catch {
    return []
  }
}

function answerFromSql(row: AnswerSql): StoredEngineAnswer {
  if (!isAnswerEngineId(row.engine) || !isEngineAnswerStatus(row.status)) {
    throw new StorageError('Invalid engine answer')
  }
  return {
    id: row.id,
    runId: row.run_id,
    promptId: row.prompt_id,
    sampleNo: row.sample_no,
    engine: row.engine,
    keyId: row.key_id,
    status: row.status,
    citedUrl: row.cited_url,
    position: row.position,
    named: row.named === 1,
    answerText: row.answer_text,
    answerMarkdown: row.answer_markdown,
    errorCode: row.error_code,
    message: row.message,
    searches: row.searches,
    credits: row.credits,
    costMicros: row.cost_micros,
    checkedAt: row.checked_at
  }
}
