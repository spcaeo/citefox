import type { SqliteDatabase } from './database'
import type { Migration } from './migrate'

/**
 * Codex as an AI connection (Docs/AI-PROVIDERS.md). Calls made through Codex are
 * logged with `connection = 'codex'`, which the old CHECK refused.
 *
 * - App migration 024: `llm_calls` (calls outside a project).
 * - Project migration 046: `llm_calls` and `generations`. `analyses.generation_id`
 *   references `generations`, so that rebuild runs with foreign keys off and the
 *   reference check before the commit (`foreignKeysOff`).
 *
 * Each table is copied from its own stored definition with only the connection CHECK
 * widened, so the columns, other CHECKs and indexes stay exactly as they were, and
 * every row is kept. A table already widened (or missing) is left alone.
 */
export const CODEX_CONNECTION_APP_VERSION = 24
export const CODEX_CONNECTION_PROJECT_VERSION = 46

const NARROW_CHECK = /CHECK \(connection IN \('claude-code', 'anthropic-api'\)\)/
const WIDE_CHECK = "CHECK (connection IN ('claude-code', 'anthropic-api', 'codex'))"

/** Rebuilds `table` with `codex` allowed in its connection CHECK. */
export function widenConnectionCheck(db: SqliteDatabase, table: string): void {
  const row = db
    .prepare<unknown[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(table)
  if (row === undefined || !NARROW_CHECK.test(row.sql)) return
  const indexes = db
    .prepare<unknown[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL"
    )
    .all(table)
  const next = `${table}_codex`
  const create = row.sql
    .replace(NARROW_CHECK, WIDE_CHECK)
    .replace(/^CREATE TABLE\s+(?:"[^"]+"|\S+)/i, `CREATE TABLE ${next}`)
  db.exec(create)
  db.exec(`INSERT INTO ${next} SELECT * FROM ${table}`)
  db.exec(`DROP TABLE ${table}`)
  db.exec(`ALTER TABLE ${next} RENAME TO ${table}`)
  for (const index of indexes) db.exec(index.sql)
}

export const CODEX_CONNECTION_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: CODEX_CONNECTION_APP_VERSION,
    name: `${String(CODEX_CONNECTION_APP_VERSION).padStart(3, '0')}_codex_connection`,
    rebuildsTables: true,
    up(db) {
      widenConnectionCheck(db, 'llm_calls')
    }
  }
]

export const CODEX_CONNECTION_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: CODEX_CONNECTION_PROJECT_VERSION,
    name: `${String(CODEX_CONNECTION_PROJECT_VERSION).padStart(3, '0')}_codex_connection`,
    rebuildsTables: true,
    foreignKeysOff: true,
    up(db) {
      widenConnectionCheck(db, 'llm_calls')
      widenConnectionCheck(db, 'generations')
    }
  }
]
