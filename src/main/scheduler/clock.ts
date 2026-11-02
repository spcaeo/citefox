/**
 * Injected time source for the check queue.
 * Scheduler functions take `nowMs` from the caller instead.
 * Neither reads `Date.now`.
 */
export interface Clock {
  now(): number
}

/** A clock that always reports the same instant. */
export function fixedClock(nowMs: number): Clock {
  return {
    now(): number {
      return nowMs
    }
  }
}

/** A clock tests can move without touching `Date.now`. */
export function manualClock(startMs: number): Clock & { set(nowMs: number): void } {
  let current = startMs
  return {
    now(): number {
      return current
    },
    set(nowMs: number): void {
      current = nowMs
    }
  }
}
