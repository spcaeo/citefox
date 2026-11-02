import { readTemplateSettings, type TemplateSettings } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, rejectSecret, requireUtcTimestamp, runWrite } from './record-values'

/**
 * `template_overrides` in a project database (TPL-1, FR-26.8).
 * One row is one saved version of the project's own template for a step.
 * The current version is the newest row of that kind with `reset_at` null;
 * Reset to default sets `reset_at` on every row of the kind, and the next
 * save continues the version numbers.
 */

export interface TemplateOverrideRecord {
  id: string
  kind: string
  version: number
  baseTemplateId: string
  body: string
  hash: string
  settings: TemplateSettings
  createdAt: string
  resetAt: string | null
}

interface OverrideSql {
  id: string
  kind: string
  version: number
  base_template_id: string
  body: string
  hash: string
  settings_json: string | null
  created_at: string
  reset_at: string | null
}

const COLUMNS = `id, kind, version, base_template_id, body, hash, settings_json, created_at, reset_at`
const KIND = /^[a-z][a-z0-9_]{0,39}$/
const HASH = /^[a-f0-9]{64}$/

export function insertTemplateOverride(
  db: SqliteDatabase,
  record: Omit<TemplateOverrideRecord, 'version' | 'resetAt'>
): TemplateOverrideRecord {
  const kind = requireKind(record.kind)
  if (!HASH.test(record.hash)) throw new StorageError('Invalid template hash')
  if (record.body.length === 0 || record.body.length > 500_000 || record.body.includes('\0')) {
    throw new StorageError('Invalid template body')
  }
  rejectSecret(record.body, 'template body', false)
  const version = nextOverrideVersion(db, kind)
  const row: TemplateOverrideRecord = {
    id: assertId(record.id),
    kind,
    version,
    baseTemplateId: assertId(record.baseTemplateId),
    body: record.body,
    hash: record.hash,
    settings: record.settings,
    createdAt: requireUtcTimestamp(record.createdAt),
    resetAt: null
  }
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO template_overrides (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          row.id,
          row.kind,
          row.version,
          row.baseTemplateId,
          row.body,
          row.hash,
          JSON.stringify(row.settings),
          row.createdAt
        ),
    'Could not save the project template'
  )
  return row
}

/** The version a run of `kind` uses in this project, or null for the app default. */
export function getCurrentOverride(
  db: SqliteDatabase,
  kind: string
): TemplateOverrideRecord | null {
  const row = db
    .prepare<unknown[], OverrideSql>(
      `SELECT ${COLUMNS} FROM template_overrides
       WHERE kind = ? ORDER BY version DESC LIMIT 1`
    )
    .get(requireKind(kind))
  if (row === undefined || row.reset_at !== null) return null
  return fromSql(row)
}

/** Every version of `kind`, newest first, reset ones included. */
export function listOverrideVersions(db: SqliteDatabase, kind: string): TemplateOverrideRecord[] {
  return db
    .prepare<unknown[], OverrideSql>(
      `SELECT ${COLUMNS} FROM template_overrides WHERE kind = ? ORDER BY version DESC`
    )
    .all(requireKind(kind))
    .map(fromSql)
}

/** Every current override, keyed by kind. */
export function listCurrentOverrides(db: SqliteDatabase): Map<string, TemplateOverrideRecord> {
  const rows = db
    .prepare<unknown[], OverrideSql>(
      `SELECT ${COLUMNS} FROM template_overrides ORDER BY kind ASC, version DESC`
    )
    .all()
  const current = new Map<string, TemplateOverrideRecord>()
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.kind)) continue
    seen.add(row.kind)
    if (row.reset_at === null) current.set(row.kind, fromSql(row))
  }
  return current
}

/** Reset to default. Returns how many versions were marked. */
export function resetTemplateOverrides(db: SqliteDatabase, kind: string, now: string): number {
  let changes = 0
  runWrite(() => {
    changes = db
      .prepare(`UPDATE template_overrides SET reset_at = ? WHERE kind = ? AND reset_at IS NULL`)
      .run(requireUtcTimestamp(now), requireKind(kind)).changes
  }, 'Could not reset the project template')
  return changes
}

/** Any version (current or not) whose body has this hash, for showing past wording. */
export function findOverrideByHash(
  db: SqliteDatabase,
  kind: string,
  hash: string
): TemplateOverrideRecord | null {
  const row = db
    .prepare<unknown[], OverrideSql>(
      `SELECT ${COLUMNS} FROM template_overrides WHERE kind = ? AND hash = ?
       ORDER BY version DESC LIMIT 1`
    )
    .get(requireKind(kind), hash)
  return row === undefined ? null : fromSql(row)
}

function nextOverrideVersion(db: SqliteDatabase, kind: string): number {
  const row = db
    .prepare<unknown[], { top: number | null }>(
      `SELECT MAX(version) AS top FROM template_overrides WHERE kind = ?`
    )
    .get(kind)
  return (row?.top ?? 0) + 1
}

function requireKind(kind: string): string {
  if (!KIND.test(kind)) throw new StorageError('Invalid template kind')
  return kind
}

function fromSql(row: OverrideSql): TemplateOverrideRecord {
  let settings: unknown = null
  if (row.settings_json !== null) {
    try {
      settings = JSON.parse(row.settings_json) as unknown
    } catch {
      settings = null
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    baseTemplateId: row.base_template_id,
    body: row.body,
    hash: row.hash,
    settings: readTemplateSettings(settings),
    createdAt: row.created_at,
    resetAt: row.reset_at
  }
}
