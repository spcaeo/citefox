import { existsSync } from 'node:fs'
import type { ExportSpec } from '@shared/domain'
import type { Logger } from '../../logging/logger'
import type { AppStorage } from '../../storage/app-storage'
import {
  listAutoExportRows,
  recordAutoExportRun,
  type AutoExportRow,
  type AutoExportRunRow
} from '../../storage/auto-exports'
import type { SqliteDatabase } from '../../storage/database'
import { projectDatabasePool } from '../../storage/project-db-pool'
import { getProject } from '../../storage/records'
import { storageReportBuilders } from '../report-builders'
import { startExport } from '../service'
import { createStorageExportSource } from '../source'
import { freshExportPath, usableExportFolder } from './folder'
import { autoExportRequest, parseAutoExportSpec } from './spec'

/** Pages of one project that a scheduled check finished in this pass. */
export interface CheckedProjectPages {
  projectId: string
  pageIds: ReadonlySet<string>
}

export interface AutoExportRunDeps {
  storage: AppStorage
  now: () => Date
  createId: () => string
  knownSecrets: () => readonly string[]
  logger?: Logger
  /** Test seam for the "never replace a file" rule. */
  exists?: (filePath: string) => boolean
}

const FOLDER_GONE = {
  reason: 'The export folder is missing or CiteFox cannot write to it.',
  nextStep: 'Open Export and choose the folder again.'
}

const SETTINGS_BAD = {
  reason: "The saved export settings can't be repeated.",
  nextStep: 'Open Export, check the settings, and save them again.'
}

const NAMES_TAKEN = {
  reason: 'Too many files with that name are already in the folder.',
  nextStep: 'Move older exports out of the folder, or change the filename pattern.'
}

/**
 * FR-22.6. Runs every enabled automatic export that the pass's scheduled checks
 * touch: a project, selected-pages or saved-view spec when any page of its project
 * was checked, a page spec when that page was checked. Each spec runs once per
 * pass, writes one new file into its dialog-chosen folder (never replacing an
 * earlier one), and records one `auto_export_runs` row. A failure is recorded,
 * logged and never thrown, so the pass and the other exports carry on.
 */
export async function runAutoExports(
  deps: AutoExportRunDeps,
  checked: readonly CheckedProjectPages[]
): Promise<AutoExportRunRow[]> {
  const results: AutoExportRunRow[] = []
  for (const item of checked) {
    if (item.pageIds.size === 0) continue
    const project = getProject(deps.storage.db, item.projectId)
    if (project === null) continue
    let db: SqliteDatabase
    let rows: AutoExportRow[]
    try {
      db = projectDatabasePool(deps.storage).get(project.slug)
      rows = listAutoExportRows(db)
    } catch (error: unknown) {
      deps.logger?.error('CiteFox could not read automatic exports', error)
      continue
    }
    for (const row of rows) {
      if (!row.enabled || row.destination !== 'folder') continue
      const spec = storedSpec(row, item.projectId)
      if (spec !== null && !touches(spec, item.pageIds)) continue
      const run = await runOne(deps, item.projectId, row, spec)
      try {
        recordAutoExportRun(db, run)
      } catch (error: unknown) {
        deps.logger?.error('CiteFox could not record an automatic export', error)
      }
      results.push(run)
    }
  }
  return results
}

function storedSpec(row: AutoExportRow, projectId: string): ExportSpec | null {
  if (row.specJson === null) return null
  try {
    return parseAutoExportSpec(JSON.parse(row.specJson), projectId)
  } catch {
    return null
  }
}

function touches(spec: ExportSpec, checked: ReadonlySet<string>): boolean {
  if (spec.scope === 'project' || spec.scope === 'view') return true
  return spec.pageIds.some((pageId) => checked.has(pageId))
}

async function runOne(
  deps: AutoExportRunDeps,
  projectId: string,
  row: AutoExportRow,
  spec: ExportSpec | null
): Promise<AutoExportRunRow> {
  const startedAt = deps.now().toISOString()
  const base = {
    id: deps.createId(),
    scopeKey: row.scopeKey,
    startedAt,
    format: spec?.format ?? 'pdf'
  }
  const failed = (problem: { reason: string; nextStep: string | null }): AutoExportRunRow => ({
    ...base,
    finishedAt: deps.now().toISOString(),
    outcome: 'failed',
    filename: null,
    bytes: null,
    reason: problem.reason,
    nextStep: problem.nextStep
  })
  if (spec === null) return failed(SETTINGS_BAD)
  const folder = row.folder
  if (!usableExportFolder(folder)) return failed(FOLDER_GONE)
  let namesTaken = false
  try {
    const exists = deps.exists ?? existsSync
    const result = await startExport({
      request: autoExportRequest(spec),
      source: createStorageExportSource({
        app: deps.storage.db,
        projectsDirectory: deps.storage.paths.projectsDirectory,
        now: deps.now
      }),
      directory: folder,
      secrets: deps.knownSecrets(),
      now: deps.now,
      builders: storageReportBuilders(
        {
          app: deps.storage.db,
          projectsDirectory: deps.storage.paths.projectsDirectory,
          now: deps.now,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {})
        },
        projectId
      ),
      createId: deps.createId,
      // Same `{project}-{page}-{date}.{ext}` name as a save-dialog export, made unique.
      chooseOutputPath: async (filename) => {
        const path = freshExportPath(folder, filename, exists)
        if (path === null) namesTaken = true
        return path
      }
    })
    if (!result.ok) {
      return failed(namesTaken ? NAMES_TAKEN : { reason: result.reason, nextStep: result.nextStep })
    }
    return {
      ...base,
      finishedAt: deps.now().toISOString(),
      outcome: 'ok',
      filename: result.filename,
      bytes: result.bytes,
      reason: null,
      nextStep: null
    }
  } catch (error: unknown) {
    deps.logger?.error('CiteFox could not write an automatic export', error)
    return failed({
      reason: 'Could not write the export file.',
      nextStep: 'Check that the folder is writable.'
    })
  }
}
