import { redactString } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { ensureProjectSchema } from './project-profile'
import { runWrite } from './record-values'
import { requireUtcTimestamp } from './values'

/** Project migration 025. `scopeKey` is '' for the project default, else a page id. */
export interface AutoExportRow {
  scopeKey: string
  enabled: boolean
  destination: 'folder' | 'email'
  folder: string | null
  /** The stored `ExportSpec` as JSON. The export area parses and checks it. */
  specJson: string | null
  updatedAt: string
}

export interface AutoExportRunRow {
  id: string
  scopeKey: string
  startedAt: string
  finishedAt: string
  outcome: 'ok' | 'failed'
  format: string
  filename: string | null
  bytes: number | null
  reason: string | null
  nextStep: string | null
}

/** History rows kept per scope. Older rows are trimmed; files on disk are never touched. */
export const AUTO_EXPORT_RUNS_KEPT = 50

const SCOPE_KEY = /^(|[A-Za-z0-9][A-Za-z0-9._:-]{0,79})$/
const MAX_SPEC_JSON = 64 * 1024

interface RowSql {
  scope_key: string
  enabled: number
  destination: string
  folder: string | null
  spec_json: string | null
  updated_at: string
}

interface RunSql {
  id: string
  scope_key: string
  started_at: string
  finished_at: string
  outcome: string
  format: string
  filename: string | null
  bytes: number | null
  reason: string | null
  next_step: string | null
}

export function readAutoExportRow(db: SqliteDatabase, scopeKey: string): AutoExportRow | null {
  ensureProjectSchema(db)
  const row = db
    .prepare<[string], RowSql>(
      `SELECT scope_key, enabled, destination, folder, spec_json, updated_at
       FROM auto_exports WHERE scope_key = ?`
    )
    .get(requireScopeKey(scopeKey))
  return row === undefined ? null : rowFromSql(row)
}

/** Every stored scope, project default first. */
export function listAutoExportRows(db: SqliteDatabase): AutoExportRow[] {
  ensureProjectSchema(db)
  return db
    .prepare<[], RowSql>(
      `SELECT scope_key, enabled, destination, folder, spec_json, updated_at
       FROM auto_exports ORDER BY scope_key ASC`
    )
    .all()
    .map(rowFromSql)
}

/** Inserts or replaces the scope's row. */
export function writeAutoExportRow(db: SqliteDatabase, row: AutoExportRow): void {
  ensureProjectSchema(db)
  const scopeKey = requireScopeKey(row.scopeKey)
  if (row.folder !== null && (row.folder.length === 0 || row.folder.length > 4096)) {
    throw new StorageError('Invalid auto-export folder')
  }
  if (row.specJson !== null && row.specJson.length > MAX_SPEC_JSON) {
    throw new StorageError('Auto-export settings are too large')
  }
  if (row.destination !== 'folder' && row.destination !== 'email') {
    throw new StorageError('Invalid auto-export destination')
  }
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO auto_exports (scope_key, enabled, destination, folder, spec_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (scope_key) DO UPDATE SET
             enabled = excluded.enabled,
             destination = excluded.destination,
             folder = excluded.folder,
             spec_json = excluded.spec_json,
             updated_at = excluded.updated_at`
        )
        .run(
          scopeKey,
          row.enabled ? 1 : 0,
          row.destination,
          row.folder,
          row.specJson,
          requireUtcTimestamp(row.updatedAt)
        ),
    'save automatic export'
  )
}

/** Adds one attempt and trims that scope's history to {@link AUTO_EXPORT_RUNS_KEPT}. */
export function recordAutoExportRun(db: SqliteDatabase, run: AutoExportRunRow): void {
  ensureProjectSchema(db)
  const scopeKey = requireScopeKey(run.scopeKey)
  if (run.id.length === 0) throw new StorageError('Invalid id')
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO auto_export_runs
         (id, scope_key, started_at, finished_at, outcome, format, filename, bytes, reason, next_step)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      run.id,
      scopeKey,
      requireUtcTimestamp(run.startedAt),
      requireUtcTimestamp(run.finishedAt),
      run.outcome,
      run.format,
      run.filename === null ? null : run.filename.slice(0, 512),
      run.bytes,
      clip(run.reason, 500),
      clip(run.nextStep, 300)
    )
    db.prepare(
      `DELETE FROM auto_export_runs WHERE scope_key = ? AND id NOT IN (
         SELECT id FROM auto_export_runs WHERE scope_key = ?
         ORDER BY finished_at DESC, rowid DESC LIMIT ?
       )`
    ).run(scopeKey, scopeKey, AUTO_EXPORT_RUNS_KEPT)
  })
  runWrite(write, 'record automatic export')
}

/** The scope's attempts, newest first. */
export function listAutoExportRuns(
  db: SqliteDatabase,
  scopeKey: string,
  limit = 20
): AutoExportRunRow[] {
  ensureProjectSchema(db)
  return db
    .prepare<[string, number], RunSql>(
      `SELECT id, scope_key, started_at, finished_at, outcome, format, filename, bytes, reason, next_step
       FROM auto_export_runs WHERE scope_key = ?
       ORDER BY finished_at DESC, rowid DESC LIMIT ?`
    )
    .all(requireScopeKey(scopeKey), Math.max(1, Math.min(limit, AUTO_EXPORT_RUNS_KEPT)))
    .map((row) => ({
      id: row.id,
      scopeKey: row.scope_key,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      outcome: row.outcome === 'ok' ? 'ok' : 'failed',
      format: row.format,
      filename: row.filename,
      bytes: row.bytes,
      reason: row.reason,
      nextStep: row.next_step
    }))
}

function rowFromSql(row: RowSql): AutoExportRow {
  return {
    scopeKey: row.scope_key,
    enabled: row.enabled === 1,
    destination: row.destination === 'email' ? 'email' : 'folder',
    folder: row.folder,
    specJson: row.spec_json,
    updatedAt: row.updated_at
  }
}

function requireScopeKey(value: string): string {
  if (typeof value !== 'string' || !SCOPE_KEY.test(value)) {
    throw new StorageError('Invalid auto-export scope')
  }
  return value
}

function clip(value: string | null, max: number): string | null {
  if (value === null) return null
  const clean = redactString(value, { hexKeys: true }).trim()
  if (clean.length === 0) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
