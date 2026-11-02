import { chmodSync, existsSync, rmSync } from 'node:fs'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'

export interface Migration {
  /** Positive integer. Versions start at 1 and increase by one. */
  version: number
  name: string
  /**
   * True when `up` copies a table into a new one and drops the old one.
   * Before such a migration runs on an existing file, a copy of the database is
   * kept beside it (`<file>.before-migration`), replacing the previous copy.
   */
  rebuildsTables?: boolean
  /**
   * True when `up` rebuilds a table that other tables reference (SQLite's
   * twelve-step ALTER procedure). Foreign keys are switched off outside the
   * transaction, `PRAGMA foreign_key_check` must come back empty before the
   * commit, and the previous setting is restored afterwards. Dropping the old
   * parent table then runs no cascade and no implicit delete check. A reference
   * that was already broken before the migration (an old file written with
   * foreign keys off) does not block it; only a newly broken one does.
   */
  foreignKeysOff?: boolean
  up(db: SqliteDatabase): void
}

/** Suffix of the copy kept before a table-rebuilding migration. Only the last one is kept. */
export const MIGRATION_BACKUP_SUFFIX = '.before-migration'

/**
 * Apply `migrations` in version order. Each one runs in a transaction together
 * with its `schema_migrations` row, so a failure leaves the database unchanged.
 * A version that is already recorded is skipped, which makes a rerun a no-op.
 * There is no down migration. A database from a newer app is refused.
 */
export function migrate(db: SqliteDatabase, migrations: readonly Migration[]): void {
  const ordered = assertMigrationList(migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
  const appliedRows = db
    .prepare<unknown[], { version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    )
    .all()
  const applied = new Set<number>()
  let highestApplied = 0
  for (const row of appliedRows) {
    if (typeof row.version !== 'number' || !Number.isInteger(row.version)) {
      throw new StorageError('schema_migrations has a non-integer version')
    }
    applied.add(row.version)
    if (row.version > highestApplied) highestApplied = row.version
  }
  const latest = ordered[ordered.length - 1]
  const latestKnown = latest === undefined ? 0 : latest.version
  if (highestApplied > latestKnown) {
    throw new StorageError('Database is newer than this app and cannot be opened')
  }

  const pending = ordered.filter((migration) => !applied.has(migration.version))
  if (applied.size > 0 && pending.some((migration) => migration.rebuildsTables === true)) {
    backupBeforeMigration(db)
  }

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  )
  const apply = db.transaction((migration: Migration) => {
    const before = migration.foreignKeysOff === true ? foreignKeyProblems(db) : null
    migration.up(db)
    if (before !== null) assertNoNewForeignKeyProblems(db, migration, before)
    insert.run(migration.version, migration.name, new Date().toISOString())
  })

  for (const migration of ordered) {
    if (applied.has(migration.version)) continue
    if (highestApplied > migration.version) {
      throw new StorageError(
        `Migration ${migration.version} (${migration.name}) is missing and a later migration is already applied`
      )
    }
    if (migration.foreignKeysOff === true) applyWithForeignKeysOff(db, () => apply(migration))
    else apply(migration)
  }
}

/** `PRAGMA foreign_keys` is a no-op inside a transaction, so it is switched here. */
function applyWithForeignKeysOff(db: SqliteDatabase, run: () => void): void {
  const before = db.pragma('foreign_keys', { simple: true }) === 1
  db.pragma('foreign_keys = OFF')
  try {
    run()
  } finally {
    if (before) db.pragma('foreign_keys = ON')
  }
}

interface ForeignKeyProblem {
  table: string
  rowid: number | null
  parent: string
  fkid: number
}

function foreignKeyProblems(db: SqliteDatabase): Set<string> {
  return new Set(
    db
      .prepare<unknown[], ForeignKeyProblem>('PRAGMA foreign_key_check')
      .all()
      .map((row) => `${row.table}|${String(row.rowid)}|${row.parent}|${row.fkid}`)
  )
}

function assertNoNewForeignKeyProblems(
  db: SqliteDatabase,
  migration: Migration,
  before: ReadonlySet<string>
): void {
  const added = [...foreignKeyProblems(db)].filter((key) => !before.has(key))
  if (added.length > 0) {
    throw new StorageError(
      `Migration ${migration.version} (${migration.name}) would break ${added.length} foreign key reference(s)`
    )
  }
}

/**
 * A consistent copy of a file database (`VACUUM INTO`), made outside any
 * transaction. In-memory databases are skipped. The copy is owner-only.
 */
function backupBeforeMigration(db: SqliteDatabase): void {
  const file = db.name
  if (db.memory || file.length === 0 || file === ':memory:') return
  const target = `${file}${MIGRATION_BACKUP_SUFFIX}`
  try {
    if (existsSync(target)) rmSync(target, { force: true })
    db.prepare('VACUUM INTO ?').run(target)
    if (process.platform !== 'win32') chmodSync(target, 0o600)
  } catch (error) {
    throw new StorageError('Could not back up the database before upgrading it', { cause: error })
  }
}

function assertMigrationList(migrations: readonly Migration[]): readonly Migration[] {
  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  for (let index = 0; index < ordered.length; index += 1) {
    const migration = ordered[index]
    if (migration === undefined) throw new StorageError('Missing migration')
    if (!Number.isInteger(migration.version) || migration.version !== index + 1) {
      throw new StorageError('Migration versions must be contiguous and start at 1')
    }
    if (migration.name.trim().length === 0) {
      throw new StorageError(`Migration ${migration.version} is missing a name`)
    }
  }
  return ordered
}
