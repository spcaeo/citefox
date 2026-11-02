import type { Notice, NoticeAction } from '@shared/domain'
import type { NoticeList, ResolveNoticeRequest, ResolveNoticeResult } from '@shared/ipc'
import { randomUUID } from 'node:crypto'
import { emitMainEvent } from '../ipc-events'
import { IpcRequestError } from '../ipc-request'
import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import type { AppStorage } from '../storage/app-storage'
import {
  addNotice,
  getNotice,
  listOpenNotices,
  resolveStoredNotice,
  type StoredNotice
} from '../storage/notices'
import { getProject, listProjects } from '../storage/records'

/**
 * "Ask me" notices (FR-11.4, FR-11.7). Any main-process module records one with
 * `recordNotice`; the renderer lists them with `notices:list` and answers with
 * `notices:resolve`. Each kind registers what its actions do with
 * `registerNoticeKind`; listeners (the setup runner, for example) hear the
 * answer with `onNoticeResolved`. A kind with no handler just closes.
 */

export interface NoticeHost {
  storage: AppStorage
  logger: Pick<Logger, 'warn'>
  now: () => Date
}

/** Applies one action and returns what CiteFox did, in plain words. */
export type NoticeKindHandler = (
  notice: StoredNotice,
  actionId: string,
  host: NoticeHost
) => string | Promise<string>

export type NoticeListener = (notice: StoredNotice, actionId: string) => void

const handlers = new Map<string, NoticeKindHandler>()
const listeners = new Map<string, Set<NoticeListener>>()

export function registerNoticeKind(kind: string, handler: NoticeKindHandler): void {
  handlers.set(kind, handler)
}

/** Returns an unsubscribe. */
export function onNoticeResolved(kind: string, listener: NoticeListener): () => void {
  const set = listeners.get(kind) ?? new Set<NoticeListener>()
  set.add(listener)
  listeners.set(kind, set)
  return () => {
    set.delete(listener)
  }
}

export interface RecordNoticeInput {
  kind: string
  projectId: string | null
  dedupeKey: string
  title: string
  body: string
  actions: readonly NoticeAction[]
  data?: Readonly<Record<string, string | number | boolean | null>>
}

/**
 * Stores the notice unless the same key is still open, then pushes
 * `notices:changed`. Returns true when it was new. Never throws: a notice that
 * cannot be written is logged, and the caller's work goes on.
 */
export function recordNotice(
  host: NoticeHost,
  input: RecordNoticeInput,
  secrets: readonly string[] = []
): boolean {
  try {
    const added = addNotice(host.storage.db, {
      id: `notice-${randomUUID()}`,
      kind: input.kind,
      projectId: input.projectId,
      dedupeKey: input.dedupeKey,
      title: redactString(input.title, { secrets }),
      body: redactString(input.body, { secrets }),
      actions: input.actions,
      data: input.data ?? {},
      createdAt: host.now().toISOString()
    })
    if (added) emitMainEvent('notices:changed', listNotices(host.storage))
    return added
  } catch (error) {
    host.logger.warn('could not record a notice', {
      message: error instanceof Error ? error.message : 'write failed'
    })
    return false
  }
}

export function listNotices(storage: AppStorage): NoticeList {
  const names = new Map(listProjects(storage.db).map((project) => [project.id, project.name]))
  return {
    notices: listOpenNotices(storage.db).map((notice) => publicNotice(notice, names))
  }
}

export async function resolveNotice(
  host: NoticeHost,
  request: ResolveNoticeRequest
): Promise<ResolveNoticeResult> {
  const channel = 'notices:resolve'
  const notice = getNotice(host.storage.db, request.noticeId)
  if (notice === null) throw new IpcRequestError(channel, 'That notice was not found')
  if (notice.resolvedAt !== null) {
    throw new IpcRequestError(channel, 'That notice was already answered')
  }
  if (!notice.actions.some((action) => action.id === request.actionId)) {
    throw new IpcRequestError(channel, 'That choice is not on this notice')
  }
  const handler = handlers.get(notice.kind)
  const message = handler === undefined ? 'Done.' : await handler(notice, request.actionId, host)
  resolveStoredNotice(host.storage.db, notice.id, request.actionId, host.now().toISOString())
  for (const listener of listeners.get(notice.kind) ?? []) {
    try {
      listener(notice, request.actionId)
    } catch (error) {
      host.logger.warn('notice listener failed', {
        message: error instanceof Error ? error.message : 'failed'
      })
    }
  }
  emitMainEvent('notices:changed', listNotices(host.storage))
  const stored = getNotice(host.storage.db, notice.id) ?? notice
  const name = notice.projectId === null ? null : getProject(host.storage.db, notice.projectId)
  return {
    notice: publicNotice(stored, new Map(name === null ? [] : [[name.id, name.name]])),
    message
  }
}

function publicNotice(notice: StoredNotice, names: ReadonlyMap<string, string>): Notice {
  return {
    id: notice.id,
    kind: notice.kind,
    projectId: notice.projectId,
    projectName: notice.projectId === null ? null : (names.get(notice.projectId) ?? null),
    title: notice.title,
    body: notice.body,
    actions: notice.actions,
    createdAt: notice.createdAt,
    resolvedAt: notice.resolvedAt,
    resolution: notice.resolution
  }
}
