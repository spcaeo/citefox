/** Moving to a new Mac: project files and app settings files (export, preview, import). */

import type { AppSchedule } from '@shared/domain'
import type { IpcHandlersFor, transferChannels } from '@shared/ipc'
import {
  parseExportProject,
  parseImportProject,
  parseProjectIdRequest,
  parseToken
} from '../project-transfer/parse'
import { createProjectTransferService } from '../project-transfer/project-service'
import { createSettingsTransferService } from '../project-transfer/settings-transfer'
import { guard, type EngineContext } from './context'

export interface TransferScheduleAccess {
  getApp: () => AppSchedule
  updateApp: (request: unknown) => AppSchedule
}

export function transferHandlers(
  ctx: EngineContext,
  schedule: TransferScheduleAccess
): IpcHandlersFor<typeof transferChannels> {
  const projects = createProjectTransferService(ctx)
  const settings = createSettingsTransferService({
    storage: ctx.storage,
    now: ctx.now,
    appVersion: () => ctx.appInfo().version,
    getSchedule: () => schedule.getApp(),
    updateSchedule: (patch) => schedule.updateApp(patch),
    ...(ctx.onThemeChanged !== undefined ? { onThemeChanged: ctx.onThemeChanged } : {})
  })
  return {
    'transfer:projectSummary': (request) =>
      guard('transfer:projectSummary', ctx, () =>
        projects.summary(parseProjectIdRequest(request, 'transfer:projectSummary').projectId)
      ),
    'transfer:exportProject': (request) =>
      guard('transfer:exportProject', ctx, () =>
        projects.exportProject(parseExportProject(request))
      ),
    'transfer:pickProject': () => guard('transfer:pickProject', ctx, () => projects.pick()),
    'transfer:projectPreview': (request) =>
      guard('transfer:projectPreview', ctx, () =>
        projects.preview(parseToken(request, 'transfer:projectPreview').token)
      ),
    'transfer:importProject': (request) =>
      guard('transfer:importProject', ctx, () =>
        projects.importProject(parseImportProject(request))
      ),
    'transfer:exportSettings': () =>
      guard('transfer:exportSettings', ctx, () => settings.exportSettings()),
    'transfer:pickSettings': () => guard('transfer:pickSettings', ctx, () => settings.pick()),
    'transfer:settingsPreview': (request) =>
      guard('transfer:settingsPreview', ctx, () =>
        settings.preview(parseToken(request, 'transfer:settingsPreview').token)
      ),
    'transfer:applySettings': (request) =>
      guard('transfer:applySettings', ctx, () =>
        settings.apply(parseToken(request, 'transfer:applySettings').token)
      )
  }
}
