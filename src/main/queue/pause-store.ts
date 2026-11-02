/**
 * SCH-11 pause, kept outside the process (decision 4, decision 10).
 * The tray and a separate `citefox --check-due` process read the same row, so
 * "pause all" and "pause for today" hold across restarts and in the headless job.
 * `day` is the local calendar date (`YYYY-MM-DD`) the today-pause was made on.
 * It expires at the next local midnight.
 */
export type StoredQueuePause = { state: 'paused_all' } | { state: 'paused_today'; day: string }

export interface QueuePauseStore {
  read(): StoredQueuePause | null
  /** Null clears the pause. */
  write(pause: StoredQueuePause | null): void
}

/** In-process stand-in. Tests and callers without storage inject this. */
export function memoryQueuePauseStore(initial: StoredQueuePause | null = null): QueuePauseStore {
  let current = initial
  return {
    read: () => current,
    write(pause: StoredQueuePause | null): void {
      current = pause === null ? null : { ...pause }
    }
  }
}
