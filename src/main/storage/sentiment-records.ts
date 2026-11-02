import {
  isBrandPromptKind,
  isCitationClass,
  isClaimTone,
  type BrandPromptKind,
  type ClaimTone,
  type FactProblem,
  type SentimentReference,
  type SentimentSource
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, readJson, requireContentHash, requireJsonDocument } from './values'

/**
 * `brand_captures`, `sentiment_reads`, and `claims` in a project database
 * (FR-16.1, FR-16.2). Brand captures never enter `serp_results`, so visibility
 * counts cannot see them.
 */

export interface NewBrandCapture {
  id: string
  runId: string
  brandPromptId: string
  promptText: string
  keyId: string | null
  hasAio: boolean
  neededFollowup: boolean
  searches: number
  status: 'aio' | 'no_aio' | 'error'
  aioText: string | null
  references: readonly SentimentReference[]
  errorCode: string | null
  message: string | null
  rawSearchJson: string | null
  rawAioJson: string | null
  capturedAt: string
  /** cloro credits of the search. Omitted: 0 (SerpApi). */
  credits?: number
  /** USD × 1,000,000 at the key's plan. Omitted: 0. */
  costMicros?: number
}

export interface StoredBrandCapture extends Omit<NewBrandCapture, 'rawSearchJson' | 'rawAioJson'> {
  kind: BrandPromptKind
  language: string
}

export function insertBrandCapture(db: SqliteDatabase, capture: NewBrandCapture): void {
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO brand_captures (
             id, run_id, brand_prompt_id, prompt_text, key_id, has_aio, needed_followup, searches,
             status, aio_text, references_json, error_code, message, raw_search_json, raw_aio_json,
             captured_at, credits, cost_micros
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          assertId(capture.id),
          assertId(capture.runId),
          assertId(capture.brandPromptId),
          capture.promptText,
          capture.keyId,
          capture.hasAio ? 1 : 0,
          capture.neededFollowup ? 1 : 0,
          capture.searches,
          capture.status,
          capture.aioText,
          JSON.stringify(capture.references),
          capture.errorCode,
          capture.message,
          capture.rawSearchJson,
          capture.rawAioJson,
          capture.capturedAt,
          capture.credits ?? 0,
          capture.costMicros ?? 0
        ),
    'Could not save the brand prompt capture'
  )
}

interface CaptureSql {
  id: string
  run_id: string
  brand_prompt_id: string
  prompt_text: string
  key_id: string | null
  has_aio: number
  needed_followup: number
  searches: number
  status: string
  aio_text: string | null
  references_json: string
  error_code: string | null
  message: string | null
  captured_at: string
  kind: string
  language: string
}

/** Brand captures for these runs, in run then prompt order. */
export function listBrandCaptures(
  db: SqliteDatabase,
  runIds: readonly string[]
): StoredBrandCapture[] {
  if (runIds.length === 0) return []
  const marks = runIds.map(() => '?').join(', ')
  return db
    .prepare<unknown[], CaptureSql>(
      `SELECT c.id, c.run_id, c.brand_prompt_id, c.prompt_text, c.key_id, c.has_aio,
              c.needed_followup, c.searches, c.status, c.aio_text, c.references_json,
              c.error_code, c.message, c.captured_at, p.kind, p.language
       FROM brand_captures c
       JOIN brand_prompts p ON p.id = c.brand_prompt_id
       WHERE c.run_id IN (${marks})
       ORDER BY c.run_id ASC, p.language ASC, p.position ASC`
    )
    .all(...runIds.map((id) => assertId(id)))
    .map(captureFromSql)
}

/** Searches the brand captures of a job spent. Resume adds these to the job total. */
export function sumBrandJobSearches(db: SqliteDatabase, jobId: string): number {
  const row = db
    .prepare<unknown[], { searches: number }>(
      `SELECT COALESCE(SUM(brand_captures.searches), 0) AS searches
       FROM brand_captures
       JOIN runs ON runs.id = brand_captures.run_id
       WHERE runs.job_id = ?`
    )
    .get(assertId(jobId))
  return row?.searches ?? 0
}

export interface NewSentimentClaim {
  id: string
  brand: string
  isOwn: boolean
  theme: string
  attribute: string
  tone: ClaimTone
  sentence: string
  url: string | null
  factProblem: FactProblem | null
}

