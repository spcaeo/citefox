/** First-run guided journey (owner feedback 4). */

import type { IpcHandlersFor, startChannels } from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import { IpcRequestError } from '../ipc-request'
import { emitStartProgress } from '../start/progress'
import { createStartService, type StartService } from '../start/service'
import type { StructureRuntimeOptions } from '../structure/runtime'
import { structureRuntimeFor } from '../structure/sync-loop'
import { guard, type EngineContext } from './context'

function record(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel, 'Invalid request')
  }
  return value as Record<string, unknown>
}

function projectId(raw: Record<string, unknown>, channel: string): string {
  const id = raw.projectId
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
    throw new IpcRequestError(channel, 'Invalid request')
  }
  return id
}

function projectOnly(request: unknown, channel: string): string {
  return projectId(record(request, channel), channel)
}

export function startHandlers(
  ctx: EngineContext,
  options: StructureRuntimeOptions = {},
  checks: CheckEngine | null = null,
  autopilotOff = false,
  service: StartService = createStartService({
    host: ctx,
    rt: structureRuntimeFor(ctx, options),
    checks,
    emit: emitStartProgress,
    autopilotOff
  })
): IpcHandlersFor<typeof startChannels> {
  return {
    'start:homework': (request) =>
      guard('start:homework', ctx, () => {
        const raw = record(request, 'start:homework')
        const force = raw.force
        if (force !== undefined && typeof force !== 'boolean') {
          throw new IpcRequestError('start:homework', 'Invalid request')
        }
        return service.homework({
          projectId: projectId(raw, 'start:homework'),
          ...(force === true ? { force: true } : {})
        })
      }),
    'start:get': (request) =>
      guard('start:get', ctx, () => service.get(projectOnly(request, 'start:get'))),
    'start:progress': (request) =>
      guard('start:progress', ctx, () => service.progress(projectOnly(request, 'start:progress'))),
    'start:stop': (request) =>
      guard('start:stop', ctx, () => service.stop(projectOnly(request, 'start:stop'))),
    'start:begin': (request) =>
      guard('start:begin', ctx, () => {
        const channel = 'start:begin'
        const raw = record(request, channel)
        const urls = raw.targetUrls
        if (
          !Array.isArray(urls) ||
          urls.length > 50 ||
          !urls.every((url) => typeof url === 'string' && url.length > 0 && url.length <= 2000)
        ) {
          throw new IpcRequestError(channel, 'Invalid request')
        }
        return service.begin({ projectId: projectId(raw, channel), targetUrls: urls as string[] })
      }),
    'start:status': (request) =>
      guard('start:status', ctx, () => service.status(projectOnly(request, 'start:status'))),
    'start:edit': (request) =>
      guard('start:edit', ctx, () => {
        const raw = record(request, 'start:edit')
        return service.edit(projectId(raw, 'start:edit'), raw.edit)
      }),
    'start:undo': (request) =>
      guard('start:undo', ctx, () => {
        const raw = record(request, 'start:undo')
        const editId = raw.editId
        if (typeof editId !== 'string' || editId.length === 0 || editId.length > 120) {
          throw new IpcRequestError('start:undo', 'Invalid request')
        }
        return service.undo(projectId(raw, 'start:undo'), editId)
      }),
    'start:edits': (request) =>
      guard('start:edits', ctx, () => service.edits(projectOnly(request, 'start:edits'))),
    'start:suggestUrls': (request) =>
      guard('start:suggestUrls', ctx, () => {
        const channel = 'start:suggestUrls'
        const raw = record(request, channel)
        const query = raw.query
        const limit = raw.limit
        if (typeof query !== 'string' || query.length > 2000) {
          throw new IpcRequestError(channel, 'Invalid request')
        }
        if (
          limit !== undefined &&
          (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50)
        ) {
          throw new IpcRequestError(channel, 'Invalid request')
        }
        return service.suggestUrls({
          projectId: projectId(raw, channel),
          query,
          ...(limit !== undefined ? { limit } : {})
        })
      })
  }
}
