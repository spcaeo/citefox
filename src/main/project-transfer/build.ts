import {
  PROJECT_TRANSFER_SECTIONS,
  type ProjectTransferSection,
  type ProjectTransferSectionCount
} from '@shared/ipc'
import { redactString, redactValue } from '../logging/redact'
import type { SqliteDatabase } from '../storage/database'
import type { ProjectRecord } from '../storage/records'
import {
  policyFor,
  rowContext,
  SECTION_LABELS,
  sectionOf,
  type Row,
  type TablePolicy
} from './catalog'
import { competitorCount } from './competitors'
import {
  KEYCHAIN_NOTE,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  type ProjectFile
} from './format'
import { hasCatalog, scrubRow } from './stage'
import { catalogTables, selectAll } from './schema'

/** Report schedule columns that belong to this Mac or to the project row. */
const SCHEDULE_DROPPED = new Set(['id', 'project_id', 'deleted_at'])

export interface BuildProjectFileInput {
  appDb: SqliteDatabase
  projectDb: SqliteDatabase
  project: ProjectRecord
  includeResults: boolean
  /** Exact secret values (keys in use): never written, wherever they appear. */
  secrets: readonly string[]
  appVersion: string
  now: Date
}

/** The project as a file object. Reads only; writes nothing. */
export function buildProjectFile(input: BuildProjectFileInput): ProjectFile {
  const tables: Record<string, Row[]> = {}
  for (const info of catalogTables(input.projectDb)) {
    const policy = policyFor(info.table)
    if (policy === undefined) continue
    if (policy.section === 'results' && !input.includeResults) continue
    const rows = selectAll(input.projectDb, info.table).map((row) =>
      cleanRow(policy, scrubRow(policy, row, input.includeResults), input.secrets)
    )
    if (rows.length > 0) tables[info.table] = rows
  }
  return {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_VERSION,
    appVersion: input.appVersion,
    exportedAt: input.now.toISOString(),
    schemaVersion: schemaVersion(input.projectDb),
    includesResults: input.includeResults,
    note: KEYCHAIN_NOTE,
    project: {
      name: input.project.name,
      domain: input.project.domain,
      clientName: input.project.clientName,
      status: input.project.status
    },
    tables,
    reportSchedules: reportSchedules(input.appDb, input.project.id, input.secrets)
  }
}

export function serializeProjectFile(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 1)}\n`
}

/** How many things each part holds, the way the preview and the result count them. */
export function sectionCounts(
  file: Pick<ProjectFile, 'tables' | 'reportSchedules' | 'includesResults'>
): ProjectTransferSectionCount[] {
  const context = rowContext(file.tables)
  const counts = new Map<ProjectTransferSection, number>()
  const add = (section: ProjectTransferSection, count: number): void => {
    counts.set(section, (counts.get(section) ?? 0) + count)
  }
  for (const [table, rows] of Object.entries(file.tables)) {
    const policy = policyFor(table)
    if (policy?.counts === undefined) continue
    for (const row of rows) {
      if (policy.counts(row, context)) add(sectionOf(policy, row), 1)
    }
  }
  // The settings row counts as one. Its competitor list mirrors the catalog's rows;
  // a file without a catalog counts the list one competitor at a time.
  if (!hasCatalog(file)) add('competitors', competitorCount(file.tables.project_settings?.[0]))
  add('reportSchedules', file.reportSchedules.length)
  return PROJECT_TRANSFER_SECTIONS.filter(
    (section) => section !== 'results' || file.includesResults
  ).map((section) => ({ section, label: SECTION_LABELS[section], count: counts.get(section) ?? 0 }))
}

function schemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare<unknown[], { version: number | null }>(
      'SELECT MAX(version) AS version FROM schema_migrations'
    )
    .get()
  return row?.version ?? 1
}

/** Strings lose any known secret; raw provider JSON also loses credential fields. */
function cleanRow(policy: TablePolicy, row: Row, secrets: readonly string[]): Row {
  const raw = new Set(policy.raw ?? [])
  const out: Row = {}
  for (const [column, value] of Object.entries(row)) {
    if (typeof value !== 'string') {
      out[column] = value
    } else if (raw.has(column)) {
      out[column] = rawText(value, secrets)
    } else {
      // Hashes are 64 hex characters, like a SerpApi key: keep them, mask only known values.
      out[column] = redactString(value, { secrets, hexKeys: false })
    }
  }
  return out
}

function rawText(text: string, secrets: readonly string[]): string {
  try {
    const parsed: unknown = JSON.parse(text)
    return JSON.stringify(redactValue(parsed, { secrets, hexKeys: true }))
  } catch {
    return redactString(text, { secrets, hexKeys: true })
  }
}

function reportSchedules(
  appDb: SqliteDatabase,
  projectId: string,
  secrets: readonly string[]
): Row[] {
  const rows = appDb
    .prepare<unknown[], Row>(
      `SELECT * FROM report_schedules WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at, id`
    )
    .all(projectId)
  return rows.map((row) => {
    const out: Row = {}
    for (const [column, value] of Object.entries(row)) {
      if (SCHEDULE_DROPPED.has(column)) continue
      if (column === 'account_id') {
        out[column] = null
        continue
      }
      out[column] =
        typeof value === 'string' ? redactString(value, { secrets, hexKeys: false }) : value
    }
    return out
  })
}
