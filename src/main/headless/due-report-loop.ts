import type { Logger } from '../logging/logger'

/** How often the running app looks for due weekly and monthly reports. */
export const REPORT_TICK_MS = 60_000

/** First look after start-up, so the window and the first checks go first. */
export const REPORT_FIRST_TICK_MS = 30_000

export interface ReportLoopTimers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/**
 * FR-23.7 and FR-23.12 while CiteFox runs in the tray. `--check-due` sends due weekly and
 * monthly reports only when the OS job runs (CiteFox closed, "Also check when CiteFox is
 * closed" on). Without this loop the running app never sent them. The throttle row each
 * send writes keeps this loop and a later `--check-due` from sending one occurrence twice.
 * Returns a stop function.
 */
export function startDueReportLoop(input: {
  deliver: () => Promise<void>
  logger: Pick<Logger, 'error'>
  timers?: ReportLoopTimers
}): () => void {
  const timers: ReportLoopTimers = input.timers ?? {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
  let stopped = false
  let handle: unknown = timers.set(tick, REPORT_FIRST_TICK_MS)

  function tick(): void {
    if (stopped) return
    void input
      .deliver()
      .catch((error: unknown) => {
        input.logger.error('CiteFox could not send due scheduled reports', error)
      })
      .finally(() => {
        if (!stopped) handle = timers.set(tick, REPORT_TICK_MS)
      })
  }

  return () => {
    stopped = true
    timers.clear(handle)
  }
}
