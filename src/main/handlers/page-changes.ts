/** Page change history: changes seen between page reads, versions and their diff. */

import type { IpcHandlersFor, PageChange, pageChangesChannels } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { parseProjectId } from '../ipc-m2'
import { requirePage } from '../engine/page-access'
import {
  diffVersions,
  listProjectPageChanges,
  listVersions,
  readPageChange
} from '../engine/page-changes'
import { withProject } from '../engine/project-db'
import { setPageChangeDismissed } from '../storage/page-history'
import { guard, type EngineContext } from './context'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function pageChangesHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof pageChangesChannels> {
  const decide = (
    channel: 'pageChanges:dismiss' | 'pageChanges:restore',
    request: unknown,
    dismissed: boolean
  ): Promise<PageChange> => {
    const { projectId, changeId } = ids(request, channel, ['projectId', 'changeId'])
    return withProject(ctx, projectId, channel, ({ db }) => {
      if (readPageChange(db, changeId) === null) {
        throw new IpcRequestError(channel, 'That page change was not found')
      }
      setPageChangeDismissed(db, changeId, dismissed ? ctx.now().toISOString() : null)
      const change = readPageChange(db, changeId)
      if (change === null) throw new IpcRequestError(channel, 'That page change was not found')
      return change
    })
  }
  return {
    'pageChanges:list': (request) =>
      guard('pageChanges:list', ctx, () => {
        const { projectId } = parseProjectId(request, 'pageChanges:list')
        return withProject(ctx, projectId, 'pageChanges:list', ({ db }) =>
          listProjectPageChanges(db, projectId, ctx.now().toISOString())
        )
      }),
    'pageChanges:versions': (request) =>
      guard('pageChanges:versions', ctx, () => {
        const channel = 'pageChanges:versions'
        const { projectId, pageId } = ids(request, channel, ['projectId', 'pageId'])
        return withProject(ctx, projectId, channel, ({ db }) => {
          requirePage(db, pageId, projectId, channel)
          return listVersions(db, pageId)
        })
      }),
    'pageChanges:diff': (request) =>
      guard('pageChanges:diff', ctx, () => {
        const channel = 'pageChanges:diff'
        const { projectId, pageId, fromSnapshotId, toSnapshotId } = ids(request, channel, [
          'projectId',
          'pageId',
          'fromSnapshotId',
          'toSnapshotId'
        ])
        return withProject(ctx, projectId, channel, ({ db }) => {
          requirePage(db, pageId, projectId, channel)
          const diff = diffVersions(db, pageId, fromSnapshotId, toSnapshotId)
          if (diff === null) {
            throw new IpcRequestError(channel, 'Those page reads are not of this page')
          }
          return diff
        })
      }),
    'pageChanges:dismiss': (request) =>
      guard('pageChanges:dismiss', ctx, () => decide('pageChanges:dismiss', request, true)),
    'pageChanges:restore': (request) =>
      guard('pageChanges:restore', ctx, () => decide('pageChanges:restore', request, false))
  }
}

/** An object with exactly these keys, each an opaque id. */
function ids<K extends string>(
  value: unknown,
  channel: string,
  keys: readonly K[]
): Record<K, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const present = Object.keys(record)
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    throw new IpcRequestError(channel)
  }
  const out = {} as Record<K, string>
  for (const key of keys) {
    const item = record[key]
    if (typeof item !== 'string' || !ID.test(item)) throw new IpcRequestError(channel)
    out[key] = item
  }
  return out
}
