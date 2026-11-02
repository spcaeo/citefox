import type { ProjectSearchSettings } from '@shared/domain'
import { checkCatalogCache } from '../../headless/catalog-cache'
import { readStoredCheckCatalog } from '../../headless/storage-pass'
import { IpcRequestError } from '../../ipc-request'
import type { AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import { readProjectScheduleCap, writeProjectScheduleCap } from '../../storage/project-schedule'
import { getApiKey, getProject, listApiKeys, updateApiKey } from '../../storage/records'

/** FR-11.4. The stored cap columns, as the settings screen shows them. */
export function readSearchSettings(db: SqliteDatabase): ProjectSearchSettings {
  const cap = readProjectScheduleCap(db)
  return {
    source: cap.dedicatedKeyId === null ? 'shared' : 'dedicated',
    cap: cap.cap,
    capRule: cap.capRule,
    dedicatedKeyId: cap.dedicatedKeyId
  }
}

/**
 * FR-11.4. Saves where a project's searches come from.
 * A dedicated key serves only this project: its `projectIds` becomes `[projectId]`,
 * so shared rotation skips it for every other project. A key another project already
 * dedicates is refused. The key this project stops dedicating serves every project again.
 */
export function applySearchSettings(
  storage: AppStorage,
  db: SqliteDatabase,
  projectId: string,
  next: ProjectSearchSettings,
  channel: string
): void {
  const previous = readProjectScheduleCap(db)
  const dedicatedKeyId = next.source === 'dedicated' ? next.dedicatedKeyId : null
  if (next.source === 'dedicated') {
    if (dedicatedKeyId === null) throw new IpcRequestError(channel, 'Choose a dedicated key')
    const key = getApiKey(storage.db, dedicatedKeyId)
    if (key === null || key.provider !== 'serpapi') {
      throw new IpcRequestError(channel, 'That SerpApi key was not found')
    }
    const owner = dedicatedOwner(storage, dedicatedKeyId, projectId)
    if (owner !== null) {
      throw new IpcRequestError(channel, `That key is already dedicated to ${owner}`)
    }
  }
  writeProjectScheduleCap(db, {
    cap: next.cap,
    capRule: next.capRule,
    dedicatedKeyId
  })
  if (previous.dedicatedKeyId !== null && previous.dedicatedKeyId !== dedicatedKeyId) {
    releaseKey(storage, previous.dedicatedKeyId, projectId)
  }
  if (dedicatedKeyId !== null) {
    const key = getApiKey(storage.db, dedicatedKeyId)
    if (key !== null && !(key.projectIds.length === 1 && key.projectIds[0] === projectId)) {
      updateApiKey(storage.db, { ...key, projectIds: [projectId] })
    }
  }
  checkCatalogCache(storage).invalidate()
}

/** The name of another project that dedicates this key, or null. */
export function dedicatedOwner(
  storage: AppStorage,
  keyId: string,
  exceptProjectId: string
): string | null {
  const owner = readStoredCheckCatalog(storage).queueProjects.find(
    (project) => project.dedicatedKeyId === keyId && project.projectId !== exceptProjectId
  )
  if (owner === undefined) return null
  return getProject(storage.db, owner.projectId)?.name ?? owner.name
}

/** A key this project dedicated serves every project again. Other restrictions stay. */
export function releaseKey(storage: AppStorage, keyId: string, projectId: string): void {
  const key = getApiKey(storage.db, keyId)
  if (key === null) return
  if (key.projectIds.length === 1 && key.projectIds[0] === projectId) {
    updateApiKey(storage.db, { ...key, projectIds: [] })
  }
}

/**
 * Removes a deleted project from keys that also serve other projects. A key that served
 * only this project keeps that list, so it serves no project from now on and is never
 * spent on another project by accident (a client's own key). Shared keys are not touched.
 */
export function forgetProjectOnKeys(storage: AppStorage, projectId: string): void {
  for (const key of listApiKeys(storage.db)) {
    if (!key.projectIds.includes(projectId) || key.projectIds.length < 2) continue
    updateApiKey(storage.db, {
      ...key,
      projectIds: key.projectIds.filter((id) => id !== projectId)
    })
  }
}
