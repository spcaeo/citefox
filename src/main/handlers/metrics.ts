/** The shared metrics layer (`reports:metrics`). Read-only: it spends no searches. */

import type { IpcHandlersFor, metricsChannels } from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { parseDownloadRequest, saveReviewDownload } from '../export/review/download'
import { loadMetrics } from '../metrics/assemble'
import { parseMetricsRequest } from '../metrics/parse'
import { loadReportExtras } from '../export/review/extras'
import { getReportBranding, setReportBranding } from '../storage/report-branding'
import { cachedSiteIcon, readReportSender, writeReportSender } from '../storage/report-sender'
import { parseProjectId } from '../ipc-m2'
import { IpcRequestError } from '../ipc-request'
import { guard, type EngineContext } from './context'

export function metricsHandlers(ctx: EngineContext): IpcHandlersFor<typeof metricsChannels> {
  return {
    'reports:metrics': (request) =>
      guard('reports:metrics', ctx, () => {
        const parsed = parseMetricsRequest(request)
        return withProject(ctx, parsed.projectId, 'reports:metrics', (opened) =>
          loadMetrics(opened.db, opened.project, parsed)
        )
      }),
    'reports:review': (request) =>
      guard('reports:review', ctx, () => {
        const parsed = parseMetricsRequest(request)
        return withProject(ctx, parsed.projectId, 'reports:review', (opened) => {
          const metrics = loadMetrics(opened.db, opened.project, parsed)
          return {
            metrics,
            extras: loadReportExtras(opened.db, opened.project, metrics, ctx.now())
          }
        })
      }),
    'reports:getBranding': (request) =>
      guard('reports:getBranding', ctx, () => {
        const { projectId } = parseProjectId(request, 'reports:getBranding')
        return withProject(ctx, projectId, 'reports:getBranding', (opened) =>
          getReportBranding(opened.db)
        )
      }),
    'reports:setBranding': (request) =>
      guard('reports:setBranding', ctx, () => {
        const channel = 'reports:setBranding'
        if (typeof request !== 'object' || request === null) throw new IpcRequestError(channel)
        const { projectId, preparedFor, logo, preparedBy, ...rest } = request as unknown as Record<
          string,
          unknown
        >
        if (Object.keys(rest).length > 0) throw new IpcRequestError(channel)
        if (typeof preparedFor !== 'string' || (logo !== null && typeof logo !== 'string')) {
          throw new IpcRequestError(channel)
        }
        if (preparedBy !== undefined && typeof preparedBy !== 'string') {
          throw new IpcRequestError(channel)
        }
        const id = parseProjectId({ projectId }, channel).projectId
        return withProject(ctx, id, channel, (opened) =>
          setReportBranding(opened.db, { preparedFor, logo, preparedBy }, ctx.now().toISOString())
        )
      }),
    'reports:getSender': () =>
      guard('reports:getSender', ctx, () => readReportSender(ctx.storage.paths.root)),
    'reports:setSender': (request) =>
      guard('reports:setSender', ctx, () => {
        const channel = 'reports:setSender'
        if (typeof request !== 'object' || request === null) throw new IpcRequestError(channel)
        const record = request as unknown as Record<string, unknown>
        const allowed = ['mode', 'name', 'logo', 'website', 'email', 'preparedBy']
        if (Object.keys(record).some((key) => !allowed.includes(key))) {
          throw new IpcRequestError(channel)
        }
        if (record.logo !== null && record.logo !== undefined && typeof record.logo !== 'string') {
          throw new IpcRequestError(channel)
        }
        return writeReportSender(ctx.storage.paths.root, record)
      }),
    'reports:download': (request) =>
      guard('reports:download', ctx, () => {
        const parsed = parseDownloadRequest(request)
        return withProject(ctx, parsed.projectId, 'reports:download', (opened) =>
          saveReviewDownload(opened.db, opened.project, parsed, ctx.now(), {
            sender: readReportSender(ctx.storage.paths.root),
            brandIcon: (domain) => cachedSiteIcon(ctx.storage.paths.root, domain)
          })
        )
      })
  }
}
