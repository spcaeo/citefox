import type { LlmCallRecord, LlmCallSource } from '@shared/ipc'
import { LLM_CALL_SOURCES } from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, isOneOf, rejectSecret, requireUtcTimestamp, runWrite } from './record-values'

/**
 * `llm_calls` (FR-25.6, section 10). The same columns live in each project
 * database and in app.sqlite; the app table adds `project_id` for calls that
 * belong to no project. Prompts and replies are never stored.
 */

export type LlmCallRow = Omit<LlmCallRecord, 'projectId'>

interface LlmCallSql {
  id: string
  project_id?: string | null
  connection: string
  model: string | null
  source: string
  template_kind: string | null
  template_id: string | null
  template_hash: string | null
  assist_id: string | null
  started_at: string
  duration_ms: number
  tokens_in: number
  tokens_out: number
  ok: number
  error: string | null
}

const COLUMNS = `id, connection, model, source, template_kind, template_id, template_hash,
  assist_id, started_at, duration_ms, tokens_in, tokens_out, ok, error`

/** Writes one row. `projectId` is only stored on the app table (`where: 'app'`). */
export function insertLlmCall(
  db: SqliteDatabase,
  row: LlmCallRow,
  where: { table: 'project' } | { table: 'app'; projectId: string | null }
): void {
  const clean = normalize(row)
  const values = [
    clean.id,
    clean.connection,
    clean.model,
    clean.source,
    clean.templateKind,
    clean.templateId,
    clean.templateHash,
    clean.assistId,
    clean.startedAt,
    clean.durationMs,
    clean.tokensIn,
    clean.tokensOut,
    clean.ok ? 1 : 0,
    clean.error
  ]
  runWrite(() => {
    if (where.table === 'project') {
      db.prepare(
        `INSERT INTO llm_calls (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(...values)
      return
    }
    db.prepare(
      `INSERT INTO llm_calls (project_id, ${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(where.projectId, ...values)
  }, 'Could not record the Claude call')
}

/** Rows started at or after `since` (ISO-8601 UTC), newest first. */
export function listLlmCalls(
  db: SqliteDatabase,
  options: { since: string | null; limit?: number; projectId: string | null; appTable: boolean }
): LlmCallRecord[] {
  const limit = options.limit ?? 5000
  const where = options.since === null ? '' : 'WHERE started_at >= ?'
  const params: unknown[] = options.since === null ? [] : [options.since]
  const projectColumn = options.appTable ? 'project_id, ' : ''
  const rows = db
    .prepare<unknown[], LlmCallSql>(
      `SELECT ${projectColumn}${COLUMNS} FROM llm_calls ${where}
       ORDER BY started_at DESC, id DESC LIMIT ${Math.max(1, Math.min(limit, 20_000))}`
    )
    .all(...params)
  return rows.map((row) =>
    fromSql(row, options.appTable ? (row.project_id ?? null) : options.projectId)
  )
}

/** Durations of the newest successful calls of one step, for "about N s" (FR-25.1). */
export function recentDurations(
  db: SqliteDatabase,
  step: { assistId: string } | { templateKind: string },
  limit = 10
): number[] {
  const column = 'assistId' in step ? 'assist_id' : 'template_kind'
  const value = 'assistId' in step ? step.assistId : step.templateKind
  return db
    .prepare<unknown[], { duration_ms: number }>(
      `SELECT duration_ms FROM llm_calls WHERE ${column} = ? AND ok = 1
       ORDER BY started_at DESC LIMIT ?`
    )
    .all(value, limit)
    .map((row) => row.duration_ms)
}

/** Newest started_at of a call on this connection that got a reply, or null. */
export function lastOkCallOn(
  db: SqliteDatabase,
  connection: 'claude-code' | 'anthropic-api' | 'codex'
): string | null {
  const row = db
    .prepare<unknown[], { at: string | null }>(
      `SELECT MAX(started_at) AS at FROM llm_calls WHERE connection = ? AND ok = 1`
    )
    .get(connection)
  return row?.at ?? null
}

/** Newest started_at among calls of a template kind, or null. */
export function lastCallOfKind(db: SqliteDatabase, kind: string): string | null {
  const row = db
    .prepare<unknown[], { at: string | null }>(
      `SELECT MAX(started_at) AS at FROM llm_calls WHERE template_kind = ?`
    )
    .get(kind)
  return row?.at ?? null
}

function normalize(row: LlmCallRow): LlmCallRow {
  if (
    row.connection !== 'claude-code' &&
    row.connection !== 'anthropic-api' &&
    row.connection !== 'codex'
  ) {
    throw new StorageError('Invalid connection')
  }
  if (!isOneOf<LlmCallSource>(LLM_CALL_SOURCES, row.source)) {
    throw new StorageError('Invalid call source')
  }
  const error = row.error === null ? null : row.error.slice(0, 500)
  if (error !== null) rejectSecret(error, 'call error', true)
  return {
    ...row,
    id: assertId(row.id),
    model: shortText(row.model, 120),
    templateKind: shortText(row.templateKind, 40),
    templateId: shortText(row.templateId, 80),
    templateHash: shortText(row.templateHash, 128),
    assistId: shortText(row.assistId, 80),
    startedAt: requireUtcTimestamp(row.startedAt),
    durationMs: count(row.durationMs),
    tokensIn: count(row.tokensIn),
    tokensOut: count(row.tokensOut),
    error
  }
}

function shortText(value: string | null, max: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function count(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value)
}

function fromSql(row: LlmCallSql, projectId: string | null): LlmCallRecord {
  return {
    id: row.id,
    projectId,
    connection:
      row.connection === 'anthropic-api' || row.connection === 'codex'
        ? row.connection
        : 'claude-code',
    model: row.model,
    source: isOneOf<LlmCallSource>(LLM_CALL_SOURCES, row.source) ? row.source : 'other',
    templateKind: row.template_kind,
    templateId: row.template_id,
    templateHash: row.template_hash,
    assistId: row.assist_id,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    ok: row.ok === 1,
    error: row.error
  }
}
