import { isGenerationTemplateKind } from '@shared/domain'
import type { GenerationTemplateKind } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  assertId,
  rejectSecret,
  requireBoolean,
  requireInteger,
  requireLabel,
  requireUtcTimestamp,
  runWrite
} from './record-values'

/** `templates` rows in app.sqlite. */

const HASH = /^[A-Za-z0-9._:-]{1,128}$/

export interface TemplateRecord {
  id: string
  name: string
  version: number
  hash: string
  body: string
  schema: string | null
  settingsJson: string | null
  kind: GenerationTemplateKind
  notes: string | null
  isShipped: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
}

const TEMPLATE_COLUMNS = `id, name, version, hash, body, "schema", settings_json, kind, notes,
  deleted_at, is_default, is_shipped, created_at, updated_at`

export function insertTemplate(db: SqliteDatabase, record: TemplateRecord): void {
  const row = normalizeTemplate(record)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO templates (
             id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
             is_default, is_shipped, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.name,
          row.version,
          row.hash,
          row.body,
          row.schema,
          row.settingsJson,
          row.kind,
          row.notes,
          row.deletedAt,
          row.isDefault ? 1 : 0,
          row.isShipped ? 1 : 0,
          row.createdAt,
          row.updatedAt
        ),
    'Could not save template'
  )
  recordTemplateVersion(db, row)
}

