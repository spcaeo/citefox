import type { ExportProjectRequest, ImportProjectRequest, TransferTokenRequest } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'

/** Request checks for the `transfer:*` channels: exact keys, plain values. */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function record(value: unknown, channel: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const found = value as Record<string, unknown>
  for (const key of Object.keys(found)) {
    if (!keys.includes(key)) throw new IpcRequestError(channel)
  }
  return found
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

export function parseProjectIdRequest(value: unknown, channel: string): { projectId: string } {
  const found = record(value, channel, ['projectId'])
  return { projectId: id(found.projectId, channel) }
}

export function parseExportProject(value: unknown): ExportProjectRequest {
  const channel = 'transfer:exportProject'
  const found = record(value, channel, ['projectId', 'includeResults'])
  if (typeof found.includeResults !== 'boolean') throw new IpcRequestError(channel)
  return { projectId: id(found.projectId, channel), includeResults: found.includeResults }
}

export function parseToken(value: unknown, channel: string): TransferTokenRequest {
  const found = record(value, channel, ['token'])
  return { token: id(found.token, channel) }
}

export function parseImportProject(value: unknown): ImportProjectRequest {
  const channel = 'transfer:importProject'
  const found = record(value, channel, ['token', 'mode', 'replaceProjectId'])
  if (found.mode !== 'new' && found.mode !== 'replace') throw new IpcRequestError(channel)
  const replaceProjectId =
    found.replaceProjectId === null || found.replaceProjectId === undefined
      ? null
      : id(found.replaceProjectId, channel)
  if (found.mode === 'replace' && replaceProjectId === null) {
    throw new IpcRequestError(channel, 'Choose the project to replace')
  }
  return { token: id(found.token, channel), mode: found.mode, replaceProjectId }
}
