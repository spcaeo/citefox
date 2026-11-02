import type { PageReadResult } from '@shared/ipc'

const inflight = new Map<string, Promise<PageReadResult>>()

export function autoReadKey(projectId: string, pageId: string): string {
  return `${projectId}\u0000${pageId}`
}

export interface AutoReadClaim {
  /** The in-flight read. A joiner awaits the same promise as the owner. */
  promise: Promise<PageReadResult>
  /** True only for the caller that scheduled `start`. */
  owner: boolean
}

/**
 * One automatic read per page.
 * A stored read is left alone. A second caller while that read is running
 * (StrictMode, or a remount before the snapshot exists) joins it instead of
 * calling `readStart` again. The claim is recorded before `start` runs.
 */
export function takeAutoRead(
  key: string,
  stored: PageReadResult | null,
  start: () => Promise<PageReadResult>
): AutoReadClaim | null {
  if (stored !== null) return null
  const existing = inflight.get(key)
  if (existing) return { promise: existing, owner: false }
  const pending = Promise.resolve()
    .then(start)
    .finally(() => {
      if (inflight.get(key) === pending) inflight.delete(key)
    })
  inflight.set(key, pending)
  return { promise: pending, owner: true }
}

/** Drops in-flight claims. Tests use this so one case cannot leak into the next. */
export function resetAutoReads(): void {
  inflight.clear()
}
