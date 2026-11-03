import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ExportProjectRequest,
  ExportProjectResult,
  ImportProjectRequest,
  ProjectImportPreview,
  ProjectImportResult,
  ProjectTransferSummary,
  SameSiteProject,
  TransferPickResult
} from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { openOwned } from '../engine/project-db'
import { allocateProjectSlug } from '../engine/slug'
import { checkCatalogCache } from '../headless/catalog-cache'
import { IpcRequestError } from '../ipc-request'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { MIGRATION_BACKUP_SUFFIX } from '../storage/migrate'
import { getProject, insertProject, listProjects } from '../storage/records'
import { projectDatabasePath, projectDatabaseRelativePath } from '../storage/slug'
import { buildProjectFile, sectionCounts, serializeProjectFile } from './build'
import { normalDomain, type Row } from './catalog'
import { openText, saveText, TokenStore } from './dialogs'
import {
  PROJECT_FILE_EXTENSION,
  parseProjectFile,
  TransferFileError,
  type ProjectFile
} from './format'
import { mergeProject } from './merge'
import { insertSql, quoteName } from './schema'
import { hasCatalog, stageProjectFile } from './stage'
import type { ImportTallies } from './tallies'

/**
 * Export a project to one `.citefox-project.json` file, and import such a file
 * as a new project or into the project with the same site (Replace). The
 * picked file stays in main behind a token; its import result stays with it,
 * so the drawer's URL alone shows the same preview or result again.
 */

export type TransferHost = EngineHost & { appInfo: () => { version: string } }

interface PickedProjectFile {
  filename: string
  file: ProjectFile
  result: ProjectImportResult | null
}

const FILTER = { name: 'CiteFox project', extensions: ['json'] }

export interface ProjectTransferService {
  summary: (projectId: string) => ProjectTransferSummary
  exportProject: (request: ExportProjectRequest) => Promise<ExportProjectResult>
  pick: () => Promise<TransferPickResult>
  preview: (token: string) => ProjectImportPreview
  importProject: (request: ImportProjectRequest) => ProjectImportResult
}

