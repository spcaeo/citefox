import { rmSync } from 'node:fs'
import { closeDatabase, type SqliteDatabase } from './database'

/** Shared tracking and schema readers for the migration tests. */

const openDatabases: SqliteDatabase[] = []
/** Temp directories a test made. `closeTracked` removes them. */
export const directories: string[] = []

/** Call from `afterEach`. Closes every tracked database and removes tracked directories. */
export function closeTracked(): void {
  for (const db of openDatabases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export function track(db: SqliteDatabase): SqliteDatabase {
  openDatabases.push(db)
  return db
}

export function tableNames(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    .all()
    .map((row) => row.name)
}

export interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

export function columns(db: SqliteDatabase, table: string): ColumnInfo[] {
  return db.prepare<unknown[], ColumnInfo>(`PRAGMA table_info(${table})`).all()
}

export function column(db: SqliteDatabase, table: string, name: string): ColumnInfo | undefined {
  return columns(db, table).find((item) => item.name === name)
}

export function tableSql(db: SqliteDatabase, table: string): string {
  const row = db
    .prepare<unknown[], { sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
    )
    .get(table)
  if (row === undefined) throw new Error(`missing table ${table}`)
  return row.sql
}

export function checkClauses(sql: string): string[] {
  const found: string[] = []
  const pattern = /CHECK \((?:[^()]|\([^()]*\))*\)/g
  for (const match of sql.matchAll(pattern)) found.push(match[0].replace(/\s+/g, ' '))
  return found.sort()
}

export interface ForeignKeyRow {
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
}

export function foreignKeys(db: SqliteDatabase, table: string): ForeignKeyRow[] {
  return db
    .prepare<unknown[], ForeignKeyRow>(`PRAGMA foreign_key_list(${table})`)
    .all()
    .map((row) => ({
      table: row.table,
      from: row.from,
      to: row.to,
      on_update: row.on_update,
      on_delete: row.on_delete
    }))
    .sort((left, right) => left.from.localeCompare(right.from))
}

export function indexSql(db: SqliteDatabase, table: string): { name: string; sql: string }[] {
  return db
    .prepare<unknown[], { name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
       ORDER BY name`
    )
    .all(table)
}

export function applied(db: SqliteDatabase): { version: number; name: string }[] {
  return db
    .prepare<unknown[], { version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version'
    )
    .all()
}
