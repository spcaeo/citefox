import { isExportFormat, type AutoExport, type AutoExportRun } from '@shared/domain'
import {
  autoExportProblem,
  type AutoExportScopeRequest,
  type AutoExportUnavailable,
  type IpcHandlerMap,
  type IpcInvokeChannel
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import type { AppStorage } from '../../storage/app-storage'
import {
  listAutoExportRuns,
  readAutoExportRow,
  writeAutoExportRow,
  type AutoExportRow
} from '../../storage/auto-exports'
import type { SqliteDatabase } from '../../storage/database'
import { projectDatabasePool } from '../../storage/project-db-pool'
import { getProject } from '../../storage/records'
import { usableExportFolder, type AutoExportFolderDialog } from './folder'
import { parseAutoExportSpec } from './spec'

type AutoChannel = 'exports:getAuto' | 'exports:setAuto' | 'exports:chooseAutoFolder'

let folderDialog: AutoExportFolderDialog | null = null

/** Production passes Electron's folder dialog. Tests pass a fake. The renderer never sends a path. */
export function configureAutoExportFolderDialog(dialog: AutoExportFolderDialog | null): void {
  folderDialog = dialog
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export interface AutoExportIpcDeps {
  storage: AppStorage
  now: () => Date
}

/**
 * `exports:getAuto`, `exports:setAuto` and `exports:chooseAutoFolder` (FR-22.6).
 * The spec is stored per Export screen scope in the project file (migration 025).
 * A folder is stored only from the native folder dialog in main, and is checked
 * again before it is used. Problems resolve as a fixed `AutoExportUnavailable`.
 */
export function bindAutoExportHandlers(
  deps: AutoExportIpcDeps,
  guard: <T>(channel: IpcInvokeChannel, run: () => Promise<T> | T) => Promise<T>
): Pick<IpcHandlerMap, AutoChannel> {
  return {
    'exports:getAuto': (request) =>
      guard('exports:getAuto', () => {
        const scope = parseScope(request, 'exports:getAuto')
        const db = projectDb(deps.storage, scope.projectId, 'exports:getAuto')
        return autoExportView(db, scope)
      }),
    'exports:setAuto': (request) => guard('exports:setAuto', () => saveAutoExport(deps, request)),
    'exports:chooseAutoFolder': (request) =>
      guard('exports:chooseAutoFolder', async () => {
        const channel = 'exports:chooseAutoFolder'
        const scope = parseScope(request, channel)
        const db = projectDb(deps.storage, scope.projectId, channel)
        if (folderDialog === null) return autoExportProblem('unavailable')
        const picked = await folderDialog()
        if (picked.canceled || picked.filePaths.length === 0) return autoExportView(db, scope)
        const folder = picked.filePaths[0]
        if (!usableExportFolder(folder)) return autoExportProblem('folder')
        const current = readAutoExportRow(db, scopeKey(scope))
        writeAutoExportRow(db, {
          scopeKey: scopeKey(scope),
          enabled: current?.enabled ?? false,
          destination: 'folder',
          folder,
          specJson: current?.specJson ?? null,
          updatedAt: deps.now().toISOString()
        })
        return autoExportView(db, scope)
      })
  }
}

function saveAutoExport(
  deps: AutoExportIpcDeps,
  value: unknown
): AutoExport | AutoExportUnavailable {
  const channel = 'exports:setAuto'
  const scope = parseScope(value, channel)
  const record = value as Record<string, unknown>
  const { enabled, destination, folder, emailTo } = record
  if (typeof enabled !== 'boolean') throw new IpcRequestError(channel)
  if (destination !== 'folder' && destination !== 'email') throw new IpcRequestError(channel)
  if (emailTo !== null && typeof emailTo !== 'string') throw new IpcRequestError(channel)
  if (folder !== null && typeof folder !== 'string') throw new IpcRequestError(channel)
  const db = projectDb(deps.storage, scope.projectId, channel)
  const key = scopeKey(scope)
  const current = readAutoExportRow(db, key)
  // Only the dialog in main sets a folder. The renderer may echo the stored one back.
  if (folder !== null && folder !== current?.folder) {
    throw new IpcRequestError(channel, 'Choose the folder with Choose folder')
  }
  if (destination === 'email') return autoExportProblem('email')
  const spec = parseAutoExportSpec(record.spec, scope.projectId)
  if (enabled) {
    const stored = current?.folder ?? null
    if (stored === null) return autoExportProblem('no_folder')
    if (!usableExportFolder(stored)) return autoExportProblem('folder')
    if (spec === null) return autoExportProblem('invalid')
  }
  const next: AutoExportRow = {
    scopeKey: key,
    enabled,
    destination: 'folder',
    folder: current?.folder ?? null,
    specJson: spec !== null ? JSON.stringify(spec) : (current?.specJson ?? null),
    updatedAt: deps.now().toISOString()
  }
  writeAutoExportRow(db, next)
  return autoExportView(db, scope)
}

/** The stored scope, or a disabled one with no folder when nothing is saved yet. */
export function autoExportView(db: SqliteDatabase, scope: AutoExportScopeRequest): AutoExport {
  const key = scopeKey(scope)
  const row = readAutoExportRow(db, key)
  let spec: AutoExport['spec'] = null
  const specJson = row?.specJson ?? null
  if (specJson !== null) {
    try {
      spec = parseAutoExportSpec(JSON.parse(specJson), scope.projectId)
    } catch {
      spec = null
    }
  }
  return {
    projectId: scope.projectId,
    pageId: scope.pageId,
    enabled: row?.enabled ?? false,
    destination: 'folder',
    folder: row?.folder ?? null,
    emailTo: null,
    spec,
    runs: listAutoExportRuns(db, key).map((run): AutoExportRun => ({
      id: run.id,
      finishedAt: run.finishedAt,
      outcome: run.outcome,
      format: isExportFormat(run.format) ? run.format : 'pdf',
      filename: run.filename,
      bytes: run.bytes,
      reason: run.reason,
      nextStep: run.nextStep
    }))
  }
}

function scopeKey(scope: AutoExportScopeRequest): string {
  return scope.pageId ?? ''
}

function parseScope(value: unknown, channel: string): AutoExportScopeRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const { projectId, pageId } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || !ID.test(projectId)) throw new IpcRequestError(channel)
  if (pageId !== null && (typeof pageId !== 'string' || !ID.test(pageId))) {
    throw new IpcRequestError(channel)
  }
  return { projectId, pageId }
}

function projectDb(storage: AppStorage, projectId: string, channel: string): SqliteDatabase {
  const project = getProject(storage.db, projectId)
  if (project === null) throw new IpcRequestError(channel, 'Unknown project')
  return projectDatabasePool(storage).get(project.slug)
}
