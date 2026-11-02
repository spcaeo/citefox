import type { ReportScheduleListItem } from '@shared/domain'
import { formatClock } from '../../../utils/dates'
import { localDayKey } from '../../scheduleModel'

/** One upcoming send, in the schedule's own time zone. */
export interface Occurrence {
  /** `YYYY-MM-DD` in the schedule's time zone. */
  day: string
  /** Such as "Mon, Oct 27". */
  dayLabel: string
  /** Such as "08:00". */
  time: string
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})

function parseDay(day: string): { year: number; month: number; date: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) }
}

function dayKey(year: number, month: number, date: number): string {
  const value = new Date(Date.UTC(year, month - 1, date, 12))
  return value.toISOString().slice(0, 10)
}

function labelFor(day: string): string {
  const parts = parseDay(day)
  if (!parts) return day
  return DAY_LABEL.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.date, 12)))
}

function monthlyDay(year: number, month: number, when: '1' | '15' | 'last'): number {
  if (when === '1') return 1
  if (when === '15') return 15
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The next sends of a schedule (FR-23.7), first one from `nextSendAt`. Weekly
 * and monthly schedules list `count` slots; "after every check" knows only the
 * next check; a change alert and a paused schedule have none.
 */
export function upcomingSends(item: ReportScheduleListItem, count = 3): Occurrence[] {
  if (item.status === 'paused' || item.nextSendAt === null) return []
  const zone = item.timeZone
  const first = localDayKey(item.nextSendAt, zone)
  const timing = item.timing
  if (timing.kind !== 'weekly' && timing.kind !== 'monthly') {
    if (timing.kind === 'on_change') return []
    return [
      {
        day: first,
        dayLabel: labelFor(first),
        time: formatClock(item.nextSendAt, { timeZone: zone })
      }
    ]
  }
  const start = parseDay(first)
  if (!start) return []
  const days: string[] = [first]
  for (let step = 1; days.length < count && step < 24; step += 1) {
    if (timing.kind === 'weekly') {
      days.push(dayKey(start.year, start.month, start.date + 7 * step))
    } else {
      const month = start.month - 1 + step
      const year = start.year + Math.floor(month / 12)
      const monthNumber = (month % 12) + 1
      days.push(dayKey(year, monthNumber, monthlyDay(year, monthNumber, timing.when)))
    }
  }
  return days.map((day) => ({ day, dayLabel: labelFor(day), time: timing.time }))
}
