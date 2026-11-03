/** Report a problem: build the report, save it, open the logs folder, open the mail window. */

import type { diagnosticsChannels, IpcHandlersFor } from '@shared/ipc'
import {
  parseBuildDiagnostics,
  parseOpenReportMail,
  parseSaveDiagnostics,
  parseSendDiagnostics
} from '../diagnostics/parse'
import { createDiagnosticsService, type DiagnosticsService } from '../diagnostics/service'
import { guard, type EngineContext } from './context'
import type { ReportRoute } from './account'

export function diagnosticsHandlers(
  ctx: EngineContext,
  reports?: ReportRoute,
  service: DiagnosticsService = createDiagnosticsService({
    ...(reports !== undefined ? { reports } : {}),
    http: ctx.http,
    storage: ctx.storage,
    secrets: ctx.secrets,
    appInfo: ctx.appInfo,
    logger: ctx.logger,
    knownSecrets: ctx.knownSecrets,
    now: ctx.now
  })
): IpcHandlersFor<typeof diagnosticsChannels> {
  return {
    'diagnostics:build': (request) =>
      guard('diagnostics:build', ctx, () => service.build(parseBuildDiagnostics(request))),
    'diagnostics:send': (request) =>
      guard('diagnostics:send', ctx, () => service.send(parseSendDiagnostics(request))),
    'diagnostics:save': (request) =>
      guard('diagnostics:save', ctx, () => service.save(parseSaveDiagnostics(request))),
    'diagnostics:reveal-logs': () =>
      guard('diagnostics:reveal-logs', ctx, () => service.revealLogs()),
    'diagnostics:open-mail': (request) =>
      guard('diagnostics:open-mail', ctx, () => service.openMail(parseOpenReportMail(request)))
  }
}
