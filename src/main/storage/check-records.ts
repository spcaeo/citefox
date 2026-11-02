import {
  isCheckErrorCode,
  isCheckJobStatus,
  isCheckPhase,
  isCheckRunKind,
  isCheckRunStatus,
  isCheckStepState,
  isCitationClass,
  isCitationSourceType,
  isIntentStage,
  isPromptCheckStatus,
  isPromptSource
} from '@shared/domain'
import type {
  CheckErrorCode,
  EngineId,
  SearchProvider,
  CheckJobStatus,
  CheckPhase,
  CheckRunKind,
  CheckRunStatus,
  CheckStepState,
  CitationClass,
  CitationSourceType,
  IntentStage,
  PromptCheckStatus,
  PromptSource
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, requireUtcTimestamp } from './values'

/**
 * Check jobs, runs, captures, and the reads export uses.
 * The project file is already one project. `projectId` is still on the filter
 * so export and the results handlers pass the same arguments, and it is copied
 * onto every returned row.
 */

export interface CheckReadFilter {
  projectId: string
  /** Null means every page in the file. */
  pageIds: readonly string[] | null
  /** Null means every market. */
  marketId: string | null
  /** Inclusive ISO-8601 bound on `runs.finished_at`. Null means no lower bound. */
  from: string | null
  /** Inclusive ISO-8601 bound on `runs.finished_at`. Null means no upper bound. */
  to: string | null
  /**
   * Null skips runs whose status is `cancelled`. Running and failed runs still match.
   * A specific id returns that run even when it was cancelled.
   */
  runId: string | null
  /** Null means every prompt. Ignored by {@link listStoredCheckRuns}. */
  promptId: string | null
  /**
   * True also reads runs that did not search Google AI Overview (other engines only).
   * By default they are left out, so every Google view reads Google checks alone.
   */
  anyEngine?: boolean
}

export interface StoredCheckRun {
  projectId: string
  id: string
  jobId: string
  pageId: string
  promptSetId: string
  snapshotId: string
  marketId: string
  startedAt: string
  finishedAt: string | null
  kind: CheckRunKind
  partial: boolean
  status: CheckRunStatus
  samples: number
  contentHash: string
}

export interface StoredSerpResult {
  projectId: string
  id: string
  runId: string
  pageId: string
  marketId: string
  promptId: string
  sampleNo: number
  keyId: string | null
  hasAio: boolean
  neededFollowup: boolean
  searches: number
  status: PromptCheckStatus
  named: boolean | null
  citedUrl: string | null
  position: number | null
  aioText: string | null
  /** cloro's overview as markdown. Null for SerpApi and older checks. */
  aioMarkdown: string | null
  errorCode: CheckErrorCode | null
  message: string | null
  nextStep: string | null
  rawSearchJson: string | null
  rawAioJson: string | null
}

export interface StoredAioReference {
  projectId: string
  id: string
  serpResultId: string
  runId: string
  pageId: string
  marketId: string
  promptId: string
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
  untracked: boolean
  sourceType: CitationSourceType
}

export interface NewCheckJob {
  id: string
  startedAt: string
  status: 'running' | 'error'
  pageIds: readonly string[]
  marketIds: readonly string[] | null
  promptIds: readonly string[] | null
  reason: 'manual' | 'scheduled' | 'follow_up' | 'catch_up'
  message: string | null
  nextStep: string | null
}

export interface NewCheckRun {
  id: string
  jobId: string
  pageId: string
  promptSetId: string
  snapshotId: string
  marketId: string
  startedAt: string
  kind: CheckRunKind
  partial: boolean
  samples: number
  contentHash: string
  /** The engines this run checks. Omitted: Google AI Overview only. */
  engines?: readonly EngineId[]
}

export interface NewCheckStep {
  jobId: string
  pageId: string
  marketId: string
  promptId: string
  sampleNo: number
  phase: CheckPhase
  promptPosition: number
  label: string
  promptText: string
  state: CheckStepState
  detail: string
  errorCode: CheckErrorCode | null
  error: string | null
  retrySearches: number
  updatedAt: string
}

