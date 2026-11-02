import type { FixFollowUpInput } from '@shared/domain'
import { parseInstant } from './clock-time'
import { ScheduleError } from './errors'
import { FIX_FOLLOW_UP_DAY_OPTIONS, MS_PER_DAY } from './intervals'
import { releaseInstant } from './release'
import type { ProjectSchedule, ScheduledMarketInput, ScheduledPageInput } from './types'

/** FR-14.5. `next_scheduled` waits for the page's own interval (SCH-10). */
export const FIX_RECHECK_RULES = ['after_3_days', 'after_7_days', 'next_scheduled'] as const
export type FixRecheckRule = (typeof FIX_RECHECK_RULES)[number]

export type { FixFollowUpInput }

/**
 * SCH-10, FR-14.5. The instant the follow-up is planned for, before the
 * daily check time and quiet hours when the rule is a day offset.
 * `next_scheduled` already includes those gates.
 */
export function followUpRawAt(
  fix: FixFollowUpInput,
  page: ScheduledPageInput,
  market: ScheduledMarketInput,
  project: ProjectSchedule,
  timeZone: string
): number {
  const goLiveMs = parseInstant(fix.goLiveAt, 'go-live')
  if (fix.rule === 'after_3_days') return goLiveMs + FIX_FOLLOW_UP_DAY_OPTIONS[0] * MS_PER_DAY
  if (fix.rule === 'after_7_days') return goLiveMs + FIX_FOLLOW_UP_DAY_OPTIONS[1] * MS_PER_DAY
  return nextFullCheckAtOrAfter(page, market, project, timeZone, goLiveMs)
}

/**
 * The next scheduled check at or after go-live.
 * Missed intervals collapse into that one check.
 */
function nextFullCheckAtOrAfter(
  page: ScheduledPageInput,
  market: ScheduledMarketInput,
  project: ProjectSchedule,
  timeZone: string,
  goLiveMs: number
): number {
  let cursor =
    market.lastCheckedAt === null
      ? market.firstCheckNotBefore === null
        ? goLiveMs
        : parseInstant(market.firstCheckNotBefore, 'first check')
      : parseInstant(market.lastCheckedAt, 'last check') + page.intervalDays * MS_PER_DAY
  if (market.lastCheckedAt !== null) {
    let steps = 0
    while (cursor < goLiveMs) {
      cursor += page.intervalDays * MS_PER_DAY
      steps += 1
      if (steps > 10_000) throw new ScheduleError('Follow-up could not find a scheduled check')
    }
  } else if (cursor < goLiveMs) {
    cursor = goLiveMs
  }
  return releaseInstant(cursor, project, timeZone)
}
