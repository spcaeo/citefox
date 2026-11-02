import type { EngineHost } from '../engine/host'
import { IpcRequestError } from '../ipc-request'
import {
  clearFirstCheckWaits,
  markFirstCheckWaits,
  readCheckWhenReady,
  writeCheckWhenReady
} from '../storage/first-check-waits'
import { listProjects } from '../storage/records'
import { openPooled } from './status'

/**
 * A page added on its own waits for the user's first check (owner feedback 5):
 * automatic setup never spends a search. Never throws; a failed write is logged
 * and the page is simply on the normal schedule.
 */
export function holdFirstCheck(host: EngineHost, projectId: string, pageId: string): void {
  try {
    const db = projectDb(host, projectId)
    if (db !== null) markFirstCheckWaits(db, pageId, host.now().toISOString())
  } catch (error) {
    host.logger.warn('could not hold the first check', { message: messageOf(error) })
  }
}

/** A check is starting for these pages (Start first check, Check now): release the wait. */
export function clearFirstCheckForPages(
  host: EngineHost,
  projectId: string,
  pageIds: readonly string[]
): void {
  try {
    const db = projectDb(host, projectId)
    if (db === null) return
    for (const pageId of pageIds) clearFirstCheckWaits(db, pageId)
  } catch (error) {
    host.logger.warn('could not release the first check', { message: messageOf(error) })
  }
}

/** `setup:checkWhenReady`: the project's "check automatically when ready" (default off). */
export function setCheckWhenReady(
  host: EngineHost,
  projectId: string,
  on: boolean
): { checkWhenReady: boolean } {
  const channel = 'setup:checkWhenReady'
  const db = projectDb(host, projectId)
  if (db === null) throw new IpcRequestError(channel, 'That project was not found')
  writeCheckWhenReady(db, on)
  return { checkWhenReady: readCheckWhenReady(db) }
}

function projectDb(host: EngineHost, projectId: string): ReturnType<typeof openPooled> {
  const project = listProjects(host.storage.db).find((item) => item.id === projectId)
  return project === undefined ? null : openPooled(host.storage, project)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'failed'
}