export interface NewSerpResult {
  id: string
  runId: string
  promptId: string
  sampleNo: number
  keyId: string | null
  hasAio: boolean
  neededFollowup: boolean
  searches: number
  status: PromptCheckStatus
  named: boolean | null
  citedUrl: string | null
  position: number | null
  aioText: string | null
  errorCode: CheckErrorCode | null
  message: string | null
  nextStep: string | null
  rawSearchJson: string | null
  rawAioJson: string | null
  /**
   * The search's organic top 10 and "People also ask" as JSON (migration 044).
   * Omitted or null: read from `rawSearchJson` the first time a screen needs it.
   */
  googleJson?: string | null
  /** Who ran the search. Omitted: SerpApi. */
  provider?: SearchProvider
  /** cloro credits charged. Omitted: 0. */
  credits?: number
  /** USD × 1,000,000 at the plan in effect. Omitted: 0. */
  costMicros?: number
  /** cloro's overview as markdown. */
  aioMarkdown?: string | null
  references: readonly NewAioReference[]
}

export interface NewAioReference {
  id: string
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
  untracked: boolean
  sourceType: CitationSourceType
}

export interface StoredMarketPrompt {
  id: string
  position: number
  label: string
  source: PromptSource
  intentStage: IntentStage
  enabled: boolean
  text: string
}

export interface StoredPromptSetFacts {
  id: string
  pageId: string
  version: number
  savedAt: string
}

export interface StoredSnapshotFacts {
  id: string
  contentHash: string
  faqs: number
  words: number
  h2: number
  h3: number
}

export interface StoredCheckStep {
  jobId: string
  pageId: string
  marketId: string
  promptId: string
  sampleNo: number
  phase: CheckPhase
  promptPosition: number
  label: string
  promptText: string
  state: CheckStepState
  detail: string
  errorCode: CheckErrorCode | null
  error: string | null
  retrySearches: number
  updatedAt: string
}

/** Runs matching the filter, oldest `started_at` first. */
export function listStoredCheckRuns(db: SqliteDatabase, filter: CheckReadFilter): StoredCheckRun[] {
  const where = runWhere(filter, false)
  const rows = db
    .prepare<unknown[], RunSql>(
      `SELECT id, job_id, page_id, prompt_set_id, snapshot_id, market_id, started_at, finished_at,
              kind, partial, status, samples, content_hash
       FROM runs
       WHERE ${where.sql}
       ORDER BY started_at ASC, rowid ASC`
    )
    .all(...where.args)
  return rows.map((row) => runFromSql(filter.projectId, row))
}

/** Captures for runs matching the filter, in run, prompt, and sample order. */
export function listStoredSerpResults(
  db: SqliteDatabase,
  filter: CheckReadFilter
): StoredSerpResult[] {
  const where = runWhere(filter, true)
  const rows = db
    .prepare<unknown[], SerpSql>(
      `SELECT serp_results.id, serp_results.run_id, runs.page_id, runs.market_id,
              serp_results.prompt_id, serp_results.sample_no, serp_results.key_id,
              serp_results.has_aio, serp_results.needed_followup, serp_results.searches,
              serp_results.status, serp_results.named, serp_results.cited_url, serp_results.position,
              serp_results.aio_text, serp_results.error_code, serp_results.message, serp_results.next_step,
              serp_results.raw_search_json, serp_results.raw_aio_json, serp_results.aio_markdown
       FROM serp_results
       JOIN runs ON runs.id = serp_results.run_id
       WHERE ${where.sql}
       ORDER BY runs.started_at ASC, serp_results.prompt_id ASC, serp_results.sample_no ASC`
    )
    .all(...where.args)
  return rows.map((row) => serpFromSql(filter.projectId, row))
}

