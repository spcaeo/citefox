import { useEffect } from 'react'
import type { QueueStatus } from '@shared/domain'
import type { CheckFinishedNotice } from '@shared/ipc'
import { useLatest } from '../components/useLatest'

/** Quiet time after the last push before the shell reloads. */
export const ENGINE_UPDATE_DELAY_MS = 400

/** The two pushes main broadcasts when background or scheduled work changes data. */
export interface EngineEvents {
  onCheckFinished(listener: (notice: CheckFinishedNotice) => void): () => void
  onQueueStatus(listener: (status: QueueStatus) => void): () => void
}

export interface EngineUpdate {
  /** Projects named by `checks:finished` since the last update. */
  projectIds: readonly string[]
  /** The latest `queue:status`, or null when none arrived. */
  queue: QueueStatus | null
}

/**
 * Subscribes once to `checks:finished` and `queue:status` and calls `onUpdate`
 * after a quiet `delayMs`, so a burst of pushes becomes one reload.
 * `onUpdate` may change on every render without resubscribing.
 */
export function useEngineUpdates(
  events: EngineEvents,
  onUpdate: (update: EngineUpdate) => void,
  delayMs: number = ENGINE_UPDATE_DELAY_MS
): void {
  const latest = useLatest(onUpdate)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let projectIds = new Set<string>()
    let queue: QueueStatus | null = null

    function schedule(): void {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const update: EngineUpdate = { projectIds: [...projectIds], queue }
        projectIds = new Set()
        queue = null
        latest.current(update)
      }, delayMs)
    }

    const offFinished = events.onCheckFinished((notice) => {
      projectIds.add(notice.projectId)
      schedule()
    })
    const offQueue = events.onQueueStatus((status) => {
      queue = status
      schedule()
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      offFinished()
      offQueue()
    }
  }, [events, delayMs, latest])
}
