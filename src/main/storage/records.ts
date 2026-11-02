import { isProjectStatus } from '@shared/domain'
import type { ProjectStatus } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { removePendingClientPdfFiles } from './pending-client-pdfs'
import {
  assertId,
  rejectSecret,
  requireLabel,
  requireOptionalLabel,
  runWrite
} from './record-values'
import { projectDatabaseRelativePath } from './slug'

/**
 * Projects and the `app_state` row in app.sqlite.
 * Api keys, templates, and checkups live in sibling modules and are re-exported here.
 */

export {
  addKeyUsage,
  deleteApiKey,
  deleteConnectionEventsForKey,
  deleteKeyUsageForKey,
  getApiKey,
  getApiKeyByProvider,
  getConnectionEvent,
  getKeyUsage,
  insertApiKey,
  insertConnectionEvent,
  insertKeyUsage,
  listApiKeys,
  listApiKeysByProvider,
  listConnectionEventsForKey,
  reorderApiKeys,
  updateApiKey
} from './api-key-records'
export type {
  ApiKeyRecord,
  ConnectionEventKind,
  ConnectionEventRecord,
  KeyUsageRecord
} from './api-key-records'
export { getClaudeCheckup, getLatestClaudeCheckup, insertClaudeCheckup } from './checkup-records'
export type { ClaudeCheckupRecord } from './checkup-records'
export {
  getLatestTemplateByName,
  getTemplate,
  insertTemplate,
  listTemplates,
  swapDefaultTemplate,
  updateTemplate
} from './template-records'
export type { TemplateRecord } from './template-records'

export interface ProjectRecord {
  id: string
  name: string
  slug: string
  domain: string
  dbPath: string
  clientName: string | null
  status: ProjectStatus
}

export function insertProject(db: SqliteDatabase, record: ProjectRecord): void {
  const row = normalizeProject(record)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(row.id, row.name, row.slug, row.domain, row.dbPath, row.clientName, row.status),
    'Could not save project'
  )
}

/**
 * Deletes the project row. Pending PDF rows and tray history cascade.
 * The project's key usage stays counted on each key, moved to the no-project
 * row for that key and month, so key caps do not reset (migration 017).
 * When `outboxDir` is set, each `<id>.pdf` for that project is removed too.
 */
