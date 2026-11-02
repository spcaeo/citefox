import type { SqliteDatabase } from './database'
import type { Migration } from './migrate'

/**
 * Project migration 055: checks every day and every 7 days (owner, 2026-11-01).
 *
 * `pages.interval_days` and `project_schedule.default_interval_days` allowed 14, 30,
 * 60 and 90 only. Both CHECKs now also allow 1 and 7. Each table is copied from its
 * own stored definition with only that CHECK widened, so the columns, other CHECKs,
 * indexes, triggers and every row stay exactly as they were (saved intervals keep
 * their value). Other tables reference `pages`, so the rebuild runs with foreign keys
 * off and the reference check before the commit (`foreignKeysOff`). A table already
 * widened, or missing, is left alone.
 */
export const CHECK_INTERVALS_VERSION = 55

const OLD_LIST = '(14, 30, 60, 90)'
const NEW_LIST = '(1, 7, 14, 30, 60, 90)'

/** Rebuilds `table` with `column`'s interval CHECK widened to {@link NEW_LIST}. */
export function widenIntervalCheck(db: SqliteDatabase, table: string, column: string): void {
  const row = db
    .prepare<unknown[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(table)
  const narrow = `CHECK (${column} IN ${OLD_LIST})`
  if (row === undefined || !row.sql.includes(narrow)) return
  const extras = db
    .prepare<unknown[], { sql: string }>(
      `SELECT sql FROM sqlite_master
       WHERE type IN ('index', 'trigger') AND tbl_name = ? AND sql IS NOT NULL`
    )
    .all(table)
  const next = `${table}_intervals`
  const create = row.sql
    .replace(narrow, `CHECK (${column} IN ${NEW_LIST})`)
    .replace(/^CREATE TABLE\s+(?:"[^"]+"|\S+)/i, `CREATE TABLE ${next}`)
  db.exec(create)
  db.exec(`INSERT INTO ${next} SELECT * FROM ${table}`)
  db.exec(`DROP TABLE ${table}`)
  db.exec(`ALTER TABLE ${next} RENAME TO ${table}`)
  for (const extra of extras) db.exec(extra.sql)
}

export const CHECK_INTERVALS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: CHECK_INTERVALS_VERSION,
    name: `${String(CHECK_INTERVALS_VERSION).padStart(3, '0')}_check_intervals`,
    rebuildsTables: true,
    foreignKeysOff: true,
    up(db) {
      widenIntervalCheck(db, 'pages', 'interval_days')
      widenIntervalCheck(db, 'project_schedule', 'default_interval_days')
    }
  }
]
