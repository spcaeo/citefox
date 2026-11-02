import { TRAY_MENU_CHECK_LIMIT } from '@shared/domain'
import type { TrayLastCheck } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, requireLabel, requireUtcTimestamp } from './values'

/**
 * FR-24.6. One row per finished check the tray menu can list.
 * The menu shows the latest {@link TRAY_MENU_CHECK_LIMIT} (5). The SRS states
 * no retention cap, so append does not delete older rows. Pass a limit to
 * {@link listRecentTrayChecks} to read more than the menu shows.
 */
export interface TrayCheckRecord extends TrayLastCheck {
  id: string
}

export function appendTrayCheck(db: SqliteDatabase, record: TrayCheckRecord): void {
  const row = normalizeTrayCheck(record)
  try {
    db.prepare(
      `INSERT INTO tray_history (id, project_id, page_id, label, score, "change", finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.projectId, row.pageId, row.label, row.score, row.change, row.finishedAt)
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new StorageError('This tray check already exists')
      }
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new StorageError('Could not save tray check: referenced row is missing')
      }
      throw new StorageError('Could not save tray check')
    }
    throw error
  }
}

/** Newest finished check first. Defaults to the tray menu size. Does not delete rows. */
export function listRecentTrayChecks(
  db: SqliteDatabase,
  limit = TRAY_MENU_CHECK_LIMIT
): TrayLastCheck[] {
  const count = requireLimit(limit)
  if (count === 0) return []
  return db
    .prepare<unknown[], TraySql>(
      `SELECT project_id, page_id, label, score, "change", finished_at
       FROM tray_history
       ORDER BY finished_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(count)
    .map(trayFromSql)
}

interface TraySql {
  project_id: string
  page_id: string
  label: string
  score: number | null
  change: number | null
  finished_at: string
}

function trayFromSql(row: TraySql): TrayLastCheck {
  return {
    projectId: row.project_id,
    pageId: row.page_id,
    label: row.label,
    score: row.score,
    change: row.change,
    finishedAt: row.finished_at
  }
}

function normalizeTrayCheck(record: TrayCheckRecord): TrayCheckRecord {
  return {
    id: assertId(record.id),
    projectId: assertId(record.projectId),
    pageId: assertId(record.pageId),
    label: requireLabel(record.label, 'tray label', 300),
    score: requireScore(record.score),
    change: requireChange(record.change),
    finishedAt: requireUtcTimestamp(record.finishedAt)
  }
}

function requireScore(value: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new StorageError('Invalid tray score')
  }
  return value
}

function requireChange(value: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -100 || value > 100) {
    throw new StorageError('Invalid tray change')
  }
  return value
}

function requireLimit(value: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw new StorageError('Invalid tray history limit')
  }
  return value
}
