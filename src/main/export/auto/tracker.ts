import type { Logger } from '../../logging/logger'
import type { CheckedProjectPages } from './run'

/** A finished check as the queue reports it. `manual` is Check now. */
export interface FinishedCheck {
  projectId: string
  pageId: string
  reason: string
}

export interface AutoExportTracker {
  /** Remembers a successful scheduled check. Check now (`manual`) is ignored. */
  note(check: FinishedCheck): void
  /**
   * Runs the automatic exports for every check noted since the last flush, once
   * per project. Flushes never overlap; a failure is logged and not thrown.
   */
  flush(): Promise<void>
  /** What the next flush would run. */
  pending(): CheckedProjectPages[]
}

/**
 * FR-22.6 "after every scheduled check": the window's due pass and the headless
 * `--check-due` pass note each successful scheduled check, then flush once the
 * pass settles, so a pass that checks ten pages writes one file per export.
 */
export function createAutoExportTracker(
  run: (checked: CheckedProjectPages[]) => Promise<unknown>,
  logger?: Pick<Logger, 'error'>
): AutoExportTracker {
  const pending = new Map<string, Set<string>>()
  let chain: Promise<void> = Promise.resolve()
  const snapshot = (): CheckedProjectPages[] =>
    [...pending].map(([projectId, pageIds]) => ({ projectId, pageIds: new Set(pageIds) }))
  return {
    note(check): void {
      if (check.reason === 'manual') return
      const pages = pending.get(check.projectId) ?? new Set<string>()
      pages.add(check.pageId)
      pending.set(check.projectId, pages)
    },
    flush(): Promise<void> {
      // What was noted before this call is this flush's batch; later notes wait for the next.
      const batch = snapshot()
      pending.clear()
      chain = chain.then(async () => {
        if (batch.length === 0) return
        try {
          await run(batch)
        } catch (error: unknown) {
          logger?.error('CiteFox could not run automatic exports', error)
        }
      })
      return chain
    },
    pending: snapshot
  }
}
