import type { ModelUsage } from '@shared/ipc'
import { requireCount, requireDuration } from './content-values'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  assertId,
  readJson,
  requireContentHash,
  requireJsonDocument,
  requireOptionalLabel,
  requireStoredText,
  requireUtcTimestamp
} from './values'

/** `generations` rows in a project database: Claude call usage and the output cache. */

/**
 * Kinds stored on `generations`: one row per model attempt, which is also what the
 * daily and monthly Claude call caps count. Report calls use `aio_gap`, `summary`
 * and `answer_shape` (REPORT-SPEC section 9), so every report-runner Claude call
 * counts toward the same caps and per-page usage.
 */
export const STORED_GENERATION_KINDS = [
  'buyer_profile',
  'buyer_prompts',
  'coverage',
  'coverage_matrix',
  'page_audit',
  'coverage_fixes',
  'aio_gap',
  'summary',
  'brand_prompts',
  'sentiment_claims',
  'sentiment_claims_v2',
  'sentiment_fact_check',
  'answer_shape'
] as const
export type StoredGenerationKind = (typeof STORED_GENERATION_KINDS)[number]

export interface GenerationRecord {
  id: string
  pageId: string
  kind: StoredGenerationKind
  templateId: string
  templateHash: string
  startedAt: string
  durationMs: number
  model: string | null
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  ok: boolean
  error: string | null
  /** Lowercase SHA-256 of the template hash, rendered prompt, and schema. */
  inputHash: string
  usage: ModelUsage
}

export function insertGeneration(
  db: SqliteDatabase,
  record: GenerationRecord,
  output: unknown
): void {
  const usage = requireUsage(record.usage)
  const outputJson = record.ok ? requireJsonDocument(output, 'generation output') : null
  db.prepare(
    `INSERT INTO generations (
       id, page_id, kind, template_id, template_hash, started_at, duration_ms,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
       model, connection, ok, error, input_hash, output_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assertId(record.id),
    assertId(record.pageId),
    requireKind(record.kind),
    assertId(record.templateId),
    requireContentHash(record.templateHash),
    requireUtcTimestamp(record.startedAt),
    requireDuration(record.durationMs),
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheCreationTokens,
    usage.serpapiSearches,
    requireOptionalLabel(record.model, 'model', 120),
    requireConnection(record.connection),
    record.ok ? 1 : 0,
    record.error === null ? null : requireStoredText(record.error, 'generation error', 2000),
    requireContentHash(record.inputHash),
    outputJson
  )
}

export interface CachedGeneration {
  id: string
  output: unknown
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  model: string | null
  usage: ModelUsage
}

export function getCachedGeneration(
  db: SqliteDatabase,
  kind: StoredGenerationKind,
  inputHash: string
): CachedGeneration | null {
  requireKind(kind)
  requireContentHash(inputHash)
  const row = db
    .prepare<unknown[], GenerationSql>(
      `SELECT id, output_json, connection, model, input_tokens, output_tokens, cache_read_tokens,
              cache_creation_tokens, serpapi_searches
       FROM generations
       WHERE kind = ? AND input_hash = ? AND ok = 1 AND output_json IS NOT NULL
       ORDER BY started_at DESC, rowid DESC LIMIT 1`
    )
    .get(kind, inputHash)
  if (row === undefined || row.output_json === null) return null
  return {
    id: row.id,
    output: readJson(row.output_json, 'generation output'),
    connection: requireConnection(row.connection),
    model: row.model,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      serpapiSearches: row.serpapi_searches
    }
  }
}

export function listGenerations(db: SqliteDatabase, pageId: string): GenerationRecord[] {
  assertId(pageId)
  return db
    .prepare<unknown[], GenerationListSql>(
      `SELECT id, page_id, kind, template_id, template_hash, started_at, duration_ms, model,
              connection, ok, error, input_hash, input_tokens, output_tokens, cache_read_tokens,
              cache_creation_tokens, serpapi_searches
       FROM generations WHERE page_id = ? ORDER BY started_at ASC, rowid ASC`
    )
    .all(pageId)
    .map((row) => ({
      id: row.id,
      pageId: row.page_id,
      kind: requireKind(row.kind),
      templateId: row.template_id,
      templateHash: row.template_hash,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      model: row.model,
      connection: requireConnection(row.connection),
      ok: row.ok === 1,
      error: row.error,
      inputHash: row.input_hash,
      usage: {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreationTokens: row.cache_creation_tokens,
        serpapiSearches: row.serpapi_searches
      }
    }))
}

interface GenerationSql {
  id: string
  output_json: string | null
  connection: string
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  serpapi_searches: number
}

interface GenerationListSql extends GenerationSql {
  page_id: string
  kind: string
  template_id: string
  template_hash: string
  started_at: string
  duration_ms: number
  ok: number
  error: string | null
  input_hash: string
}

function requireUsage(usage: ModelUsage): ModelUsage {
  return {
    inputTokens: requireCount(usage.inputTokens, 'input tokens'),
    outputTokens: requireCount(usage.outputTokens, 'output tokens'),
    cacheReadTokens: requireCount(usage.cacheReadTokens, 'cache read tokens'),
    cacheCreationTokens: requireCount(usage.cacheCreationTokens, 'cache creation tokens'),
    serpapiSearches: requireCount(usage.serpapiSearches, 'serpapi searches')
  }
}

function requireKind(value: string): StoredGenerationKind {
  if (!(STORED_GENERATION_KINDS as readonly string[]).includes(value)) {
    throw new StorageError('Invalid generation kind')
  }
  return value as StoredGenerationKind
}

function requireConnection(value: string): 'claude-code' | 'anthropic-api' | 'codex' {
  if (value !== 'claude-code' && value !== 'anthropic-api' && value !== 'codex') {
    throw new StorageError('Invalid llm connection')
  }
  return value
}
