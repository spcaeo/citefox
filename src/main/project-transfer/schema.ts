import type { SqliteDatabase } from '../storage/database'
import { TABLE_POLICIES, type Row } from './catalog'

/**
 * What a project database says about its own tables: columns, keys and foreign
 * keys. Table and column names come from the catalog and from `PRAGMA` only, and
 * are quoted, so no name from a file ever reaches SQL unchecked.
 */

export interface ColumnInfo {
  name: string
  type: string
  notNull: boolean
  primaryKey: number
}

export interface ForeignKey {
  /** Column in this table. */
  from: string
  /** Parent table and column. */
  table: string
  to: string
}

export interface TableInfo {
  table: string
  columns: readonly ColumnInfo[]
  columnNames: ReadonlySet<string>
  primaryKey: readonly string[]
  /** An `INTEGER PRIMARY KEY` the database numbers itself (a row counter, not a shared id). */
  rowCounter: string | null
  foreignKeys: readonly ForeignKey[]
}

export function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function tableExists(db: SqliteDatabase, table: string): boolean {
  return (
    db
      .prepare<unknown[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(table) !== undefined
  )
}

export function tableInfo(db: SqliteDatabase, table: string): TableInfo {
  const columns = db
    .prepare<unknown[], { name: string; type: string; notnull: number; pk: number }>(
      `PRAGMA table_info(${quoteName(table)})`
    )
    .all()
    .map((column) => ({
      name: column.name,
      type: column.type.toUpperCase(),
      notNull: column.notnull === 1,
      primaryKey: column.pk
    }))
  const foreignKeys = db
    .prepare<unknown[], { from: string; table: string; to: string | null }>(
      `PRAGMA foreign_key_list(${quoteName(table)})`
    )
    .all()
    .map((fk) => ({ from: fk.from, table: fk.table, to: fk.to ?? 'id' }))
  const primaryKey = columns
    .filter((column) => column.primaryKey > 0)
    .sort((left, right) => left.primaryKey - right.primaryKey)
    .map((column) => column.name)
  const only =
    primaryKey.length === 1 ? columns.find((column) => column.primaryKey === 1) : undefined
  return {
    table,
    columns,
    columnNames: new Set(columns.map((column) => column.name)),
    primaryKey,
    rowCounter: only !== undefined && only.type === 'INTEGER' ? only.name : null,
    foreignKeys
  }
}

/** The catalog tables this database has, parents before children. */
export function catalogTables(db: SqliteDatabase): TableInfo[] {
  const present = TABLE_POLICIES.map((policy) => policy.table).filter((table) =>
    tableExists(db, table)
  )
  const infos = new Map(present.map((table) => [table, tableInfo(db, table)]))
  const ordered: TableInfo[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (table: string): void => {
    if (state.get(table) !== undefined) return
    state.set(table, 'visiting')
    const info = infos.get(table)
    if (info === undefined) return
    for (const fk of info.foreignKeys) {
      if (fk.table !== table && infos.has(fk.table)) visit(fk.table)
    }
    state.set(table, 'done')
    ordered.push(info)
  }
  for (const table of present) visit(table)
  return ordered
}

export function selectAll(db: SqliteDatabase, table: string): Row[] {
  return db.prepare<unknown[], Row>(`SELECT * FROM ${quoteName(table)} ORDER BY rowid`).all()
}

/** `INSERT` for exactly these columns. */
export function insertSql(table: string, columns: readonly string[], replace = false): string {
  const verb = replace ? 'INSERT OR REPLACE' : 'INSERT'
  return `${verb} INTO ${quoteName(table)} (${columns.map(quoteName).join(', ')}) VALUES (${columns
    .map(() => '?')
    .join(', ')})`
}

/** The row's own key, for telling rows apart: the primary key, else the whole row. */
export function rowIdentity(info: TableInfo, row: Row): string {
  const columns = info.primaryKey.length > 0 ? info.primaryKey : [...info.columnNames]
  return JSON.stringify(columns.map((column) => row[column] ?? null))
}

/** A short plain reason for a SQLite constraint failure. */
export function failureReason(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return 'already in the project'
  }
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') return 'a required value is missing'
  if (code === 'SQLITE_CONSTRAINT_CHECK') return 'a value is not allowed'
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'it refers to something that is not there'
  return 'it could not be saved'
}
