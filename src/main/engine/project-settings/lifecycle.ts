import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { CreateProjectRequest, DeleteProjectResult, ProjectDetail } from '@shared/ipc'
import { checkCatalogCache } from '../../headless/catalog-cache'
import { IpcRequestError } from '../../ipc-request'
import { getAlertSettings, saveAlertSettings } from '../../storage/alert-settings'
import type { SqliteDatabase } from '../../storage/database'
import { projectDatabasePool } from '../../storage/project-db-pool'
import { closeProjectDatabase, createProjectDatabase } from '../../storage/project-files'
import { readProjectOptions, writeProjectOptions } from '../../storage/project-options'
import {
  insertMarket,
  listMarkets,
  readProjectProfile,
  writeProjectProfile
} from '../../storage/project-profile'
import {
  readProjectSchedule,
  readProjectScheduleCap,
  writeProjectSchedule,
  writeProjectScheduleCap
} from '../../storage/project-schedule'
import {
  deleteProject,
  getProject,
  insertProject,
  listProjects,
  readActiveProjectId,
  writeActiveProjectId,
  type ProjectRecord
} from '../../storage/records'
import { MIGRATION_BACKUP_SUFFIX } from '../../storage/migrate'
import { projectDatabasePath, projectDatabaseRelativePath } from '../../storage/slug'
import type { EngineHost } from '../host'
import { openOwned, withProject } from '../project-db'
import { detailFrom } from '../projects'
import { allocateProjectSlug } from '../slug'
import { applySearchSettings, forgetProjectOnKeys } from './search'
import { assertClaudeKeys } from './settings'
import { copyTemplateOverrides } from './template-choices'

function clockOf(host: EngineHost): { now: string; createId: () => string } {
  return { now: host.now().toISOString(), createId: host.createId }
}

/**
 * FR-10.4. Copies schedule, samples, notifications, template versions, the cap rule,
 * and the Claude settings from one project file to another. Pages, prompts, history,
 * markets, a dedicated key, and the Slack webhook (a keychain item) are never copied.
 * The copy starts unpaused.
 */
export function copyProjectSettings(
  from: { id: string; db: SqliteDatabase },
  to: { id: string; db: SqliteDatabase },
  clock: { now: string; createId: () => string } = {
    now: new Date().toISOString(),
    createId: () => randomUUID()
  }
): void {
  const schedule = readProjectSchedule(from.db, from.id)
  writeProjectSchedule(to.db, {
    ...schedule,
    projectId: to.id,
    paused: false,
    nextCheckAt: null,
    pagesDueToday: 0
  })
  const cap = readProjectScheduleCap(from.db)
  writeProjectScheduleCap(to.db, { cap: cap.cap, capRule: cap.capRule, dedicatedKeyId: null })
  writeProjectOptions(to.db, readProjectOptions(from.db))
  // TPL-1: the project's template versions live in template_overrides (FR-26.8).
  copyTemplateOverrides(from.db, to.db, clock)
  const alerts = getAlertSettings(from.db, from.id)
  saveAlertSettings(to.db, {
    ...alerts,
    projectId: to.id,
    slackEnabled: false,
    slackKeychainRef: null
  })
}

/**
 * Runs inside `projects:create` once the project row exists: copy settings, then the
 * search source and Claude connection the form chose. A failure rolls the project back.
 */
export function applyCreateOptions(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  request: CreateProjectRequest
): void {
  const channel = 'projects:create'
  if (request.claude !== undefined) assertClaudeKeys(host, request.claude, channel)
  const sourceId = request.copySettingsFrom ?? null
  if (sourceId !== null) {
    const source = openOwned(host, sourceId, channel)
    try {
      copyProjectSettings(
        { id: source.project.id, db: source.db },
        { id: projectId, db },
        clockOf(host)
      )
    } finally {
      source.close()
    }
  }
  if (request.search !== undefined) {
    applySearchSettings(host.storage, db, projectId, request.search, channel)
  }
  if (request.claude !== undefined) {
    writeProjectOptions(db, { ...readProjectOptions(db), claude: request.claude })
  }
}

/**
 * FR-10.8 Duplicate project: a new project with the same domain, profile, markets, and
 * settings, named "<name> (copy)". Pages, prompts, and history stay with the original.
 * The duplicate shares keys and starts unpaused; it is not made active.
 */