export function deleteProject(db: SqliteDatabase, id: string, outboxDir?: string): void {
  const projectId = assertId(id)
  if (outboxDir !== undefined) removePendingClientPdfFiles(outboxDir, [])
  const remove = db.transaction(() => {
    const ids = db
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM pending_client_pdfs WHERE project_id = ? ORDER BY id`
      )
      .all(projectId)
      .map((row) => row.id)
    moveProjectUsageToNoProject(db, projectId)
    const result = db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId)
    if (result.changes !== 1) throw new StorageError('Could not remove project')
    if (outboxDir !== undefined) removePendingClientPdfFiles(outboxDir, ids)
  })
  remove()
}

/**
 * Folds a project's `key_usage` rows into the no-project row for the same key
 * and month. Done before the delete so `ON DELETE SET NULL` never collides
 * with an existing no-project row on the unique index.
 */
function moveProjectUsageToNoProject(db: SqliteDatabase, projectId: string): void {
  db.prepare(
    `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
     SELECT 'usage-' || lower(hex(randomblob(16))), key_id, NULL, month, searches, calls, tokens
     FROM key_usage WHERE project_id = ?
     ON CONFLICT (key_id, ifnull(project_id, ''), month) DO UPDATE SET
       searches = searches + excluded.searches,
       calls = calls + excluded.calls,
       tokens = tokens + excluded.tokens`
  ).run(projectId)
  db.prepare(`DELETE FROM key_usage WHERE project_id = ?`).run(projectId)
}

export function getProject(db: SqliteDatabase, id: string): ProjectRecord | null {
  assertId(id)
  const row = db
    .prepare<unknown[], ProjectSql>(
      `SELECT id, name, slug, domain, db_path, client_name, status FROM projects WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : projectFromSql(row)
}

export function listProjects(db: SqliteDatabase): ProjectRecord[] {
  const rows = db
    .prepare<unknown[], ProjectSql>(
      `SELECT id, name, slug, domain, db_path, client_name, status
       FROM projects ORDER BY rowid ASC`
    )
    .all()
  return rows.map((row) => projectFromSql(row))
}

export function getProjectBySlug(db: SqliteDatabase, slug: string): ProjectRecord | null {
  const row = db
    .prepare<unknown[], ProjectSql>(
      `SELECT id, name, slug, domain, db_path, client_name, status FROM projects WHERE slug = ?`
    )
    .get(slug)
  return row === undefined ? null : projectFromSql(row)
}

export function updateProject(
  db: SqliteDatabase,
  id: string,
  patch: { name: string; domain: string; clientName?: string | null; status?: ProjectStatus }
): void {
  assertId(id)
  const existing = getProject(db, id)
  if (existing === null) throw new StorageError('Could not save project')
  const name = requireLabel(patch.name, 'project name', 200)
  const domain = requireDomain(patch.domain)
  const clientName =
    patch.clientName === undefined
      ? existing.clientName
      : requireOptionalLabel(patch.clientName, 'client name', 200)
  const status = patch.status === undefined ? existing.status : requireStatus(patch.status)
  const result = db
    .prepare(`UPDATE projects SET name = ?, domain = ?, client_name = ?, status = ? WHERE id = ?`)
    .run(name, domain, clientName, status, id)
  if (result.changes !== 1) throw new StorageError('Could not save project')
}

export function readOnboardingFinished(db: SqliteDatabase): boolean {
  const row = db
    .prepare<unknown[], { onboarding_finished: number }>(
      `SELECT onboarding_finished FROM app_state WHERE id = 1`
    )
    .get()
  if (row === undefined) return false
  return row.onboarding_finished === 1
}

export function writeOnboardingFinished(db: SqliteDatabase, finished: boolean): void {
  const result = db
    .prepare(`UPDATE app_state SET onboarding_finished = ? WHERE id = 1`)
    .run(finished ? 1 : 0)
  if (result.changes !== 1) throw new StorageError('Could not save onboarding')
}

/** Engine state. Section 10 has no current-project column. Null when none is chosen. */
export function readActiveProjectId(db: SqliteDatabase): string | null {
  const row = db
    .prepare<unknown[], { active_project_id: string | null }>(
      `SELECT active_project_id FROM app_state WHERE id = 1`
    )
    .get()
  if (row === undefined || row.active_project_id === null) return null
  return row.active_project_id
}

export function writeActiveProjectId(db: SqliteDatabase, projectId: string | null): void {
  const id = projectId === null ? null : assertId(projectId)
  const result = db.prepare(`UPDATE app_state SET active_project_id = ? WHERE id = 1`).run(id)
  if (result.changes !== 1) throw new StorageError('Could not save the active project')
}

interface ProjectSql {
  id: string
  name: string
  slug: string
  domain: string
  db_path: string
  client_name: string | null
  status: string
}

function normalizeProject(record: ProjectRecord): ProjectRecord {
  const slug = requireClean(record.slug, 'project slug')
  return {
    id: assertId(record.id),
    name: requireLabel(record.name, 'project name', 200),
    slug,
    domain: requireDomain(record.domain),
    dbPath: requireProjectPath(slug, record.dbPath),
    clientName: requireOptionalLabel(record.clientName, 'client name', 200),
    status: requireStatus(record.status)
  }
}

function projectFromSql(row: ProjectSql): ProjectRecord {
  return normalizeProject({
    id: row.id,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    dbPath: row.db_path,
    clientName: row.client_name,
    status: requireStatus(row.status)
  })
}

function requireStatus(value: string): ProjectStatus {
  if (!isProjectStatus(value)) throw new StorageError('Invalid project status')
  return value
}

function requireDomain(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253 || /\s/.test(value)) {
    throw new StorageError('Invalid domain')
  }
  if (value.includes('://') || value.includes('/') || value.includes('\\')) {
    throw new StorageError('Invalid domain')
  }
  rejectSecret(value, 'domain', true)
  return value
}

function requireProjectPath(slug: string, dbPath: string): string {
  const expected = projectDatabaseRelativePath(slug)
  if (dbPath !== expected) throw new StorageError('Invalid project database path')
  return expected
}

function requireClean(value: string, label: string): string {
  rejectSecret(value, label, true)
  return value
}
