import { redactString } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireUtcTimestamp } from './values'

/** App migration 018. What one `activity_events` row records (FR-10.6, FR-11.10). */
export const ACTIVITY_KINDS = [
  'search',
  'claude_call',
  'jina_read',
  'claude_limit',
  'claude_fallback',
  'jina_failover'
] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** Kinds that are events in plain words, not counts. */
export const ACTIVITY_NOTICE_KINDS: readonly ActivityKind[] = [
  'claude_limit',
  'claude_fallback',
  'jina_failover'
]

/** Rows older than this are removed on write. Usage needs this month and the last 24 hours. */
export const ACTIVITY_RETENTION_DAYS = 70

export interface ActivityRecord {
  id: string
  /** ISO-8601 UTC. */
  at: string
  kind: ActivityKind
  keyId: string | null
  projectId: string | null
  /** Searches for `search`, otherwise 1. */
  count: number
  /** Plain words, redacted. Null for counts. */
  detail: string | null
}

export interface ActivityCounts {
  searches: number
  claudeCalls: number
  jinaReads: number
}

/**
 * Store one row and prune old ones. A project id that is no longer a project is stored
 * as NULL, so a call that finishes after its project was deleted still counts.
 */
export function recordActivity(db: SqliteDatabase, record: ActivityRecord): void {
  const row = normalize(record)
  const projectId =
    row.projectId === null
      ? null
      : db.prepare(`SELECT id FROM projects WHERE id = ?`).get(row.projectId) === undefined
        ? null
        : row.projectId
  runWrite(() => {
    db.prepare(
      `INSERT INTO activity_events (id, at, kind, key_id, project_id, count, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.at, row.kind, row.keyId, projectId, row.count, row.detail)
    const cutoff = new Date(Date.parse(row.at) - ACTIVITY_RETENTION_DAYS * 86_400_000)
    db.prepare(`DELETE FROM activity_events WHERE at < ?`).run(cutoff.toISOString())
  }, 'Could not record activity')
}

/** Searches, Claude calls, and Jina reads at or after `since` (FR-11.10). */
export function countActivitySince(db: SqliteDatabase, since: string): ActivityCounts {
  const rows = db
    .prepare<unknown[], { kind: string; total: number }>(
      `SELECT kind, SUM(count) AS total FROM activity_events
       WHERE at >= ? AND kind IN ('search', 'claude_call', 'jina_read')
       GROUP BY kind`
    )
    .all(requireUtcTimestamp(since))
  const total = (kind: string): number => rows.find((row) => row.kind === kind)?.total ?? 0
  return {
    searches: total('search'),
    claudeCalls: total('claude_call'),
    jinaReads: total('jina_read')
  }
}

/** One activity row with the key and project names for the Connections drill-down. */
export interface ActivityRecordNamed extends ActivityRecord {
  keyName: string | null
  projectName: string | null
}

/**
 * Every row at or after `since`, newest first, with key and project names
 * (FR-11.10 drill-down). Details are stored redacted.
 */
export function listActivitySince(db: SqliteDatabase, since: string): ActivityRecordNamed[] {
  const rows = db
    .prepare<unknown[], ActivitySql & { key_name: string | null; project_name: string | null }>(
      `SELECT e.id, e.at, e.kind, e.key_id, e.project_id, e.count, e.detail,
              k.name AS key_name, p.name AS project_name
       FROM activity_events e
       LEFT JOIN api_keys k ON k.id = e.key_id
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.at >= ?
       ORDER BY e.at DESC, e.rowid DESC`
    )
    .all(requireUtcTimestamp(since))
  return rows.map((row) => ({
    ...fromSql(row),
    keyName: row.key_name,
    projectName: row.project_name
  }))
}

/** Claude calls per project in `[from, to)`. The null key is calls with no project. */
export function claudeCallsByProject(
  db: SqliteDatabase,
  from: string,
  to: string
): Map<string | null, number> {
  const rows = db
    .prepare<unknown[], { project_id: string | null; total: number }>(
      `SELECT project_id, SUM(count) AS total FROM activity_events
       WHERE kind = 'claude_call' AND at >= ? AND at < ?
       GROUP BY project_id`
    )
    .all(requireUtcTimestamp(from), requireUtcTimestamp(to))
  return new Map(rows.map((row) => [row.project_id, row.total]))
}

/** The newest notice row (limit, fallback, or Jina failover), or null. */
export function latestActivityNotice(db: SqliteDatabase): ActivityRecord | null {
  const row = db
    .prepare<unknown[], ActivitySql>(
      `SELECT id, at, kind, key_id, project_id, count, detail FROM activity_events
       WHERE kind IN ('claude_limit', 'claude_fallback', 'jina_failover')
       ORDER BY at DESC, rowid DESC LIMIT 1`
    )
    .get()
  return row === undefined ? null : fromSql(row)
}

interface ActivitySql {
  id: string
  at: string
  kind: string
  key_id: string | null
  project_id: string | null
  count: number
  detail: string | null
}

function fromSql(row: ActivitySql): ActivityRecord {
  if (!ACTIVITY_KINDS.some((kind) => kind === row.kind)) {
    throw new StorageError('Invalid activity kind')
  }
  return {
    id: row.id,
    at: row.at,
    kind: row.kind as ActivityKind,
    keyId: row.key_id,
    projectId: row.project_id,
    count: row.count,
    detail: row.detail
  }
}

function normalize(record: ActivityRecord): ActivityRecord {
  if (!ACTIVITY_KINDS.some((kind) => kind === record.kind)) {
    throw new StorageError('Invalid activity kind')
  }
  if (!Number.isInteger(record.count) || record.count < 1 || record.count > 1_000_000) {
    throw new StorageError('Invalid activity count')
  }
  const detail =
    record.detail === null ? null : redactString(record.detail, { hexKeys: true }).slice(0, 500)
  return {
    id: assertId(record.id),
    at: requireUtcTimestamp(record.at),
    kind: record.kind,
    keyId: record.keyId === null ? null : assertId(record.keyId),
    projectId: record.projectId === null ? null : assertId(record.projectId),
    count: record.count,
    detail: detail === null || detail.length === 0 ? null : detail
  }
}
