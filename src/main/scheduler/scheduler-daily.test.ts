import { describe, expect, test } from 'vitest'
import { MS_PER_DAY, planSchedule } from './index'
import { intervalElapsedAt } from './release'
import type { IntervalDays } from '@shared/domain'
import type { AppSchedule, ScheduledPageInput, ScheduledProjectInput } from './index'

/**
 * "Every day" checks (owner, 2026-11-01): a daily page is due at the check time on the
 * next local day, whatever hour it last ran. No skipped day, no second run the same
 * day, one catch-up after sleep, and the 25-hour day when the clocks go back.
 */

const APP: AppSchedule = {
  startAtLogin: false,
  catchUpAfterSleep: true,
  checkWhenClosed: false,
  dailyCheckTime: '08:00'
}

function project(patch: Partial<ScheduledProjectInput> = {}): ScheduledProjectInput {
  return {
    projectId: 'proj-1',
    defaultIntervalDays: 1,
    dailyCheckTime: '08:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    archived: false,
    nextCheckAt: null,
    pagesDueToday: 0,
    ...patch
  }
}

function page(lastCheckedAt: string, intervalDays: IntervalDays = 1): ScheduledPageInput {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    label: 'Alerts',
    title: 'Text alerts',
    url: 'https://textbolt.com/text-alerts',
    status: 'tracked',
    intervalDays,
    promptSetVersion: null,
    markets: [{ marketId: 'us', lastCheckedAt, firstCheckNotBefore: null }]
  }
}

function plan(
  lastCheckedAt: string,
  now: string,
  options: { timeZone?: string; project?: Partial<ScheduledProjectInput>; days?: 1 | 7 } = {}
): ReturnType<typeof planSchedule> {
  return planSchedule(
    {
      app: APP,
      projects: [project(options.project)],
      pages: [page(lastCheckedAt, options.days ?? 1)]
    },
    Date.parse(now),
    options.timeZone ?? 'UTC'
  )
}

describe('every day', () => {
  test('due at the check time the next day, not 24 hours after a late run', () => {
    // Yesterday's check ran late (22:30, after the computer woke up).
    // Listed for today from the morning on, due at 08:00 rather than at 22:30.
    const before = plan('2026-04-05T22:30:00.000Z', '2026-04-06T07:00:00.000Z')
    expect(before.due.pages[0]?.dueAt).toBe('2026-04-06T08:00:00.000Z')
    expect(before.projects[0]?.nextCheckAt).toBe('2026-04-06T08:00:00.000Z')

    const onTime = plan('2026-04-05T22:30:00.000Z', '2026-04-06T08:00:00.000Z')
    expect(onTime.due.pages).toHaveLength(1)
    expect(onTime.due.pages[0]).toMatchObject({
      reason: 'scheduled',
      dueAt: '2026-04-06T08:00:00.000Z',
      intervalDays: 1
    })
  })

  test('a check that finished a few minutes after the check time does not drift later', () => {
    const next = plan('2026-04-05T08:04:00.000Z', '2026-04-06T07:59:00.000Z')
    expect(next.projects[0]?.nextCheckAt).toBe('2026-04-06T08:00:00.000Z')
  })

  test('checked today (on schedule or by Check now): not due again until tomorrow', () => {
    const evening = plan('2026-04-06T08:02:00.000Z', '2026-04-06T23:59:00.000Z')
    expect(evening.due.pages).toEqual([])
    expect(evening.projects[0]?.nextCheckAt).toBe('2026-04-07T08:00:00.000Z')

    const earlyCheckNow = plan('2026-04-06T06:00:00.000Z', '2026-04-06T09:00:00.000Z')
    expect(earlyCheckNow.due.pages).toEqual([])
  })

  test('days missed while asleep catch up once on wake, not once per missed day', () => {
    const wake = plan('2026-04-01T08:01:00.000Z', '2026-04-06T06:30:00.000Z')
    expect(wake.due.pages).toHaveLength(1)
    expect(wake.due.pages[0]).toMatchObject({
      reason: 'catch_up',
      dueAt: '2026-04-02T08:00:00.000Z',
      marketIds: ['us']
    })

    // Catch-up off: the missed days wait for today's check time.
    const waits = plan('2026-04-01T08:01:00.000Z', '2026-04-06T06:30:00.000Z', {
      project: { catchUp: false }
    })
    expect(waits.due.pages[0]).toMatchObject({
      reason: 'scheduled',
      dueAt: '2026-04-06T08:00:00.000Z'
    })
  })

  test('the 25-hour day when the clocks go back still runs once', () => {
    // New York, Nov 1 2026: 00:30 EDT is 04:30Z; 24 hours later is 23:30 EST the same day.
    const zone = 'America/New_York'
    const lateSameDay = plan('2026-11-01T04:30:00.000Z', '2026-11-02T04:45:00.000Z', {
      timeZone: zone
    })
    expect(lateSameDay.due.pages).toEqual([])
    // Next day 08:00 EST is 13:00Z.
    expect(lateSameDay.projects[0]?.nextCheckAt).toBe('2026-11-02T13:00:00.000Z')
  })

  test('the 23-hour day when the clocks go forward does not skip a day', () => {
    // New York, Mar 8 2026 springs forward. Checked Mar 7 at 08:00 EST (13:00Z).
    const zone = 'America/New_York'
    const next = plan('2026-03-07T13:00:00.000Z', '2026-03-08T11:00:00.000Z', { timeZone: zone })
    // Mar 8 08:00 EDT is 12:00Z, the same calendar day as the 24-hour mark.
    expect(next.projects[0]?.nextCheckAt).toBe('2026-03-08T12:00:00.000Z')
    const due = plan('2026-03-07T13:00:00.000Z', '2026-03-08T12:00:00.000Z', { timeZone: zone })
    expect(due.due.pages).toHaveLength(1)
  })

  test('quiet hours still hold a daily check', () => {
    const quiet = plan('2026-04-05T08:00:00.000Z', '2026-04-06T08:00:00.000Z', {
      project: { quietFrom: '07:00', quietUntil: '09:30' }
    })
    expect(quiet.projects[0]?.nextCheckAt).toBe('2026-04-06T09:30:00.000Z')
  })
})

describe('every 7 days and longer', () => {
  test('stay exactly that many 24-hour days after the last check', () => {
    const last = Date.parse('2026-04-06T10:15:00.000Z')
    expect(intervalElapsedAt(last, 7, project(), 'UTC')).toBe(last + 7 * MS_PER_DAY)
    expect(intervalElapsedAt(last, 14, project(), 'UTC')).toBe(last + 14 * MS_PER_DAY)

    const early = plan('2026-04-06T10:15:00.000Z', '2026-04-13T09:00:00.000Z', { days: 7 })
    expect(early.projects[0]?.nextCheckAt).toBe('2026-04-13T10:15:00.000Z')
    const due = plan('2026-04-06T10:15:00.000Z', '2026-04-13T10:15:00.000Z', { days: 7 })
    expect(due.due.pages[0]).toMatchObject({ reason: 'scheduled', intervalDays: 7 })
  })
})
