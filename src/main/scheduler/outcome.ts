import type { CheckRunResult } from '../queue/runner'

/**
 * How one finished page check affects the day's schedule (NFR-3, SCH-11).
 * `skip` is a user cancel: not a failure and not put back on the queue.
 * The day pass already covers today, so the page sits out the rest of the local day.
 */
export type ScheduledCheckDisposition = 'done' | 'retry' | 'skip' | 'fail'

export function scheduledCheckDisposition(
  outcome: CheckRunResult['outcome']
): ScheduledCheckDisposition {
  if (outcome === 'cancelled') return 'skip'
  if (outcome === 'error') return 'fail'
  if (outcome === 'rate_limited') return 'retry'
  return 'done'
}
