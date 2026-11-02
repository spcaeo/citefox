/** App info and settings. */

import type { AppSettings } from '@shared/domain'
import type {
  appChannels,
  AppSettingsSnapshot,
  IpcHandlersFor,
  OpenTestProfileRequest,
  settingsChannels
} from '@shared/ipc'
import { exportAllData } from '../export/all-data'
import { openDataFolder, revealAppPath } from '../export/data-folder'
import { currentExportSaveDialog } from '../export/ipc'
import { IpcRequestError, parseSettingsPatch } from '../ipc-request'
import { guard, type EngineContext } from './context'

const NOT_AVAILABLE = { ok: false, message: 'Not available here.' } as const

export function appHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof appChannels> & IpcHandlersFor<typeof settingsChannels> {
  return {
    'app:getInfo': () => ctx.appInfo(),
    'app:resetKeepKeys': () =>
      guard('app:resetKeepKeys', ctx, () =>
        ctx.appTools === undefined ? NOT_AVAILABLE : ctx.appTools.resetKeepKeys()
      ),
    'app:openTestProfile': (request) =>
      guard('app:openTestProfile', ctx, () => {
        const parsed = parseOpenTestProfile(request)
        return ctx.appTools === undefined ? NOT_AVAILABLE : ctx.appTools.openTestProfile(parsed)
      }),
    'settings:get': () => guard('settings:get', ctx, () => readSettingsSnapshot(ctx)),
    'settings:update': (patch) => guard('settings:update', ctx, () => updateSettings(ctx, patch)),
    'settings:exportAllData': () =>
      guard('settings:exportAllData', ctx, () =>
        exportAllData({
          storage: ctx.storage,
          now: ctx.now,
          secrets: ctx.knownSecrets(),
          appVersion: ctx.appInfo().version,
          logger: ctx.logger,
          dialog: currentExportSaveDialog()
        })
      ),
    'settings:openDataFolder': () =>
      guard('settings:openDataFolder', ctx, () => openDataFolder(ctx.storage.paths.root)),
    'settings:revealPath': (request) =>
      guard('settings:revealPath', ctx, () => revealAppPath(ctx.storage.paths.root, request))
  }
}

function readSettingsSnapshot(ctx: EngineContext): AppSettingsSnapshot {
  return {
    settings: ctx.storage.readSettings(),
    dataDirectory: ctx.storage.paths.root
  }
}

function updateSettings(ctx: EngineContext, patch: unknown): AppSettingsSnapshot {
  const parsed = parseSettingsPatch(patch)
  const next: AppSettings = { ...ctx.storage.readSettings(), ...parsed }
  ctx.storage.writeSettings(next)
  if (parsed.theme !== undefined) ctx.onThemeChanged?.(parsed.theme)
  return readSettingsSnapshot(ctx)
}

function parseOpenTestProfile(request: unknown): OpenTestProfileRequest {
  if (typeof request !== 'object' || request === null) {
    throw new IpcRequestError('app:openTestProfile')
  }
  const fresh = (request as Record<string, unknown>).fresh
  if (typeof fresh !== 'boolean') throw new IpcRequestError('app:openTestProfile')
  return { fresh }
}
