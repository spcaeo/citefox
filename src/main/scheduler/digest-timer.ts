import type { Logger } from '../logging/logger'

/** How often the running app looks for alert digests that came due. */
export const DIGEST_TICK_MS = 5 * 60_000

/** First look after start-up, so the window and the first checks go first. */
export const DIGEST_FIRST_TICK_MS = 45_000

export interface DigestTimers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/**
 * Alert rules with "one message a day" (Alerts & schedules › Alert rules): their waiting rows
 * go out once the oldest is a day old. Before this timer that happened only when
 * the next check of the project finished, so a quiet day (no check) held the
 * digest back. The main process now looks on a wall-clock tick while CiteFox
 * runs; `--check-due` looks once per OS job run. The day rule reads the alert
 * service's own clock, so tests drive it with a fake clock and fake timers.
 * Returns a stop function.
 */
export function startAlertDigestTimer(input: {
  /** Sends the digests that came due; resolves to the rows sent. */
  flush: () => Promise<number>
  logger: Pick<Logger, 'error' | 'info'>
  timers?: DigestTimers
}): () => void {
  const timers: DigestTimers = input.timers ?? {
    set: (run, ms) => {
      const handle = setTimeout(run, ms)
      handle.unref()
      return handle
    },
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
  let stopped = false
  let handle: unknown = timers.set(tick, DIGEST_FIRST_TICK_MS)

  function tick(): void {
    if (stopped) return
    void input
      .flush()
      .then((sent) => {
        if (sent > 0) input.logger.info('CiteFox sent daily alert digests', { rows: sent })
      })
      .catch((error: unknown) => {
        input.logger.error('CiteFox could not send daily alert digests', error)
      })
      .finally(() => {
        if (!stopped) handle = timers.set(tick, DIGEST_TICK_MS)
      })
  }

  return () => {
    stopped = true
    timers.clear(handle)
  }
}