/** References for captures matching the filter, in position order. */
export function listStoredAioReferences(
  db: SqliteDatabase,
  filter: CheckReadFilter
): StoredAioReference[] {
  const where = runWhere(filter, true)
  const rows = db
    .prepare<unknown[], RefSql>(
      `SELECT aio_references.id, aio_references.serp_result_id, serp_results.run_id, runs.page_id,
              runs.market_id, serp_results.prompt_id, aio_references.position, aio_references.url,
              aio_references.normalized_url, aio_references.domain, aio_references.title,
              aio_references.classification, aio_references.untracked, aio_references.source_type
       FROM aio_references
       JOIN serp_results ON serp_results.id = aio_references.serp_result_id
       JOIN runs ON runs.id = serp_results.run_id
       WHERE ${where.sql}
       ORDER BY runs.started_at ASC, serp_results.prompt_id ASC, serp_results.sample_no ASC,
                aio_references.position ASC`
    )
    .all(...where.args)
  return rows.map((row) => refFromSql(filter.projectId, row))
}

export function insertStoredCheckJob(db: SqliteDatabase, job: NewCheckJob): void {
  db.prepare(
    `INSERT INTO check_jobs (
       id, started_at, finished_at, status, page_ids, market_ids, prompt_ids, reason,
       searches_used, message, next_step
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    assertId(job.id),
    requireUtcTimestamp(job.startedAt),
    job.status === 'error' ? requireUtcTimestamp(job.startedAt) : null,
    job.status,
    JSON.stringify(job.pageIds),
    job.marketIds === null ? null : JSON.stringify(job.marketIds),
    job.promptIds === null ? null : JSON.stringify(job.promptIds),
    job.reason,
    job.message,
    job.nextStep
  )
}

export function finishStoredCheckJob(
  db: SqliteDatabase,
  jobId: string,
  finishedAt: string,
  status: 'finished' | 'cancelled' | 'error',
  searchesUsed: number,
  message: string | null,
  nextStep: string | null
): void {
  db.prepare(
    `UPDATE check_jobs
     SET finished_at = ?, status = ?, searches_used = ?, message = ?, next_step = ?
     WHERE id = ?`
  ).run(
    requireUtcTimestamp(finishedAt),
    status,
    searchesUsed,
    status === 'error' ? message : null,
    status === 'error' ? nextStep : null,
    assertId(jobId)
  )
}

export interface StoredCheckJob {
  id: string
  startedAt: string
  finishedAt: string | null
  status: CheckJobStatus
  pageIds: readonly string[]
  marketIds: readonly string[] | null
  promptIds: readonly string[] | null
  reason: 'manual' | 'scheduled' | 'follow_up' | 'catch_up'
  searchesUsed: number
  message: string | null
  nextStep: string | null
}

/** Jobs still `running` after a quit or crash. Oldest first. Cancelled jobs are not resumed. */
export function listStoredRunningCheckJobs(db: SqliteDatabase): StoredCheckJob[] {
  const rows = db
    .prepare<unknown[], JobSql>(
      `SELECT id, started_at, finished_at, status, page_ids, market_ids, prompt_ids, reason,
              searches_used, message, next_step
       FROM check_jobs WHERE status = 'running' ORDER BY started_at ASC`
    )
    .all()
  return rows.map((row) => jobFromSql(row))
}

export function readStoredCheckJob(db: SqliteDatabase, jobId: string): StoredCheckJob | null {
  const row = db
    .prepare<unknown[], JobSql>(
      `SELECT id, started_at, finished_at, status, page_ids, market_ids, prompt_ids, reason,
              searches_used, message, next_step
       FROM check_jobs WHERE id = ?`
    )
    .get(assertId(jobId))
  return row === undefined ? null : jobFromSql(row)
}

/**
 * Searches already stored on this job's samples, brand prompt captures included
 * (FR-16.1). Resume must not count them again.
 */
export function sumStoredJobSearches(db: SqliteDatabase, jobId: string): number {
  const row = db
    .prepare<unknown[], { searches: number }>(
      `SELECT
         (SELECT COALESCE(SUM(serp_results.searches), 0)
          FROM serp_results JOIN runs ON runs.id = serp_results.run_id
          WHERE runs.job_id = ?)
         +
         (SELECT COALESCE(SUM(brand_captures.searches), 0)
          FROM brand_captures JOIN runs ON runs.id = brand_captures.run_id
          WHERE runs.job_id = ?)
         +
         (SELECT COALESCE(SUM(engine_answers.searches), 0)
          FROM engine_answers JOIN runs ON runs.id = engine_answers.run_id
          WHERE runs.job_id = ?) AS searches`
    )
    .get(assertId(jobId), jobId, jobId)
  return row?.searches ?? 0
}

export function listStoredRunsForJob(
  db: SqliteDatabase,
  projectId: string,
  jobId: string
): StoredCheckRun[] {
  assertId(projectId)
  const rows = db
    .prepare<unknown[], RunSql>(
      `SELECT id, job_id, page_id, prompt_set_id, snapshot_id, market_id, started_at, finished_at,
              kind, partial, status, samples, content_hash
       FROM runs WHERE job_id = ? ORDER BY started_at ASC`
    )
    .all(assertId(jobId))
  return rows.map((row) => runFromSql(projectId, row))
}

/** Leaves finished runs alone. A cancelled run is not a baseline and does not move a score. */
export function cancelStoredRunningRuns(
  db: SqliteDatabase,
  jobId: string,
  finishedAt: string
): void {
  db.prepare(
    `UPDATE runs SET finished_at = ?, status = 'cancelled' WHERE job_id = ? AND status = 'running'`
  ).run(requireUtcTimestamp(finishedAt), assertId(jobId))
}

export function insertStoredRun(db: SqliteDatabase, run: NewCheckRun): void {
  const engines = run.engines ?? ['google_aio']
  db.prepare(
    `INSERT INTO runs (
       id, job_id, page_id, prompt_set_id, snapshot_id, market_id, started_at, finished_at,
       kind, partial, status, samples, content_hash, engines_json, google_aio
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'running', ?, ?, ?, ?)`
  ).run(
    assertId(run.id),
    assertId(run.jobId),
    assertId(run.pageId),
    assertId(run.promptSetId),
    assertId(run.snapshotId),
    assertId(run.marketId),
    requireUtcTimestamp(run.startedAt),
    run.kind,
    run.partial ? 1 : 0,
    run.samples,
    run.contentHash,
    JSON.stringify(engines),
    engines.includes('google_aio') ? 1 : 0
  )
}

export function finishStoredRun(
  db: SqliteDatabase,
  runId: string,
  finishedAt: string,
  status: CheckRunStatus
): void {
  db.prepare(`UPDATE runs SET finished_at = ?, status = ? WHERE id = ?`).run(
    requireUtcTimestamp(finishedAt),
    status,
    assertId(runId)
  )
}

export function insertStoredCheckStep(db: SqliteDatabase, step: NewCheckStep): void {
  db.prepare(
    `INSERT INTO check_steps (
       job_id, page_id, market_id, prompt_id, sample_no, phase, prompt_position, label, prompt_text,
       state, detail, error_code, error, retry_searches, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (job_id, page_id, market_id, prompt_id, sample_no, phase) DO UPDATE SET
       state = excluded.state,
       detail = excluded.detail,
       error_code = excluded.error_code,
       error = excluded.error,
       retry_searches = excluded.retry_searches,
       updated_at = excluded.updated_at`
  ).run(
    assertId(step.jobId),
    assertId(step.pageId),
    assertId(step.marketId),
    assertId(step.promptId),
    step.sampleNo,
    step.phase,
    step.promptPosition,
    step.label,
    step.promptText,
    step.state,
    step.detail,
    step.errorCode,
    step.error,
    step.retrySearches,
    requireUtcTimestamp(step.updatedAt)
  )
}

export function listStoredCheckSteps(db: SqliteDatabase, jobId: string): StoredCheckStep[] {
  const rows = db
    .prepare<unknown[], StepSql>(
      `SELECT job_id, page_id, market_id, prompt_id, sample_no, phase, prompt_position, label,
              prompt_text, state, detail, error_code, error, retry_searches, updated_at
       FROM check_steps WHERE job_id = ?
       ORDER BY prompt_position ASC, sample_no ASC, phase ASC`
    )
    .all(assertId(jobId))
  return rows.map((row) => {
    if (!isCheckPhase(row.phase) || !isCheckStepState(row.state)) {
      throw new StorageError('Invalid check step')
    }
    return {
      jobId: row.job_id,
      pageId: row.page_id,
      marketId: row.market_id,
      promptId: row.prompt_id,
      sampleNo: row.sample_no,
      phase: row.phase,
      promptPosition: row.prompt_position,
      label: row.label,
      promptText: row.prompt_text,
      state: row.state,
      detail: row.detail,
      errorCode: row.error_code === null ? null : requireErrorCode(row.error_code),
      error: row.error,
      retrySearches: row.retry_searches,
      updatedAt: row.updated_at
    }
  })
}

export function insertStoredSerpResult(db: SqliteDatabase, result: NewSerpResult): void {
  // Unread extras are the column's default (null), so it is only named when read.
  const google = result.googleJson ?? null
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO serp_results (
         id, run_id, prompt_id, sample_no, key_id, has_aio, needed_followup, searches, status, named,
         cited_url, position, aio_text, error_code, message, next_step, raw_search_json, raw_aio_json,
         provider, credits, cost_micros, aio_markdown${google === null ? '' : ', google_json'}
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${google === null ? '' : ', ?'})`
    ).run(
      assertId(result.id),
      assertId(result.runId),
      assertId(result.promptId),
      result.sampleNo,
      result.keyId,
      result.hasAio ? 1 : 0,
      result.neededFollowup ? 1 : 0,
      result.searches,
      result.status,
      result.named === null ? null : result.named ? 1 : 0,
      result.citedUrl,
      result.position,
      result.aioText,
      result.errorCode,
      result.message,
      result.nextStep,
      result.rawSearchJson,
      result.rawAioJson,
      result.provider ?? 'serpapi',
      result.credits ?? 0,
      result.costMicros ?? 0,
      result.aioMarkdown ?? null,
      ...(google === null ? [] : [google])
    )
    const insertRef = db.prepare(
      `INSERT INTO aio_references (
         id, serp_result_id, position, url, normalized_url, domain, title, classification, untracked, source_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const reference of result.references) {
      insertRef.run(
        assertId(reference.id),
        assertId(result.id),
        reference.position,
        reference.url,
        reference.normalizedUrl,
        reference.domain,
        reference.title,
        reference.classification,
        reference.untracked ? 1 : 0,
        reference.sourceType
      )
    }
  })
  write()
}

export function readStoredPromptSet(
  db: SqliteDatabase,
  promptSetId: string
): StoredPromptSetFacts | null {
  const row = db
    .prepare<unknown[], { id: string; page_id: string; version: number; saved_at: string }>(
      `SELECT id, page_id, version, saved_at FROM prompt_sets WHERE id = ?`
    )
    .get(assertId(promptSetId))
  if (row === undefined) return null
  return { id: row.id, pageId: row.page_id, version: row.version, savedAt: row.saved_at }
}

export function listStoredMarketPrompts(
  db: SqliteDatabase,
  promptSetId: string,
  marketId: string
): StoredMarketPrompt[] {
  const rows = db
    .prepare<unknown[], PromptSql>(
      `SELECT prompts.id, prompts.position, prompts.label, prompts.source, prompts.intent_stage,
              prompts.enabled,
              COALESCE(
                wanted.text,
                (SELECT text FROM prompt_variants WHERE prompt_id = prompts.id ORDER BY market_id ASC LIMIT 1)
              ) AS text
       FROM prompts
       LEFT JOIN prompt_variants AS wanted
         ON wanted.prompt_id = prompts.id AND wanted.market_id = ?
       WHERE prompts.prompt_set_id = ?
       ORDER BY prompts.position ASC`
    )
    .all(assertId(marketId), assertId(promptSetId))
  return rows.flatMap((row) => {
    if (!isPromptSource(row.source) || !isIntentStage(row.intent_stage) || row.text === null) {
      return []
    }
    return [
      {
        id: row.id,
        position: row.position,
        label: row.label,
        source: row.source,
        intentStage: row.intent_stage,
        enabled: row.enabled === 1,
        text: row.text
      }
    ]
  })
}

export function readStoredSnapshotFacts(
  db: SqliteDatabase,
  snapshotId: string
): StoredSnapshotFacts | null {
  const row = db
    .prepare<
      unknown[],
      {
        id: string
        content_hash: string
        faqs_json: string
        word_count: number
        h2_count: number
        h3_count: number
      }
    >(
      `SELECT id, content_hash, faqs_json, word_count, h2_count, h3_count FROM snapshots WHERE id = ?`
    )
    .get(assertId(snapshotId))
  if (row === undefined) return null
  const faqs = JSON.parse(row.faqs_json) as unknown
  return {
    id: row.id,
    contentHash: row.content_hash,
    faqs: Array.isArray(faqs) ? faqs.length : 0,
    words: row.word_count,
    h2: row.h2_count,
    h3: row.h3_count
  }
}

function runWhere(filter: CheckReadFilter, joined: boolean): { sql: string; args: unknown[] } {
  assertId(filter.projectId)
  const run = joined ? 'runs.' : ''
  const clauses: string[] = []
  const args: unknown[] = []
  if (filter.pageIds !== null) {
    if (filter.pageIds.length === 0) clauses.push('0 = 1')
    else {
      clauses.push(`${run}page_id IN (${filter.pageIds.map(() => '?').join(', ')})`)
      args.push(...filter.pageIds.map((id) => assertId(id)))
    }
  }
  if (filter.marketId !== null) {
    clauses.push(`${run}market_id = ?`)
    args.push(assertId(filter.marketId))
  }
  if (filter.runId !== null) {
    clauses.push(`${run}id = ?`)
    args.push(assertId(filter.runId))
  } else {
    clauses.push(`${run}status != 'cancelled'`)
    if (filter.anyEngine !== true) clauses.push(`${run}google_aio = 1`)
  }
  if (filter.from !== null) {
    clauses.push(`${run}finished_at IS NOT NULL AND ${run}finished_at >= ?`)
    args.push(requireUtcTimestamp(filter.from))
  }
  if (filter.to !== null) {
    clauses.push(`${run}finished_at IS NOT NULL AND ${run}finished_at <= ?`)
    args.push(requireUtcTimestamp(filter.to))
  }
  if (joined && filter.promptId !== null) {
    clauses.push('serp_results.prompt_id = ?')
    args.push(assertId(filter.promptId))
  }
  return { sql: clauses.length === 0 ? '1 = 1' : clauses.join(' AND '), args }
}

function runFromSql(projectId: string, row: RunSql): StoredCheckRun {
  if (!isCheckRunKind(row.kind) || !isCheckRunStatus(row.status)) {
    throw new StorageError('Invalid check run')
  }
  return {
    projectId,
    id: row.id,
    jobId: row.job_id,
    pageId: row.page_id,
    promptSetId: row.prompt_set_id,
    snapshotId: row.snapshot_id,
    marketId: row.market_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    kind: row.kind,
    partial: row.partial === 1,
    status: row.status,
    samples: row.samples,
    contentHash: row.content_hash
  }
}

function serpFromSql(projectId: string, row: SerpSql): StoredSerpResult {
  if (!isPromptCheckStatus(row.status)) throw new StorageError('Invalid prompt status')
  return {
    projectId,
    id: row.id,
    runId: row.run_id,
    pageId: row.page_id,
    marketId: row.market_id,
    promptId: row.prompt_id,
    sampleNo: row.sample_no,
    keyId: row.key_id,
    hasAio: row.has_aio === 1,
    neededFollowup: row.needed_followup === 1,
    searches: row.searches,
    status: row.status,
    named: row.named === null ? null : row.named === 1,
    citedUrl: row.cited_url,
    position: row.position,
    aioText: row.aio_text,
    aioMarkdown: row.aio_markdown,
    errorCode: row.error_code === null ? null : requireErrorCode(row.error_code),
    message: row.message,
    nextStep: row.next_step,
    rawSearchJson: row.raw_search_json,
    rawAioJson: row.raw_aio_json
  }
}

function refFromSql(projectId: string, row: RefSql): StoredAioReference {
  if (!isCitationClass(row.classification) || !isCitationSourceType(row.source_type)) {
    throw new StorageError('Invalid reference')
  }
  return {
    projectId,
    id: row.id,
    serpResultId: row.serp_result_id,
    runId: row.run_id,
    pageId: row.page_id,
    marketId: row.market_id,
    promptId: row.prompt_id,
    position: row.position,
    url: row.url,
    normalizedUrl: row.normalized_url,
    domain: row.domain,
    title: row.title,
    classification: row.classification,
    untracked: row.untracked === 1,
    sourceType: row.source_type
  }
}

function requireErrorCode(value: string): CheckErrorCode {
  if (!isCheckErrorCode(value)) throw new StorageError('Invalid check error')
  return value
}

interface JobSql {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  page_ids: string
  market_ids: string | null
  prompt_ids: string | null
  reason: string
  searches_used: number
  message: string | null
  next_step: string | null
}

function jobFromSql(row: JobSql): StoredCheckJob {
  if (!isCheckJobStatus(row.status)) throw new StorageError('Invalid check job')
  const reason = checkJobReason(row.reason)
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    pageIds: readJsonIds(row.page_ids, false),
    marketIds: row.market_ids === null ? null : readJsonIds(row.market_ids, true),
    promptIds: row.prompt_ids === null ? null : readJsonIds(row.prompt_ids, true),
    reason,
    searchesUsed: row.searches_used,
    message: row.message,
    nextStep: row.next_step
  }
}

function checkJobReason(value: string): StoredCheckJob['reason'] {
  if (
    value === 'manual' ||
    value === 'scheduled' ||
    value === 'follow_up' ||
    value === 'catch_up'
  ) {
    return value
  }
  throw new StorageError('Invalid check job')
}

function readJsonIds(value: string, allowEmpty: boolean): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new StorageError('Invalid check job')
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new StorageError('Invalid check job')
  }
  if (!allowEmpty && parsed.length === 0) throw new StorageError('Invalid check job')
  return parsed
}

interface RunSql {
  id: string
  job_id: string
  page_id: string
  prompt_set_id: string
  snapshot_id: string
  market_id: string
  started_at: string
  finished_at: string | null
  kind: string
  partial: number
  status: string
  samples: number
  content_hash: string
}

interface SerpSql {
  id: string
  run_id: string
  page_id: string
  market_id: string
  prompt_id: string
  sample_no: number
  key_id: string | null
  has_aio: number
  needed_followup: number
  searches: number
  status: string
  named: number | null
  cited_url: string | null
  position: number | null
  aio_text: string | null
  error_code: string | null
  message: string | null
  next_step: string | null
  raw_search_json: string | null
  raw_aio_json: string | null
  aio_markdown: string | null
}

interface RefSql {
  id: string
  serp_result_id: string
  run_id: string
  page_id: string
  market_id: string
  prompt_id: string
  position: number
  url: string
  normalized_url: string
  domain: string
  title: string | null
  classification: string
  untracked: number
  source_type: string
}

interface PromptSql {
  id: string
  position: number
  label: string
  source: string
  intent_stage: string
  enabled: number
  text: string | null
}

interface StepSql {
  job_id: string
  page_id: string
  market_id: string
  prompt_id: string
  sample_no: number
  phase: string
  prompt_position: number
  label: string
  prompt_text: string
  state: string
  detail: string
  error_code: string | null
  error: string | null
  retry_searches: number
  updated_at: string
}