export function updateTemplate(db: SqliteDatabase, record: TemplateRecord): void {
  const row = normalizeTemplate(record)
  runWrite(
    () =>
      db
        .prepare(
          `UPDATE templates SET
             name = ?, version = ?, hash = ?, body = ?, "schema" = ?, settings_json = ?,
             kind = ?, notes = ?, deleted_at = ?, is_default = ?, is_shipped = ?,
             created_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          row.name,
          row.version,
          row.hash,
          row.body,
          row.schema,
          row.settingsJson,
          row.kind,
          row.notes,
          row.deletedAt,
          row.isDefault ? 1 : 0,
          row.isShipped ? 1 : 0,
          row.createdAt,
          row.updatedAt,
          row.id
        ),
    'Could not save template'
  )
  recordTemplateVersion(db, row)
}

/**
 * FR-26.4, TPL-4. One `template_versions` row per saved version, so a hash on a
 * past prompt set or check still names wording CiteFox has. A version number
 * already stored keeps its first body (a rename or a delete does not add one).
 */
function recordTemplateVersion(db: SqliteDatabase, row: TemplateRecord): void {
  runWrite(
    () =>
      db
        .prepare(
          `INSERT OR IGNORE INTO template_versions
             (template_id, version, hash, body, settings_json, saved_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.version,
          row.hash,
          row.body,
          row.settingsJson,
          row.updatedAt ?? row.createdAt
        ),
    'Could not save template'
  )
}

export interface TemplateVersionRecord {
  templateId: string
  version: number
  hash: string
  body: string
  settingsJson: string | null
  savedAt: string
}

/** Newest version first. */
export function listTemplateVersions(
  db: SqliteDatabase,
  templateId: string
): TemplateVersionRecord[] {
  assertId(templateId)
  return db
    .prepare<
      unknown[],
      {
        template_id: string
        version: number
        hash: string
        body: string
        settings_json: string | null
        saved_at: string
      }
    >(
      `SELECT template_id, version, hash, body, settings_json, saved_at
       FROM template_versions WHERE template_id = ? ORDER BY version DESC`
    )
    .all(templateId)
    .map((row) => ({
      templateId: row.template_id,
      version: row.version,
      hash: row.hash,
      body: row.body,
      settingsJson: row.settings_json,
      savedAt: row.saved_at
    }))
}

/** Clears the live default for `kind` and marks `id` in one transaction. */
export function swapDefaultTemplate(
  db: SqliteDatabase,
  kind: GenerationTemplateKind,
  id: string
): void {
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE templates SET is_default = 0
       WHERE kind = ? AND is_default = 1 AND deleted_at IS NULL`
    ).run(kind)
    const result = db.prepare(`UPDATE templates SET is_default = 1 WHERE id = ?`).run(id)
    if (result.changes !== 1) throw new StorageError('Could not save template')
  })
  runWrite(() => run(), 'Could not save template')
}

export function getTemplate(db: SqliteDatabase, id: string): TemplateRecord | null {
  assertId(id)
  const row = db
    .prepare<unknown[], TemplateSql>(`SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE id = ?`)
    .get(id)
  return row === undefined || !isGenerationTemplateKind(row.kind) ? null : templateFromSql(row)
}

/**
 * Rows of every kind this build knows. Since app 020 the table has no kind CHECK,
 * so a row another build wrote for a step this one lacks is skipped, not an error.
 */
export function listTemplates(db: SqliteDatabase): TemplateRecord[] {
  return db
    .prepare<unknown[], TemplateSql>(
      `SELECT ${TEMPLATE_COLUMNS} FROM templates ORDER BY name ASC, version ASC`
    )
    .all()
    .filter((row) => isGenerationTemplateKind(row.kind))
    .map((row) => templateFromSql(row))
}

export function getLatestTemplateByName(db: SqliteDatabase, name: string): TemplateRecord | null {
  const templateName = requireLabel(name, 'template name', 80)
  const row = db
    .prepare<unknown[], TemplateSql>(
      `SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE name = ? ORDER BY version DESC LIMIT 1`
    )
    .get(templateName)
  return row === undefined ? null : templateFromSql(row)
}

interface TemplateSql {
  id: string
  name: string
  version: number
  hash: string
  body: string
  schema: string | null
  settings_json: string | null
  kind: string
  notes: string | null
  deleted_at: string | null
  is_default: number
  is_shipped: number
  created_at: string
  updated_at: string | null
}

function normalizeTemplate(record: TemplateRecord): TemplateRecord {
  if (!isGenerationTemplateKind(record.kind)) throw new StorageError('Invalid template kind')
  return {
    id: assertId(record.id),
    name: requireLabel(record.name, 'template name', 80),
    version: requireInteger(record.version, 'template version', 1, 1_000_000),
    hash: requireHash(record.hash),
    body: requireBody(record.body),
    schema: requireJsonText(record.schema, 'template schema'),
    settingsJson: requireJsonText(record.settingsJson, 'template settings'),
    kind: record.kind,
    notes: requireNotes(record.notes),
    isShipped: requireBoolean(record.isShipped, 'template shipped'),
    isDefault: requireBoolean(record.isDefault, 'template default'),
    createdAt: requireUtcTimestamp(record.createdAt),
    updatedAt: record.updatedAt === null ? null : requireUtcTimestamp(record.updatedAt),
    deletedAt: record.deletedAt === null ? null : requireUtcTimestamp(record.deletedAt)
  }
}

function templateFromSql(row: TemplateSql): TemplateRecord {
  if (!isGenerationTemplateKind(row.kind)) throw new StorageError('Invalid template kind')
  return normalizeTemplate({
    id: row.id,
    name: row.name,
    version: row.version,
    hash: row.hash,
    body: row.body,
    schema: row.schema,
    settingsJson: row.settings_json,
    kind: row.kind,
    notes: row.notes,
    isShipped: row.is_shipped === 1,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  })
}

function requireNotes(value: string | null): string | null {
  if (value === null || value.length === 0) return null
  if (value.length > 500 || value.includes('\0')) throw new StorageError('Invalid template notes')
  rejectSecret(value, 'template notes', false)
  return value
}

function requireHash(value: string): string {
  if (!HASH.test(value)) throw new StorageError('Invalid template hash')
  return value
}

function requireBody(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500_000) {
    throw new StorageError('Invalid template body')
  }
  if (value.includes('\0')) throw new StorageError('Invalid template body')
  rejectSecret(value, 'template body', false)
  return value
}

function requireJsonText(value: string | null, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > 500_000) {
    throw new StorageError(`Invalid ${label}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new StorageError(`Invalid ${label}`)
  }
  if (parsed === null || typeof parsed !== 'object') throw new StorageError(`Invalid ${label}`)
  rejectSecret(value, label, false)
  return value
}
