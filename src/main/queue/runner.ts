import { CHECK_CANCELLED_MESSAGE } from '../engine/checks'
import { redactString } from '../logging/redact'
import type { CheckQueue } from './check-queue'
import type { RunningJob } from './types'

/**
 * One search a page check finished.
 * `slotId` is the queue slot that search is counted on (SERP-6).
 * The queue chooses the key. The runner does not see the secret.
 */
export interface CheckSearch {
  slotId: string
  /**
   * The key that made the search, when the runner already wrote it to
   * `key_usage` as it happened (the engine does). The queue then counts it on
   * this key and does not write it again. Omitted: the queue picks the key
   * from its reservation and writes the row itself.
   */
  keyId?: string
}

/**
 * What one page check reports back to the queue.
 * `rate_limited` carries Retry-After when the provider sent it (decision 21).
 * `message` on `error` is redacted before it is stored or logged (NFR-5).
 * `cancelled` is a user cancel (NFR-3, SCH-11). It is not a failure.
 */
export type CheckRunResult =
  | {
      outcome: 'ok'
      searches: readonly CheckSearch[]
      /**
       * Section 10 run id for a follow-up that succeeded.
       * The scheduler stores it on the fix. Omit it and the fix stays planned.
       */
      runId?: string
    }
  | {
      outcome: 'rate_limited'
      /** Retry-After header: delay-seconds or an HTTP-date. Omit when the provider sent none. */
      retryAfter?: string
      searches: readonly CheckSearch[]
    }
  | { outcome: 'error'; message: string; searches: readonly CheckSearch[] }
  | { outcome: 'cancelled'; searches: readonly CheckSearch[] }

/**
 * `createCheckRunner` reports a user cancel as an error with this message.
 * Owned callers map it to `cancelled` and do not edit the engine.
 */
export { CHECK_CANCELLED_MESSAGE }

/**
 * How the queue executes one page check (SCH-4, SCH-11).
 * CiteFox Engine will supply the real runner. This module does not call the pipeline,
 * a provider, or storage.
 */
export interface CheckRunner {
  run(job: RunningJob): Promise<CheckRunResult>
}

/** Counts and outcome after the queue has applied a runner result. */
export interface AppliedCheck {
  outcome: CheckRunResult['outcome']
  searchesCommitted: number
  /** A further search was refused because the project cap had no room (decision 22). */
  capBlocked: boolean
  /** Redacted. Set when `outcome` is `error`. Null for a cancel. */
  message: string | null
}

/**
 * Map the engine's cancel error onto the typed `cancelled` outcome.
 * Any other result is unchanged. The match is the exact engine sentence.
 */
export function normalizeCheckRunResult(result: CheckRunResult): CheckRunResult {
  if (result.outcome === 'error' && result.message === CHECK_CANCELLED_MESSAGE) {
    return { outcome: 'cancelled', searches: result.searches }
  }
  return result
}

/**
 * Count the searches the runner used, then finish or requeue the job.
 * A rate limit commits the searches already made and puts the job back to waiting
 * (decision 21, FR-11.7). An error, a cancel, or a success takes the job out of `running`.
 * A cancel is not an error and is not requeued (NFR-3). The day pass holds the page
 * for the rest of the local day.
 */
export function applyCheckResult(
  queue: CheckQueue,
  job: RunningJob,
  result: CheckRunResult,
  secrets: readonly string[] = []
): AppliedCheck {
  const reported = cancelForJob(job, normalizeCheckRunResult(result))
  let searchesCommitted = 0
  let capBlocked = false
  for (const search of reported.searches) {
    if (search.keyId !== undefined) {
      const charged = queue.commitCharged(job.id, search.keyId)
      if (!charged.ok) break
      searchesCommitted += 1
      continue
    }
    const taken = queue.takeKey(job.id, search.slotId)
    if (!taken.ok) {
      if (taken.reason === 'project_cap') capBlocked = true
      break
    }
    const committed = queue.commitSearch(job.id, search.slotId)
    if (!committed.ok) {
      if (committed.reason === 'project_cap') capBlocked = true
      break
    }
    searchesCommitted += 1
  }
  if (reported.outcome === 'rate_limited') {
    const waited = queue.rateLimit(
      job.id,
      reported.retryAfter === undefined ? undefined : { retryAfter: reported.retryAfter }
    )
    if (waited.ok) {
      return { outcome: 'rate_limited', searchesCommitted, capBlocked, message: null }
    }
    return { outcome: 'cancelled', searchesCommitted, capBlocked, message: null }
  }
  const finished = queue.complete(job.id)
  if (
    reported.outcome === 'cancelled' ||
    (finished.ok && finished.status === 'cancelled' && reported.outcome !== 'ok')
  ) {
    return { outcome: 'cancelled', searchesCommitted, capBlocked, message: null }
  }
  if (reported.outcome === 'error') {
    return {
      outcome: 'error',
      searchesCommitted,
      capBlocked,
      message: redactString(reported.message, { secrets })
    }
  }
  return { outcome: 'ok', searchesCommitted, capBlocked, message: null }
}

/**
 * A queue cancel that did not finish successfully is `cancelled`, not an error to retry.
 * A check that already returned `ok` stays `ok`.
 */
function cancelForJob(job: RunningJob, result: CheckRunResult): CheckRunResult {
  if (result.outcome === 'cancelled') return result
  if (job.cancelRequested && result.outcome !== 'ok') {
    return { outcome: 'cancelled', searches: result.searches }
  }
  return result
}

/** After a successful run, tell the caller so it can store last-checked and a follow-up run id. */
export function recordingCheckRunner(
  inner: CheckRunner,
  record: (
    job: RunningJob,
    result: { outcome: 'ok'; searches: readonly CheckSearch[]; runId?: string }
  ) => void
): CheckRunner {
  return {
    async run(job: RunningJob): Promise<CheckRunResult> {
      const result = normalizeCheckRunResult(await inner.run(job))
      if (result.outcome === 'ok') record(job, result)
      return result
    }
  }
}

/**
 * A runner whose replies are scripted. `attempt` starts at 1 for each job id,
 * so a rate-limit test can fail once and then succeed.
 */
export function fixtureCheckRunner(
  respond: (job: RunningJob, attempt: number) => CheckRunResult | Promise<CheckRunResult>
): CheckRunner & { jobs: RunningJob[] } {
  const jobs: RunningJob[] = []
  const attempts = new Map<string, number>()
  return {
    jobs,
    async run(job: RunningJob): Promise<CheckRunResult> {
      jobs.push(job)
      const attempt = (attempts.get(job.id) ?? 0) + 1
      attempts.set(job.id, attempt)
      return respond(job, attempt)
    }
  }
}

/**
 * Used when the engine has not installed a pipeline runner.
 * A due page fails closed instead of being marked checked.
 */
export function unavailableCheckRunner(): CheckRunner {
  return {
    async run(): Promise<CheckRunResult> {
      return {
        outcome: 'error',
        message: 'Page checks are not available in this build.',
        searches: []
      }
    }
  }
}
