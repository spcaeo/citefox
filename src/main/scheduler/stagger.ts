import { formatInstant } from './clock-time'
import { ScheduleError } from './errors'
import { MS_PER_DAY, STAGGER_WINDOW_DAYS } from './intervals'
import { addLocalDays, assertTimeZone } from './local-time'

export interface StaggerSlot {
  pageId: string
  /** Whole local days after the start. The first page is `0`. */
  dayOffset: number
  /** SCH-12. ISO-8601 UTC. Store this as `firstCheckNotBefore`. */
  firstCheckNotBefore: string
}

/**
 * SCH-12, FR-20.6. Spread first checks across `days` (default 7).
 * Page `i` of `n` waits `floor(i * days / n)` local days.
 * `timeZone` is the computer's local zone (decision 8), injected by the caller.
 */
export function staggerFirstChecks(
  pageIds: readonly string[],
  options: { startAt: string; timeZone: string; days?: number }
): StaggerSlot[] {
  const days = options.days ?? STAGGER_WINDOW_DAYS
  if (!Number.isInteger(days) || days < 1) {
    throw new ScheduleError('Stagger window must be a positive number of days')
  }
  assertTimeZone(options.timeZone)
  const startMs = Date.parse(options.startAt)
  if (Number.isNaN(startMs)) throw new ScheduleError('Stagger start time must be ISO-8601 UTC')
  if (pageIds.length === 0) return []
  const count = pageIds.length
  return pageIds.map((pageId, index) => {
    if (pageId.length === 0) throw new ScheduleError('Stagger page id is empty')
    const dayOffset = Math.floor((index * days) / count)
    const at = dayOffset === 0 ? startMs : addLocalDays(startMs, options.timeZone, dayOffset)
    return { pageId, dayOffset, firstCheckNotBefore: formatInstant(at) }
  })
}

export { MS_PER_DAY }