export interface NewSentimentRead {
  id: string
  runId: string
  marketId: string
  source: SentimentSource
  captureId: string
  promptId: string
  aioHash: string
  inputHash: string
  templateId: string
  templateHash: string
  generationId: string | null
  readAt: string
  ok: boolean
  error: string | null
  brandsNamed: readonly string[]
  reason: string | null
}

export type StoredSentimentRead = NewSentimentRead

export interface StoredSentimentClaim extends NewSentimentClaim {
  readId: string
  runId: string
  captureId: string
  source: SentimentSource
  position: number
}

/**
 * Replaces the reading of one overview in a run, with its claims, in one
 * transaction. A re-read keeps a single row per run and capture.
 */
export function replaceSentimentRead(
  db: SqliteDatabase,
  read: NewSentimentRead,
  claims: readonly NewSentimentClaim[]
): void {
  const write = db.transaction(() => {
    const previous = db
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM sentiment_reads WHERE run_id = ? AND capture_id = ?`
      )
      .all(assertId(read.runId), assertId(read.captureId))
    for (const row of previous) {
      db.prepare(`DELETE FROM claims WHERE read_id = ?`).run(row.id)
      db.prepare(`DELETE FROM sentiment_reads WHERE id = ?`).run(row.id)
    }
    db.prepare(
      `INSERT INTO sentiment_reads (
         id, run_id, market_id, source, capture_id, prompt_id, aio_hash, input_hash, template_id,
         template_hash, generation_id, read_at, ok, error, brands_named_json, reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      assertId(read.id),
      read.runId,
      read.marketId,
      read.source,
      read.captureId,
      read.promptId,
      requireContentHash(read.aioHash),
      requireContentHash(read.inputHash),
      read.templateId,
      requireContentHash(read.templateHash),
      read.generationId,
      read.readAt,
      read.ok ? 1 : 0,
      read.error,
      requireJsonDocument(read.brandsNamed, 'brands named'),
      read.reason
    )
    const insert = db.prepare(
      `INSERT INTO claims (
         id, read_id, run_id, serp_result_id, brand_capture_id, position, brand, is_own, theme,
         attribute, polarity, sentence, url, fact_problem_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    claims.forEach((claim, index) => {
      insert.run(
        assertId(claim.id),
        read.id,
        read.runId,
        read.source === 'buyer' ? read.captureId : null,
        read.source === 'brand' ? read.captureId : null,
        index + 1,
        claim.brand,
        claim.isOwn ? 1 : 0,
        claim.theme,
        claim.attribute,
        claim.tone,
        claim.sentence,
        claim.url,
        claim.factProblem === null ? null : requireJsonDocument(claim.factProblem, 'fact problem')
      )
    })
  })
  runWrite(() => write(), 'Could not save the sentiment reading')
}

interface ReadSql {
  id: string
  run_id: string
  market_id: string
  source: string
  capture_id: string
  prompt_id: string
  aio_hash: string
  input_hash: string
  template_id: string
  template_hash: string
  generation_id: string | null
  read_at: string
  ok: number
  error: string | null
  brands_named_json: string
  reason: string | null
}

export function listSentimentReads(
  db: SqliteDatabase,
  runIds: readonly string[]
): StoredSentimentRead[] {
  if (runIds.length === 0) return []
  const marks = runIds.map(() => '?').join(', ')
  return db
    .prepare<unknown[], ReadSql>(
      `SELECT id, run_id, market_id, source, capture_id, prompt_id, aio_hash, input_hash,
              template_id, template_hash, generation_id, read_at, ok, error, brands_named_json, reason
       FROM sentiment_reads WHERE run_id IN (${marks})
       ORDER BY read_at ASC, rowid ASC`
    )
    .all(...runIds.map((id) => assertId(id)))
    .map(readFromSql)
}

interface ClaimSql {
  id: string
  read_id: string
  run_id: string
  serp_result_id: string | null
  brand_capture_id: string | null
  position: number
  brand: string
  is_own: number
  theme: string
  attribute: string
  polarity: string
  sentence: string
  url: string | null
  fact_problem_json: string | null
}

/** Claims of successful readings for these runs, in reading then sentence order. */
export function listSentimentClaims(
  db: SqliteDatabase,
  runIds: readonly string[]
): StoredSentimentClaim[] {
  if (runIds.length === 0) return []
  const marks = runIds.map(() => '?').join(', ')
  return db
    .prepare<unknown[], ClaimSql>(
      `SELECT c.id, c.read_id, c.run_id, c.serp_result_id, c.brand_capture_id, c.position, c.brand,
              c.is_own, c.theme, c.attribute, c.polarity, c.sentence, c.url, c.fact_problem_json
       FROM claims c
       JOIN sentiment_reads r ON r.id = c.read_id
       WHERE c.run_id IN (${marks}) AND r.ok = 1
       ORDER BY r.read_at ASC, r.rowid ASC, c.position ASC`
    )
    .all(...runIds.map((id) => assertId(id)))
    .map(claimFromSql)
}

function captureFromSql(row: CaptureSql): StoredBrandCapture {
  if (!isBrandPromptKind(row.kind)) throw new StorageError('Invalid brand prompt kind')
  if (row.status !== 'aio' && row.status !== 'no_aio' && row.status !== 'error') {
    throw new StorageError('Invalid brand capture status')
  }
  return {
    id: row.id,
    runId: row.run_id,
    brandPromptId: row.brand_prompt_id,
    promptText: row.prompt_text,
    keyId: row.key_id,
    hasAio: row.has_aio === 1,
    neededFollowup: row.needed_followup === 1,
    searches: row.searches,
    status: row.status,
    aioText: row.aio_text,
    references: readReferences(row.references_json),
    errorCode: row.error_code,
    message: row.message,
    capturedAt: row.captured_at,
    kind: row.kind,
    language: row.language
  }
}

function readReferences(encoded: string): SentimentReference[] {
  const parsed = readJson(encoded, 'brand capture references')
  if (!Array.isArray(parsed)) throw new StorageError('Invalid brand capture references')
  const references: SentimentReference[] = []
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const value = item as Record<string, unknown>
    if (
      typeof value.position !== 'number' ||
      typeof value.url !== 'string' ||
      typeof value.domain !== 'string' ||
      typeof value.classification !== 'string' ||
      !isCitationClass(value.classification) ||
      typeof value.sourceType !== 'string'
    ) {
      continue
    }
    references.push({
      position: value.position,
      url: value.url,
      domain: value.domain,
      title: typeof value.title === 'string' ? value.title : null,
      classification: value.classification,
      sourceType: value.sourceType as SentimentReference['sourceType']
    })
  }
  return references
}

function readFromSql(row: ReadSql): StoredSentimentRead {
  if (row.source !== 'brand' && row.source !== 'buyer') {
    throw new StorageError('Invalid sentiment source')
  }
  const named = readJson(row.brands_named_json, 'brands named')
  return {
    id: row.id,
    runId: row.run_id,
    marketId: row.market_id,
    source: row.source,
    captureId: row.capture_id,
    promptId: row.prompt_id,
    aioHash: row.aio_hash,
    inputHash: row.input_hash,
    templateId: row.template_id,
    templateHash: row.template_hash,
    generationId: row.generation_id,
    readAt: row.read_at,
    ok: row.ok === 1,
    error: row.error,
    brandsNamed: Array.isArray(named)
      ? (named as unknown[]).filter((item): item is string => typeof item === 'string')
      : [],
    reason: row.reason
  }
}

function claimFromSql(row: ClaimSql): StoredSentimentClaim {
  if (!isClaimTone(row.polarity)) throw new StorageError('Invalid claim tone')
  const captureId = row.serp_result_id ?? row.brand_capture_id
  if (captureId === null) throw new StorageError('Invalid claim capture')
  return {
    id: row.id,
    readId: row.read_id,
    runId: row.run_id,
    captureId,
    source: row.serp_result_id === null ? 'brand' : 'buyer',
    position: row.position,
    brand: row.brand,
    isOwn: row.is_own === 1,
    theme: row.theme,
    attribute: row.attribute,
    tone: row.polarity,
    sentence: row.sentence,
    url: row.url,
    factProblem: row.fact_problem_json === null ? null : readFactProblem(row.fact_problem_json)
  }
}

function readFactProblem(encoded: string): FactProblem | null {
  const parsed = readJson(encoded, 'fact problem')
  if (typeof parsed !== 'object' || parsed === null) return null
  const value = parsed as Record<string, unknown>
  if (
    (value.basis !== 'fact' && value.basis !== 'page') ||
    typeof value.why !== 'string' ||
    typeof value.correction !== 'string'
  ) {
    return null
  }
  return {
    basis: value.basis,
    why: value.why,
    correction: value.correction,
    sourceToFix: typeof value.sourceToFix === 'string' ? value.sourceToFix : null
  }
}
