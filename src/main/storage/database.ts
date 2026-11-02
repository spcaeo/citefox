import Sqlite from 'better-sqlite3'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * SQLite access for the main process.
 *
 * better-sqlite3 13 ships N-API prebuilds (`NAPI_VERSION` 10) for macOS,
 * Windows, and Linux on x64 and arm64. Vitest on Node 24 and Electron 44 load
 * the same prebuild, so neither runtime needs a rebuild, and packaging does not
 * run `@electron/rebuild` (`npmRebuild: false` in electron-builder.config.ts).
 *
 * `verbose` stays off. A trace hook would write SQL, and bound values, into logs.
 */
export type SqliteDatabase = Sqlite.Database

export function openSqliteDatabase(
  filename: string,
  options?: { fileMustExist?: boolean }
): SqliteDatabase {
  const memory = filename === ':memory:' || filename.length === 0
  if (!memory) mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const db = new Sqlite(filename, {
    fileMustExist: options?.fileMustExist ?? false
  })
  db.pragma('foreign_keys = ON')
  if (!memory) {
    db.pragma('journal_mode = WAL')
    restrictDatabaseFiles(filename)
  }
  return db
}

export function closeDatabase(db: SqliteDatabase): void {
  if (db.open) db.close()
}

export function restrictDatabaseFiles(filename: string): void {
  if (process.platform === 'win32' || filename === ':memory:' || filename.length === 0) return
  for (const candidate of [filename, `${filename}-wal`, `${filename}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600)
  }
}

interface SqliteException extends Error {
  code: string
}

export function isSqliteError(error: unknown): error is SqliteException {
  return error instanceof Sqlite.SqliteError
}

/**
 * True when `error` is a SQLite unique or primary-key constraint, including
 * when storage wrapped that error as the `cause` of a {@link StorageError}.
 * Engine 2 treats a hit as already sent (FR-23.8, FR-23.13).
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return hasUniqueConstraint(error, 0)
}

function hasUniqueConstraint(error: unknown, depth: number): boolean {
  if (depth > 5) return false
  if (isSqliteError(error)) {
    return (
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    )
  }
  if (error instanceof Error && error.cause !== undefined) {
    return hasUniqueConstraint(error.cause, depth + 1)
  }
  return false
}