export function createProjectTransferService(host: TransferHost): ProjectTransferService {
  const picked = new TokenStore<PickedProjectFile>()

  function summary(projectId: string): ProjectTransferSummary {
    const opened = openOwned(host, projectId, 'transfer:projectSummary')
    try {
      const file = build(opened.project.id, opened.db, false)
      const checks = opened.db
        .prepare<unknown[], { total: number }>('SELECT COUNT(*) AS total FROM runs')
        .get()
      return {
        projectId,
        name: opened.project.name,
        domain: opened.project.domain,
        sections: sectionCounts(file),
        checkCount: checks?.total ?? 0
      }
    } finally {
      opened.close()
    }
  }

  function build(projectId: string, db: SqliteDatabase, includeResults: boolean): ProjectFile {
    const project = getProject(host.storage.db, projectId)
    if (project === null)
      throw new IpcRequestError('transfer:exportProject', 'That project was not found')
    return buildProjectFile({
      appDb: host.storage.db,
      projectDb: db,
      project,
      includeResults,
      secrets: host.knownSecrets(),
      appVersion: host.appInfo().version,
      now: host.now()
    })
  }

  async function exportProject(request: ExportProjectRequest): Promise<ExportProjectResult> {
    const opened = openOwned(host, request.projectId, 'transfer:exportProject')
    let file: ProjectFile
    try {
      file = build(opened.project.id, opened.db, request.includeResults)
    } finally {
      opened.close()
    }
    const saved = await saveText(
      {
        title: 'Export project',
        defaultName: `${opened.project.slug}${PROJECT_FILE_EXTENSION}`,
        filter: FILTER
      },
      serializeProjectFile(file)
    )
    if (!saved.ok) return saved
    return { ...saved, sections: sectionCounts(file) }
  }

  async function pick(): Promise<TransferPickResult> {
    const read = await openText({ title: 'Import a project', filter: FILTER })
    if (!read.ok) return read
    try {
      const file = parseProjectFile(read.text)
      // A dry run in memory: every row is checked against its table before anything is shown.
      const trial = openSqliteDatabase(':memory:')
      try {
        stageProjectFile(trial, file)
      } finally {
        closeDatabase(trial)
      }
      return {
        ok: true,
        token: picked.add({ filename: read.filename, file, result: null }),
        filename: read.filename
      }
    } catch (error) {
      if (error instanceof TransferFileError) {
        return {
          ok: false,
          cancelled: false,
          reason: `${read.filename}: ${error.message}`,
          nextStep: error.nextStep
        }
      }
      throw error
    }
  }

  function entry(token: string, channel: string): PickedProjectFile {
    const found = picked.get(token)
    if (found === undefined) {
      throw new IpcRequestError(channel, 'That file is no longer open', 'Choose the file again.')
    }
    return found
  }

  function sameSite(domain: string): SameSiteProject[] {
    const wanted = normalDomain(domain)
    return listProjects(host.storage.db)
      .filter((project) => normalDomain(project.domain) === wanted)
      .map((project) => ({ projectId: project.id, name: project.name }))
  }

  function preview(token: string): ProjectImportPreview {
    const found = entry(token, 'transfer:projectPreview')
    const { file } = found
    const result =
      found.result !== null && getProject(host.storage.db, found.result.projectId) !== null
        ? found.result
        : null
    return {
      token,
      filename: found.filename,
      formatVersion: file.formatVersion,
      schemaVersion: file.schemaVersion,
      appVersion: file.appVersion,
      exportedAt: file.exportedAt,
      project: {
        name: file.project.name,
        domain: file.project.domain,
        clientName: file.project.clientName
      },
      includesResults: file.includesResults,
      sections: sectionCounts(file),
      sameSite: sameSite(file.project.domain),
      result
    }
  }

  function importProject(request: ImportProjectRequest): ProjectImportResult {
    const channel = 'transfer:importProject'
    const found = entry(request.token, channel)
    let result: ProjectImportResult
    try {
      result =
        request.mode === 'new'
          ? importAsNew(found.file)
          : replaceProject(found.file, request.replaceProjectId, channel)
    } catch (error) {
      if (error instanceof TransferFileError)
        throw new IpcRequestError(channel, error.message, error.nextStep)
      throw error
    }
    found.result = result
    checkCatalogCache(host.storage).invalidate()
    return result
  }

  function importAsNew(file: ProjectFile): ProjectImportResult {
    const channel = 'transfer:importProject'
    const name = freeName(file.project.name)
    const directory = host.storage.paths.projectsDirectory
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const slug = allocateProjectSlug(host.storage.db, directory, name, file.project.domain, channel)
    const path = projectDatabasePath(directory, slug)
    const id = host.createId()
    const db = openSqliteDatabase(path)
    let inserted = false
    try {
      const staged = stageProjectFile(db, file)
      insertProject(host.storage.db, {
        id,
        name,
        slug,
        domain: file.project.domain,
        dbPath: projectDatabaseRelativePath(slug),
        clientName: file.project.clientName,
        status: file.project.status
      })
      inserted = true
      addSchedules(file.reportSchedules, id, staged.tallies, [])
      closeDatabase(db)
      rmSync(`${path}${MIGRATION_BACKUP_SUFFIX}`, { force: true })
      return {
        mode: 'new',
        projectId: id,
        projectName: name,
        sections: staged.tallies.results(present(file)),
        undoable: true
      }
    } catch (error) {
      if (inserted) host.storage.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      closeDatabase(db)
      for (const suffix of ['', '-wal', '-shm', MIGRATION_BACKUP_SUFFIX])
        rmSync(`${path}${suffix}`, { force: true })
      throw error
    }
  }

  function replaceProject(
    file: ProjectFile,
    projectId: string | null,
    channel: string
  ): ProjectImportResult {
    if (projectId === null) throw new IpcRequestError(channel, 'Choose the project to replace')
    const project = getProject(host.storage.db, projectId)
    if (project === null) throw new IpcRequestError(channel, 'That project was not found')
    if (normalDomain(project.domain) !== normalDomain(file.project.domain)) {
      throw new IpcRequestError(
        channel,
        `${project.name} is for another site`,
        'Import the file as a new project.'
      )
    }
    const folder = join(host.storage.paths.root, 'transfer')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const stagePath = join(folder, `stage-${host.createId().replace(/[^a-zA-Z0-9-]/g, '')}.sqlite`)
    const staged = openSqliteDatabase(stagePath)
    try {
      const outcome = stageProjectFile(staged, file)
      const tallies = outcome.tallies.withoutAdded()
      const target = openOwned(host, project.id, channel)
      try {
        const running = target.db
          .prepare<unknown[], { total: number }>(
            `SELECT COUNT(*) AS total FROM check_jobs WHERE status = 'running'`
          )
          .get()
        if ((running?.total ?? 0) > 0) {
          throw new IpcRequestError(
            channel,
            'A check is running for this project',
            'Wait for it to finish, then import again.'
          )
        }
        mergeProject({
          staged,
          target: target.db,
          tallies,
          context: outcome.context,
          fileTables: new Set(Object.keys(file.tables)),
          countFlatCompetitors: !hasCatalog(file)
        })
      } finally {
        target.close()
      }
      const existing = host.storage.db
        .prepare<unknown[], { name: string }>(
          'SELECT name FROM report_schedules WHERE project_id = ? AND deleted_at IS NULL'
        )
        .all(project.id)
        .map((row) => row.name.trim().toLowerCase())
      addSchedules(file.reportSchedules, project.id, tallies, existing)
      return {
        mode: 'replace',
        projectId: project.id,
        projectName: project.name,
        sections: tallies.results(present(file)),
        undoable: false
      }
    } finally {
      closeDatabase(staged)
      for (const suffix of ['', '-wal', '-shm', MIGRATION_BACKUP_SUFFIX])
        rmSync(`${stagePath}${suffix}`, { force: true })
    }
  }

  /**
   * Report schedules get a new id, this project, and no email account (accounts are this Mac's).
   * They also come in paused with no recipients: a file from outside must never start mail
   * to an address through the user's own sending account.
   */
  function addSchedules(
    rows: readonly Row[],
    projectId: string,
    tallies: ImportTallies,
    existing: readonly string[]
  ): void {
    const columns = new Set(
      host.storage.db
        .prepare<unknown[], { name: string }>(`PRAGMA table_info(${quoteName('report_schedules')})`)
        .all()
        .map((column) => column.name)
    )
    const taken = new Set(existing)
    for (const original of rows) {
      const name = typeof original.name === 'string' ? original.name.trim().toLowerCase() : ''
      if (name.length > 0 && taken.has(name)) {
        tallies.left(
          'reportSchedules',
          'skipped',
          'report schedule',
          existing.includes(name) ? 'already in the project' : 'listed twice in the file',
          true
        )
        continue
      }
      const unknown = Object.keys(original).find((column) => !columns.has(column))
      if (unknown !== undefined) {
        tallies.left(
          'reportSchedules',
          'failed',
          'report schedule',
          'it has a field this version does not know',
          true
        )
        continue
      }
      const row: Row = {
        ...original,
        id: host.createId(),
        project_id: projectId,
        account_id: null,
        status: 'paused',
        recipients: '[]',
        deleted_at: null
      }
      const keys = Object.keys(row).filter((column) => columns.has(column))
      try {
        host.storage.db
          .prepare(insertSql('report_schedules', keys))
          .run(keys.map((column) => row[column] ?? null))
        taken.add(name)
        tallies.added('reportSchedules')
      } catch {
        tallies.left('reportSchedules', 'failed', 'report schedule', 'a value is not allowed', true)
      }
    }
  }

  function freeName(name: string): string {
    const taken = new Set(listProjects(host.storage.db).map((project) => project.name))
    if (!taken.has(name)) return name
    const base = `${name.slice(0, 186)} (imported)`
    if (!taken.has(base)) return base
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${name.slice(0, 182)} (imported ${index})`
      if (!taken.has(candidate)) return candidate
    }
    return `${name.slice(0, 180)} (imported ${Date.now() % 10_000})`
  }

  return { summary, exportProject, pick, preview, importProject }
}

/** The parts the file has something for, so the result lists them even when nothing changed. */
function present(file: ProjectFile): Set<ProjectImportResult['sections'][number]['section']> {
  return new Set(sectionCounts(file).map((count) => count.section))
}
