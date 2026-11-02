import { isProjectStatus, type ProjectStatus } from '@shared/domain'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { policyFor, type Row, type Value } from './catalog'

/**
 * `.citefox-project.json`, format version 1: one project's settings and lists
 * (and, when asked, its stored check results) as rows of its project tables,
 * keyed by table. `schemaVersion` is the project database version the rows were
 * read from; an import builds a database at that version, adds the rows, then
 * upgrades it like any older project file. Nothing secret is in the file.
 */

export const PROJECT_FILE_FORMAT = 'citefox-project'
export const PROJECT_FILE_VERSION = 1
export const PROJECT_FILE_EXTENSION = '.citefox-project.json'
export const KEYCHAIN_NOTE =
  'API keys, SMTP passwords and Slack webhooks stay in the keychain of the Mac they were added on and are not in this file.'

export interface ProjectFileProject {
  name: string
  domain: string
  clientName: string | null
  status: ProjectStatus
}

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT
  formatVersion: typeof PROJECT_FILE_VERSION
  appVersion: string
  exportedAt: string
  schemaVersion: number
  includesResults: boolean
  note: string
  project: ProjectFileProject
  /** Project table → rows. Only tables in the catalog. */
  tables: Record<string, Row[]>
  /** The project's report schedules (stored app-wide), without the email account. */
  reportSchedules: Row[]
}

/** A file that is not a CiteFox project file, or one this app cannot read. */
export class TransferFileError extends Error {
  readonly nextStep: string

  constructor(
    reason: string,
    nextStep = 'Choose a .citefox-project.json file exported from CiteFox.'
  ) {
    super(reason)
    this.name = 'TransferFileError'
    this.nextStep = nextStep
  }
}

const COLUMN = /^[a-z_][a-z0-9_]{0,63}$/
const MAX_ROWS_PER_TABLE = 500_000
const MAX_TEXT = 20 * 1024 * 1024

/** Reads and checks a project file. Throws {@link TransferFileError} with a plain reason. */
export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new TransferFileError('This file is not valid JSON.')
  }
  const record = object(raw, 'This file is not a CiteFox project file.')
  if (record.format !== PROJECT_FILE_FORMAT) {
    throw new TransferFileError('This file is not a CiteFox project file.')
  }
  if (record.formatVersion !== PROJECT_FILE_VERSION) {
    const newer =
      typeof record.formatVersion === 'number' && record.formatVersion > PROJECT_FILE_VERSION
    throw new TransferFileError(
      newer
        ? 'This file was made by a newer version of CiteFox.'
        : 'This project file version is not supported.',
      newer ? 'Update CiteFox on this Mac, then import it again.' : 'Export the project again.'
    )
  }
  const schemaVersion = record.schemaVersion
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new TransferFileError('The file has no valid database version.')
  }
  if (schemaVersion > PROJECT_MIGRATIONS.length) {
    throw new TransferFileError(
      'This file was made by a newer version of CiteFox.',
      'Update CiteFox on this Mac, then import it again.'
    )
  }
  if (typeof record.includesResults !== 'boolean') {
    throw new TransferFileError('The file does not say whether it holds check results.')
  }
  return {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_VERSION,
    appVersion: shortText(record.appVersion, 'app version', 40),
    exportedAt: shortText(record.exportedAt, 'export date', 40),
    schemaVersion,
    includesResults: record.includesResults,
    note: typeof record.note === 'string' ? record.note.slice(0, 400) : KEYCHAIN_NOTE,
    project: readProject(record.project),
    tables: readTables(record.tables, record.includesResults),
    reportSchedules: readRows(record.reportSchedules ?? [], 'reportSchedules')
  }
}

function readProject(value: unknown): ProjectFileProject {
  const record = object(value, 'The file has no project name or site.')
  const name = shortText(record.name, 'project name', 200)
  const domain = shortText(record.domain, 'site', 253)
  const clientName =
    record.clientName === null || record.clientName === undefined
      ? null
      : shortText(record.clientName, 'client name', 200)
  const status = record.status ?? 'active'
  if (typeof status !== 'string' || !isProjectStatus(status)) {
    throw new TransferFileError('The project status in the file is not valid.')
  }
  return { name, domain, clientName, status }
}

function readTables(value: unknown, includesResults: boolean): Record<string, Row[]> {
  const record = object(value, 'The file has no project tables.')
  const tables: Record<string, Row[]> = {}
  for (const [table, rows] of Object.entries(record)) {
    const policy = policyFor(table)
    if (policy === undefined) {
      throw new TransferFileError(
        `The file has a part CiteFox does not know (${table.slice(0, 40)}).`
      )
    }
    if (policy.section === 'results' && !includesResults) {
      throw new TransferFileError('The file holds check results but says it does not.')
    }
    tables[table] = readRows(rows, table)
  }
  if ((tables.project_settings ?? []).length !== 1) {
    throw new TransferFileError('The file has no project settings.')
  }
  if ((tables.markets ?? []).length === 0) {
    throw new TransferFileError('The file has no markets.')
  }
  return tables
}

function readRows(value: unknown, table: string): Row[] {
  if (!Array.isArray(value)) throw new TransferFileError(`The ${label(table)} list is not a list.`)
  if (value.length > MAX_ROWS_PER_TABLE) {
    throw new TransferFileError(`The ${label(table)} list is too long.`)
  }
  return value.map((item) => {
    const record = object(item, `A row in the ${label(table)} list is not valid.`)
    const row: Row = {}
    for (const [column, cell] of Object.entries(record)) {
      if (!COLUMN.test(column)) {
        throw new TransferFileError(`A row in the ${label(table)} list has an unknown field.`)
      }
      row[column] = readCell(cell, table)
    }
    return row
  })
}

function readCell(value: unknown, table: string): Value {
  if (value === null) return null
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT)
      throw new TransferFileError(`A value in ${label(table)} is too long.`)
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  throw new TransferFileError(`A value in the ${label(table)} list is not valid.`)
}

function label(table: string): string {
  return table.replace(/_/g, ' ')
}

function object(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransferFileError(reason)
  }
  return value as Record<string, unknown>
}

function shortText(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new TransferFileError(`The ${what} in the file is not valid.`)
  }
  return value
}
