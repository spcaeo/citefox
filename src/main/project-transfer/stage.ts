import type { SqliteDatabase } from '../storage/database'
import { migrate } from '../storage/migrate'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { readProjectProfile } from '../storage/project-profile'
import {
  nounOf,
  policyFor,
  rowContext,
  sectionOf,
  type Row,
  type RowContext,
  type TablePolicy
} from './catalog'
import { mergeSettingsLists } from './competitors'
import { TransferFileError, type ProjectFile } from './format'
import { catalogTables, failureReason, insertSql, quoteName, type TableInfo } from './schema'
import { ImportTallies } from './tallies'

/**
 * Builds a project database from a project file. The database starts at the
 * file's version, takes the rows (duplicates in the file skipped, a row that
 * breaks a rule left out with its reason), then upgrades to this app's version
 * the way any older project file does. Used as the new project's own file
 * (Import as new) and as the source a Replace merges from.
 */

/** `table.column` → values of rows left out, so the rows that belong to them follow. */
type LeftValues = Map<string, Set<string>>

function mark(left: LeftValues, info: TableInfo, row: Row): void {
  for (const column of info.columnNames) {
    const value = row[column]
    if (value === null || value === undefined) continue
    const key = `${info.table}.${column}`
    let set = left.get(key)
    if (set === undefined) {
      set = new Set()
      left.set(key, set)
    }
    set.add(String(value))
  }
}

function hits(
  left: LeftValues,
  info: TableInfo,
  row: Row
): TableInfo['foreignKeys'][number] | null {
  for (const fk of info.foreignKeys) {
    const value = row[fk.from]
    if (value === null || value === undefined) continue
    if (left.get(`${fk.table}.${fk.to}`)?.has(String(value))) return fk
  }
  return null
}

/** The row as written: local values replaced, result links cleared when results are left out. */
export function scrubRow(policy: TablePolicy, row: Row, includesResults: boolean): Row {
  const next: Row = { ...row }
  for (const [column, value] of Object.entries(policy.local ?? {})) {
    if (column in next) next[column] = value
  }
  if (!includesResults) {
    for (const [column, value] of Object.entries(policy.resultLinks ?? {})) {
      if (column in next) next[column] = value
    }
  }
  return next
}

/** An imported row never carries an email address or switch from the file (see `onImport`). */
export function quietRow(policy: TablePolicy, row: Row): Row {
  const next: Row = { ...row }
  for (const [column, value] of Object.entries(policy.onImport ?? {})) {
    if (column in next) next[column] = value
  }
  return next
}

function parentNoun(table: string): string {
  const policy = policyFor(table)
  if (policy === undefined) return 'row'
  return typeof policy.noun === 'string' ? policy.noun : table === 'pages' ? 'page' : 'row'
}

/** True when the file has the product catalog's competitor rows (the list mirrors them). */
export function hasCatalog(file: Pick<ProjectFile, 'tables'>): boolean {
  return (file.tables.product_competitors ?? []).length > 0
}

export interface StageOutcome {
  tallies: ImportTallies
  context: RowContext
}

export function stageProjectFile(db: SqliteDatabase, file: ProjectFile): StageOutcome {
  migrate(db, PROJECT_MIGRATIONS.slice(0, file.schemaVersion))
  const ordered = catalogTables(db)
  const infos = new Map(ordered.map((info) => [info.table, info]))
  for (const [table, rows] of Object.entries(file.tables)) {
    const info = infos.get(table)
    if (info === undefined) {
      throw new TransferFileError(
        `The file has a part this database version does not have (${table}).`
      )
    }
    for (const row of rows) {
      for (const column of Object.keys(row)) {
        if (!info.columnNames.has(column)) {
          throw new TransferFileError(`A row in ${table.replace(/_/g, ' ')} has an unknown field.`)
        }
      }
    }
  }
  const context = rowContext(file.tables)
  const tallies = new ImportTallies()
  const skipped: LeftValues = new Map()
  const failed: LeftValues = new Map()
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const info of ordered) {
        const policy = policyFor(info.table)
        const rows = file.tables[info.table]
        if (policy === undefined || rows === undefined) continue
        insertRows(db, info, policy, rows, { file, context, tallies, skipped, failed })
      }
      removeBrokenLinks(db, infos, tallies, context)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
  migrate(db, PROJECT_MIGRATIONS)
  if (readProjectProfile(db) === null) {
    throw new TransferFileError('The file has no project settings or no default market.')
  }
  return { tallies, context }
}

