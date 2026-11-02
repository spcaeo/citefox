/** "What CiteFox needs": the permissions checklist and its one-click actions. */

import { isPermissionId, type IpcHandlersFor, type PermissionRequest } from '@shared/ipc'
import type { permissionsChannels } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { PermissionRequestError, type PermissionsService } from '../permissions/service'
import { guard, type EngineContext } from './context'

export function permissionsHandlers(
  ctx: EngineContext,
  service: PermissionsService
): IpcHandlersFor<typeof permissionsChannels> {
  return {
    'permissions:list': () => guard('permissions:list', ctx, () => service.list()),
    'permissions:request': (request) =>
      guard('permissions:request', ctx, async () => {
        const { id } = parsePermissionRequest(request)
        try {
          return await service.request(id)
        } catch (error: unknown) {
          if (error instanceof PermissionRequestError) {
            throw new IpcRequestError('permissions:request', error.message)
          }
          throw error
        }
      })
  }
}

export function parsePermissionRequest(value: unknown): PermissionRequest {
  const channel = 'permissions:request'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'id') throw new IpcRequestError(channel)
  const id = record.id
  if (typeof id !== 'string' || !isPermissionId(id)) {
    throw new IpcRequestError(channel, 'Unknown permission')
  }
  return { id }
}
