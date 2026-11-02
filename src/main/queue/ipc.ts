import { isQueuePauseScope } from '@shared/domain'
import type { ApiKeyMetadata, CheckDueResult, QueueStatus } from '@shared/domain'
import { IpcRequestError } from '../ipc-request'
import type { CheckSession } from '../scheduler/session'
import type { QueueKeyInput } from './types'

export interface QueueHandlers {
  getStatus(): QueueStatus
  pause(request: unknown): QueueStatus
  resume(): QueueStatus
  /** Joins the due pass already running in this process, or starts one (SCH-2). */
  checkDue(): Promise<CheckDueResult>
  /** Called after each due pass settles, whichever caller started it. */
  onPassSettled(listener: () => void): void
}

/**
 * `queue:getStatus`, `queue:pause`, `queue:resume`, and `queue:checkDue`.
 * `queue:status` is pushed when pause state, running, or waiting changes,
 * and when a search is counted. The payload is the same `QueueStatus` as the get.
 */
export function createQueueHandlers(session: CheckSession): QueueHandlers {
  return {
    getStatus(): QueueStatus {
      session.refresh()
      return session.queue.status()
    },
    pause(request: unknown): QueueStatus {
      const scope = parseQueuePauseScope(request)
      session.refresh()
      const previous = session.queue.status()
      const next = session.queue.pause(scope)
      if (statusChanged(previous, next)) session.emitStatus(next)
      return next
    },
    resume(): QueueStatus {
      session.refresh()
      const previous = session.queue.status()
      const next = session.queue.resume()
      if (statusChanged(previous, next)) session.emitStatus(next)
      return next
    },
    checkDue(): Promise<CheckDueResult> {
      return session.runDue()
    },
    onPassSettled(listener: () => void): void {
      session.onPassSettled(listener)
    }
  }
}

/**
 * Key rows the queue can show. `keychainRef` is not copied.
 * Month-to-date usage is not read here. The caps ledger takes it from `UsageSeedStore`.
 * `--check-due` fills that store from `getKeyUsageForMonth` (decision 26).
 */
export function queueKeysFromApiKeys(records: readonly ApiKeyMetadata[]): QueueKeyInput[] {
  return records.map((record) => ({
    keyId: record.id,
    name: record.name,
    provider: record.provider,
    cap: record.cap,
    planLimit: record.serpapiUsage === null ? null : record.serpapiUsage.planLimit,
    state: record.on ? record.state : 'off',
    rotationOrder: record.rotationOrder,
    projectIds: record.projectIds
  }))
}

export function parseQueuePauseScope(value: unknown): 'all' | 'today' {
  const channel = 'queue:pause'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'scope') throw new IpcRequestError(channel)
  if (typeof record.scope !== 'string' || !isQueuePauseScope(record.scope)) {
    throw new IpcRequestError(channel)
  }
  return record.scope
}

function statusChanged(previous: QueueStatus, next: QueueStatus): boolean {
  return (
    previous.state !== next.state ||
    previous.running !== next.running ||
    previous.waiting !== next.waiting
  )
}