interface InsertState {
  file: ProjectFile
  context: RowContext
  tallies: ImportTallies
  skipped: LeftValues
  failed: LeftValues
}

function insertRows(
  db: SqliteDatabase,
  info: TableInfo,
  policy: TablePolicy,
  rows: readonly Row[],
  state: InsertState
): void {
  const seen = new Set<string>()
  for (const original of rows) {
    let row = quietRow(policy, scrubRow(policy, original, state.file.includesResults))
    if (info.table === 'project_settings') {
      row = mergeSettingsLists(row, null, state.tallies, !hasCatalog(state.file))
    }
    const section = sectionOf(policy, row)
    const noun = nounOf(policy, row)
    const counted = policy.counts?.(row, state.context) ?? false
    const skippedParent = hits(state.skipped, info, row)
    if (skippedParent !== null) {
      mark(state.skipped, info, row)
      state.tallies.left(
        section,
        'skipped',
        noun,
        `its ${parentNoun(skippedParent.table)} was a duplicate`,
        counted
      )
      continue
    }
    const failedParent = hits(state.failed, info, row)
    if (failedParent !== null) {
      mark(state.failed, info, row)
      state.tallies.left(
        section,
        'failed',
        noun,
        `its ${parentNoun(failedParent.table)} was not added`,
        counted
      )
      continue
    }
    const key = policy.key?.(row, state.context) ?? null
    if (key !== null) {
      if (seen.has(key)) {
        mark(state.skipped, info, row)
        state.tallies.left(section, 'skipped', noun, 'listed twice in the file', counted)
        continue
      }
      seen.add(key)
    }
    const columns = Object.keys(row)
    try {
      db.prepare(insertSql(info.table, columns, policy.singleton === true)).run(
        columns.map((column) => row[column] ?? null)
      )
      if (counted && info.table !== 'project_settings') state.tallies.added(section)
      if (info.table === 'project_settings') state.tallies.added('settings')
    } catch (error) {
      mark(state.failed, info, row)
      state.tallies.left(section, 'failed', noun, failureReason(error), counted)
    }
  }
}

/**
 * Rows that point at something the file does not have. An optional link is
 * cleared; a row that cannot stand without its parent is left out.
 */
function removeBrokenLinks(
  db: SqliteDatabase,
  infos: ReadonlyMap<string, TableInfo>,
  tallies: ImportTallies,
  context: RowContext
): void {
  for (let pass = 0; pass < 20; pass += 1) {
    const problems = db
      .prepare<unknown[], { table: string; rowid: number | null; parent: string; fkid: number }>(
        'PRAGMA foreign_key_check'
      )
      .all()
    if (problems.length === 0) return
    for (const problem of problems) {
      const info = infos.get(problem.table)
      if (info === undefined || problem.rowid === null) continue
      const fk = db
        .prepare<unknown[], { id: number; from: string }>(
          `PRAGMA foreign_key_list(${quoteName(problem.table)})`
        )
        .all()
        .find((item) => item.id === problem.fkid)
      const column = fk ? info.columns.find((item) => item.name === fk.from) : undefined
      if (column !== undefined && !column.notNull) {
        db.prepare(
          `UPDATE ${quoteName(problem.table)} SET ${quoteName(column.name)} = NULL WHERE rowid = ?`
        ).run(problem.rowid)
        continue
      }
      const row = db
        .prepare<unknown[], Row>(`SELECT * FROM ${quoteName(problem.table)} WHERE rowid = ?`)
        .get(problem.rowid)
      db.prepare(`DELETE FROM ${quoteName(problem.table)} WHERE rowid = ?`).run(problem.rowid)
      const policy = policyFor(problem.table)
      if (policy === undefined || row === undefined) continue
      const counted = policy.counts?.(row, context) ?? false
      if (counted) tallies.added(sectionOf(policy, row), -1)
      tallies.left(
        sectionOf(policy, row),
        'failed',
        nounOf(policy, row),
        `its ${parentNoun(problem.parent)} is not in the file`,
        counted
      )
    }
  }
}