export function duplicateProject(host: EngineHost, projectId: string): Promise<ProjectDetail> {
  const channel = 'projectSettings:duplicate'
  return withProject(host, projectId, channel, (source) => {
    const profile = readProjectProfile(source.db)
    if (profile === null) throw new IpcRequestError(channel, 'That project was not found')
    const name = copyName(host, source.project.name)
    const slug = allocateProjectSlug(
      host.storage.db,
      host.storage.paths.projectsDirectory,
      name,
      source.project.domain,
      channel
    )
    const id = host.createId()
    const db = createProjectDatabase(host.storage.paths.projectsDirectory, slug)
    const file = projectDatabasePath(host.storage.paths.projectsDirectory, slug)
    let inserted = false
    try {
      writeProjectProfile(db, profile)
      for (const market of listMarkets(source.db)) {
        if (market.id !== profile.market.id) insertMarket(db, market)
      }
      insertProject(host.storage.db, {
        id,
        name,
        slug,
        domain: source.project.domain,
        dbPath: projectDatabaseRelativePath(slug),
        clientName: source.project.clientName,
        status: 'active'
      })
      inserted = true
      copyProjectSettings({ id: source.project.id, db: source.db }, { id, db }, clockOf(host))
      const project = getProject(host.storage.db, id)
      if (project === null) throw new IpcRequestError(channel, 'Could not save the project')
      checkCatalogCache(host.storage).invalidate()
      return detailFrom(project, db)
    } catch (error) {
      if (inserted) deleteProject(host.storage.db, id, host.email.outboxDir)
      closeProjectDatabase(db)
      removeProjectFiles(file)
      throw error
    } finally {
      if (db.open) closeProjectDatabase(db)
    }
  })
}

/**
 * FR-10.8 Delete project. The typed name must match exactly. Removes the project row
 * (its usage keeps counting on its keys), closes every pooled handle on the file, and
 * deletes `projects/<slug>.sqlite` with its WAL, SHM, and migration backup. Shared keys
 * and default templates are not touched; a key that served only this project keeps
 * that list and so serves no other project.
 */
export function deleteProjectChannel(
  host: EngineHost,
  request: { projectId: string; confirmName: string }
): DeleteProjectResult {
  const channel = 'projectSettings:delete'
  const project = getProject(host.storage.db, request.projectId)
  if (project === null) throw new IpcRequestError(channel, 'That project was not found')
  if (request.confirmName !== project.name) {
    throw new IpcRequestError(channel, 'Type the project name exactly to confirm')
  }
  const opened = openOwned(host, project.id, channel)
  try {
    if (hasRunningCheck(opened.db)) {
      throw new IpcRequestError(channel, 'A check is running for this project. Cancel it first')
    }
  } finally {
    opened.close()
  }
  forgetProjectOnKeys(host.storage, project.id)
  deleteProject(host.storage.db, project.id, host.email.outboxDir)
  host.email.alerts.evictProject(project.id)
  const remaining = listProjects(host.storage.db)
  projectDatabasePool(host.storage).retain(new Set(remaining.map((item) => item.slug)))
  removeProjectFiles(projectDatabasePath(host.storage.paths.projectsDirectory, project.slug))
  checkCatalogCache(host.storage).invalidate()
  const active = readActiveProjectId(host.storage.db)
  let activeProjectId =
    active !== null && remaining.some((item) => item.id === active) ? active : null
  if (activeProjectId === null) {
    activeProjectId = nextActive(remaining)
    writeActiveProjectId(host.storage.db, activeProjectId)
  }
  return { projectId: project.id, activeProjectId }
}

function nextActive(projects: readonly ProjectRecord[]): string | null {
  return (projects.find((item) => item.status !== 'archived') ?? projects[0] ?? null)?.id ?? null
}

function hasRunningCheck(db: SqliteDatabase): boolean {
  const row = db
    .prepare<unknown[], { total: number }>(
      `SELECT COUNT(*) AS total FROM check_jobs WHERE status = 'running'`
    )
    .get()
  return (row?.total ?? 0) > 0
}

function removeProjectFiles(file: string): void {
  for (const path of [file, `${file}-wal`, `${file}-shm`, `${file}${MIGRATION_BACKUP_SUFFIX}`]) {
    rmSync(path, { force: true })
  }
}

function copyName(host: EngineHost, name: string): string {
  const taken = new Set(listProjects(host.storage.db).map((project) => project.name))
  const base = `${name.slice(0, 190)} (copy)`
  if (!taken.has(base)) return base
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${name.slice(0, 186)} (copy ${index})`
    if (!taken.has(candidate)) return candidate
  }
  return `${name.slice(0, 180)} (copy ${Date.now() % 10_000})`
}
