import { rmSync } from 'node:fs'
import type { ProjectSummary } from '@shared/domain'
import type {
  CheckCompanyDomainRequest,
  CheckCompanyDomainResult,
  CreateProjectRequest,
  ProjectDetail,
  ProjectList,
  UpdateProjectRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { matchSerpApiLocation } from '../locations'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import {
  listMarkets,
  readProjectProfile,
  updateProjectProfile,
  writeProjectProfile,
  type ProjectProfile
} from '../storage/project-profile'
import {
  deleteProject,
  getProject,
  insertProject,
  listProjects,
  readActiveProjectId,
  updateProject,
  writeActiveProjectId
} from '../storage/records'
import { listPagesOfKind } from '../storage/pages'
import { projectDatabasePath, projectDatabaseRelativePath } from '../storage/slug'
import type { EngineHost } from './host'
import { withProject } from './project-db'
import { allocateProjectSlug } from './slug'
import { applyCreateOptions } from './project-settings/lifecycle'
import { systemAddressLookup } from '../pipeline/fetch-guard'
import { checkTypedDomain } from './company-domain-lookup'

export { fillFromWebsite } from './fill-from-website'
export { homepageReader } from './site-page'

export function listProjectChannel(host: EngineHost): ProjectList {
  const projects = listProjects(host.storage.db)
  const active = readActiveProjectId(host.storage.db)
  const known = active !== null && projects.some((project) => project.id === active)
  return { activeProjectId: known ? active : null, projects }
}

export function getProjectChannel(host: EngineHost, projectId: string): Promise<ProjectDetail> {
  return withProject(host, projectId, 'projects:get', (opened) =>
    detailFrom(opened.project, opened.db)
  )
}

export function createProjectChannel(
  host: EngineHost,
  request: CreateProjectRequest
): ProjectDetail {
  const channel = 'projects:create'
  const slug = allocateProjectSlug(
    host.storage.db,
    host.storage.paths.projectsDirectory,
    request.name,
    request.domain,
    channel
  )
  const id = host.createId()
  const db = createProjectDatabase(host.storage.paths.projectsDirectory, slug)
  const file = projectDatabasePath(host.storage.paths.projectsDirectory, slug)
  let inserted = false
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    closeProjectDatabase(db)
  }
  try {
    writeNewProfile(host, db, request)
    insertProject(host.storage.db, {
      id,
      name: request.name,
      slug,
      domain: request.domain,
      dbPath: projectDatabaseRelativePath(slug),
      clientName: request.clientName,
      status: 'active'
    })
    inserted = true
    applyCreateOptions(host, db, id, request)
    writeActiveProjectId(host.storage.db, id)
    const saved = detailFrom(requireProject(host, id), db)
    close()
    return saved
  } catch (error) {
    close()
    if (inserted) deleteProject(host.storage.db, id, host.email.outboxDir)
    // Close every handle on the file before deleting it: Windows refuses to delete an open file.
    host.email.alerts.evictProject(id)
    rmSync(file, { force: true })
    rmSync(`${file}-wal`, { force: true })
    rmSync(`${file}-shm`, { force: true })
    throw error
  }
}

export function updateProjectChannel(
  host: EngineHost,
  request: UpdateProjectRequest
): Promise<ProjectDetail> {
  const channel = 'projects:update'
  return withProject(host, request.projectId, channel, (opened) => {
    const current = readProjectProfile(opened.db)
    if (current === null) throw new IpcRequestError(channel, 'That project was not found')
    updateProject(host.storage.db, opened.project.id, {
      name: request.name ?? opened.project.name,
      domain: request.domain ?? opened.project.domain,
      ...(request.clientName !== undefined ? { clientName: request.clientName } : {}),
      ...(request.status !== undefined ? { status: request.status } : {})
    })
    const location = request.location !== undefined ? request.location : current.market.location
    const country = request.country ?? current.market.country
    const next: ProjectProfile = {
      includeSubdomains: request.includeSubdomains ?? current.includeSubdomains,
      brandNames: request.brandNames ?? current.brandNames,
      competitors: request.competitors ?? current.competitors,
      market: {
        id: current.market.id,
        country,
        language: request.language ?? current.market.language,
        location,
        device: request.device ?? current.market.device,
        localWording: current.market.localWording,
        serpapiLocation: matchSerpApiLocation(location, country, host.locations)
      }
    }
    updateProjectProfile(opened.db, next)
    return detailFrom(requireProject(host, opened.project.id), opened.db)
  })
}

export function switchProjectChannel(host: EngineHost, projectId: string): Promise<ProjectDetail> {
  return withProject(host, projectId, 'projects:switch', (opened) => {
    writeActiveProjectId(host.storage.db, opened.project.id)
    return detailFrom(opened.project, opened.db)
  })
}

/** `projects:checkCompanyDomain`: the domain a user typed for a competitor row. */
export function checkCompanyDomainChannel(
  host: EngineHost,
  request: CheckCompanyDomainRequest
): Promise<CheckCompanyDomainResult> {
  return checkTypedDomain(request.domain, host.pageDns ?? systemAddressLookup())
}

function writeNewProfile(
  host: EngineHost,
  db: SqliteDatabase,
  request: CreateProjectRequest
): void {
  writeProjectProfile(db, {
    includeSubdomains: request.includeSubdomains,
    brandNames: request.brandNames,
    competitors: request.competitors,
    ...(request.switchingFrom !== undefined ? { switchingFrom: request.switchingFrom } : {}),
    ...(request.integrations !== undefined ? { integrations: request.integrations } : {}),
    market: {
      id: host.createId(),
      country: request.country,
      language: request.language,
      location: request.location,
      device: request.device,
      localWording: false,
      serpapiLocation: matchSerpApiLocation(request.location, request.country, host.locations)
    }
  })
}

/** Project row plus the profile, page counts, and every market (FR-10.5). */
export function detailFrom(project: ProjectSummary, db: SqliteDatabase): ProjectDetail {
  const profile = readProjectProfile(db)
  const pages = listPagesOfKind(db, project.id, 'page')
  const tracked = pages.filter(
    (page) => page.status === 'setting_up' || page.status === 'tracked' || page.status === 'paused'
  )
  return {
    ...project,
    includeSubdomains: profile?.includeSubdomains ?? false,
    brandNames: profile?.brandNames ?? [],
    competitors: profile?.competitors ?? [],
    defaultMarket: profile?.market ?? null,
    switchingFrom: profile?.switchingFrom ?? [],
    integrations: profile?.integrations ?? [],
    foundPageCount: pages.length,
    trackedPageCount: tracked.length,
    markets: listMarkets(db)
  }
}

function requireProject(host: EngineHost, id: string): ProjectSummary {
  const project = getProject(host.storage.db, id)
  if (project === null) throw new IpcRequestError('projects:create', 'That project was not found')
  return project
}
