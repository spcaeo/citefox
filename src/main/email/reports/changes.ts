import type { ChangeKind, ReportTiming } from '../types'

type OnChangeTiming = Extract<ReportTiming, { kind: 'on_change' }>

/**
 * FR-23.8. The event kind must be one the schedule watches.
 * A score drop counts only when the drop is strictly greater than `scoreDropPoints`.
 */
export function matchesOnChange(
  event: { kind: ChangeKind; points: number | null },
  timing: Pick<OnChangeTiming, 'events' | 'scoreDropPoints'>
): boolean {
  if (!timing.events.includes(event.kind)) return false
  if (event.kind !== 'score_drop') return true
  return event.points !== null && event.points > timing.scoreDropPoints
}
