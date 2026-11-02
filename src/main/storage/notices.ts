import type { Notice, NoticeAction } from '@shared/domain'
import { redactString } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, readJson, requireUtcTimestamp } from './values'

/** App migration 021. A notice as written, with what its actions need in `data`. */
export interface NoticeInput {
  id: string
  kind: string
  projectId: string | null
  /** One open notice per key. A second add with the same open key is ignored. */
  dedupeKey: string
  title: string
  body: string
  actions: readonly NoticeAction[]
  data: Readonly<Record<string, string | number | boolean | null>>
  createdAt: string
}

export interface StoredNotice extends Omit<Notice, 'projectName'> {
  dedupeKey: string
  data: Record<string, unknown>
}

interface NoticeSql {
  id: string
  kind: string
  project_id: string | null
  dedupe_key: string
  title: string
  body: string
  actions_json: string
  data_json: string
  created_at: string
  resolved_at: string | null
  resolution: string | null
}

const KIND = /^[a-z][a-z0-9_]{0,39}$/

/**
 * Stores a notice unless one with the same key is still open. Returns true when
 * a row was added. A project id that is no longer a project is stored as NULL.
 */
export function addNotice(db: SqliteDatabase, input: NoticeInput): boolean {
  if (!KIND.test(input.kind)) throw new StorageError('Invalid notice kind')
  const actions = input.actions.map((action) => ({
    id: assertId(action.id),
    label: clip(action.label, 80),
    primary: action.primary
  }))
  if (actions.length === 0) throw new StorageError('A notice needs at least one action')
  const open = db
    .prepare(`SELECT id FROM notices WHERE dedupe_key = ? AND resolved_at IS NULL`)
    .get(clip(input.dedupeKey, 200))
  if (open !== undefined) return false
  const projectId =
    input.projectId === null
      ? null
      : db.prepare(`SELECT id FROM projects WHERE id = ?`).get(assertId(input.projectId)) ===
          undefined
        ? null
        : input.projectId
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO notices (id, kind, project_id, dedupe_key, title, body, actions_json,
             data_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          assertId(input.id),
          input.kind,
          projectId,
          clip(input.dedupeKey, 200),
          clip(input.title, 200),
          clip(input.body, 1000),
          JSON.stringify(actions),
          JSON.stringify(input.data),
          requireUtcTimestamp(input.createdAt)
        ),
    'Could not save the notice'
  )
  return true
}

/** Open notices, newest first. */
export function listOpenNotices(db: SqliteDatabase): StoredNotice[] {
  return db
    .prepare<unknown[], NoticeSql>(
      `SELECT * FROM notices WHERE resolved_at IS NULL ORDER BY created_at DESC, id DESC`
    )
    .all()
    .map(fromSql)
}

export function getNotice(db: SqliteDatabase, id: string): StoredNotice | null {
  const row = db
    .prepare<unknown[], NoticeSql>(`SELECT * FROM notices WHERE id = ?`)
    .get(assertId(id))
  return row === undefined ? null : fromSql(row)
}

/** Marks a notice answered. Returns false when it was already resolved or is unknown. */
export function resolveStoredNotice(
  db: SqliteDatabase,
  id: string,
  resolution: string,
  at: string
): boolean {
  const result = db
    .prepare(
      `UPDATE notices SET resolved_at = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL`
    )
    .run(requireUtcTimestamp(at), assertId(resolution), assertId(id))
  return result.changes === 1
}

/** Resolves every open notice with this key (the condition went away on its own). */
export function resolveNoticesByKey(
  db: SqliteDatabase,
  dedupeKey: string,
  resolution: string,
  at: string
): number {
  return db
    .prepare(
      `UPDATE notices SET resolved_at = ?, resolution = ?
       WHERE dedupe_key = ? AND resolved_at IS NULL`
    )
    .run(requireUtcTimestamp(at), assertId(resolution), dedupeKey).changes
}

function fromSql(row: NoticeSql): StoredNotice {
  const actions = readJson(row.actions_json, 'notice actions')
  const data = readJson(row.data_json, 'notice data')
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    dedupeKey: row.dedupe_key,
    title: row.title,
    body: row.body,
    actions: Array.isArray(actions) ? actions.filter(isAction) : [],
    data: isRecord(data) ? data : {},
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution
  }
}

function isAction(value: unknown): value is NoticeAction {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.primary === 'boolean'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clip(text: string, max: number): string {
  const clean = redactString(text.trim(), { hexKeys: true })
  if (clean.length === 0) throw new StorageError('A notice needs words')
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
