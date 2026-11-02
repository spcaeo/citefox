import type { SetupCandidate } from '../storage/page-setup-jobs'
import { STAGGER_LEAD_MS } from './constants'

/** Why a waiting page is not started now. */
export type SetupHold = 'failed' | 'retry_later' | 'stagger' | null

/**
 * Whether one page still setting up may start now. Pure; reads only `nowMs`.
 * - A page that failed for good waits for Retry.
 * - A page waiting to retry waits for its time.
 * - A page whose first check is held for stagger starts `STAGGER_LEAD_MS` before it.
 */
export function holdFor(candidate: SetupCandidate, nowMs: number): SetupHold {
  const job = candidate.job
  if (job?.state === 'failed') return 'failed'
  if (job?.state === 'retry' && job.nextAttemptAt !== null) {
    if (Date.parse(job.nextAttemptAt) > nowMs) return 'retry_later'
  }
  if (candidate.firstCheckNotBefore !== null) {
    if (Date.parse(candidate.firstCheckNotBefore) - STAGGER_LEAD_MS > nowMs) return 'stagger'
  }
  return null
}

/**
 * Oldest first: the page whose first check comes soonest, then the page tracked
 * first. A page with no stagger hold is due from when it was tracked.
 */
export function compareCandidates(left: SetupCandidate, right: SetupCandidate): number {
  const a = dueKey(left)
  const b = dueKey(right)
  if (a !== b) return a < b ? -1 : 1
  const at = left.trackedAt ?? ''
  const bt = right.trackedAt ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return left.pageId < right.pageId ? -1 : left.pageId > right.pageId ? 1 : 0
}

/** The earliest time a held page may start, or null when only the user can release it. */
export function releaseAt(candidate: SetupCandidate, hold: SetupHold): number | null {
  if (hold === 'retry_later' && candidate.job?.nextAttemptAt) {
    return Date.parse(candidate.job.nextAttemptAt)
  }
  if (hold === 'stagger' && candidate.firstCheckNotBefore !== null) {
    return Date.parse(candidate.firstCheckNotBefore) - STAGGER_LEAD_MS
  }
  return null
}

function dueKey(candidate: SetupCandidate): string {
  return candidate.firstCheckNotBefore ?? candidate.trackedAt ?? ''
}
