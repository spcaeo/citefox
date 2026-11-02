import type { CapRule } from '@shared/domain'
import type { Logger } from '../../logging/logger'
import type { Prepared } from './prepare'

/**
 * FR-11.4. A check (manual, scheduled, or follow-up) stopped at the project's
 * search cap. Main turns a `notify` stop into the same desktop alert, email,
 * and notice a scheduled pass sends.
 */
export interface CapStopEvent {
  projectId: string
  name: string
  capRule: CapRule
  cap: number
  used: number
  /** `YYYY-MM` in the computer's timezone. */
  month: string
  reason: Prepared['reason']
}

export function reportCapStop(
  deps: { onCapStop?: (event: CapStopEvent) => void; logger: Pick<Logger, 'warn'> },
  prepared: Prepared
): void {
  const cap = prepared.queueProject.cap
  if (deps.onCapStop === undefined || cap === null) return
  try {
    deps.onCapStop({
      projectId: prepared.job.projectId,
      name: prepared.queueProject.name,
      capRule: prepared.queueProject.capRule,
      cap,
      used: prepared.projectUsed + prepared.job.searchesUsed,
      month: prepared.month,
      reason: prepared.reason
    })
  } catch (error) {
    deps.logger.warn('cap alert failed', {
      message: error instanceof Error ? error.message : 'failed'
    })
  }
}
