import { describe, expect, test } from 'vitest'
import type { ReportSchedule } from '../types'
import { nextSendAt } from './next-send'

const ACTIVE = { paused: false, nextCheckAt: '2026-03-01T08:00:00.000Z' }
const PAUSED = { paused: true, nextCheckAt: '2026-03-01T08:00:00.000Z' }

describe('nextSendAt', () => {
  test('on_change is null, including when the project is active', () => {
    const schedule = row({
      timing: { kind: 'on_change', events: ['score_drop'], scoreDropPoints: 5 }
    })
    expect(nextSendAt(schedule, Date.parse('2026-02-04T12:00:00.000Z'), ACTIVE)).toBeNull()
  })

  test('weekly and monthly slots are ISO UTC instants at or after now', () => {
    const now = Date.parse('2026-02-04T12:00:00.000Z')
    expect(
      nextSendAt(row({ timing: { kind: 'weekly', day: 1, time: '08:00' } }), now, ACTIVE)
    ).toBe('2026-02-09T08:00:00.000Z')
    expect(
      nextSendAt(row({ timing: { kind: 'monthly', when: '1', time: '08:00' } }), now, ACTIVE)
    ).toBe('2026-03-01T08:00:00.000Z')
    expect(
      nextSendAt(
        row({ timing: { kind: 'monthly', when: '15', time: '08:00' } }),
        Date.parse('2026-02-15T07:00:00.000Z'),
        ACTIVE
      )
    ).toBe('2026-02-15T08:00:00.000Z')
    expect(
      nextSendAt(
        row({ timing: { kind: 'monthly', when: 'last', time: '08:00' } }),
        Date.parse('2026-02-28T08:00:00.000Z'),
        ACTIVE
      )
    ).toBe('2026-02-28T08:00:00.000Z')
    expect(
      nextSendAt(
        row({ timing: { kind: 'monthly', when: 'last', time: '08:00' } }),
        Date.parse('2026-02-28T08:00:00.001Z'),
        ACTIVE
      )
    ).toBe('2026-03-31T08:00:00.000Z')
  })

  test('the slot in the schedule time zone is converted to UTC', () => {
    const mondayMorning = Date.parse('2026-02-02T13:00:00.000Z')
    const schedule = row({
      timing: { kind: 'weekly', day: 1, time: '08:00' },
      timeZone: 'America/New_York'
    })
    expect(nextSendAt(schedule, mondayMorning, ACTIVE)).toBe('2026-02-02T13:00:00.000Z')
    expect(nextSendAt(schedule, mondayMorning + 1000, ACTIVE)).toBe('2026-02-09T13:00:00.000Z')
    const october = row({
      timing: { kind: 'weekly', day: 1, time: '08:00' },
      timeZone: 'America/New_York'
    })
    expect(nextSendAt(october, Date.parse('2026-10-05T12:00:00.000Z'), ACTIVE)).toBe(
      '2026-10-05T12:00:00.000Z'
    )
  })

  test('a paused project is null and a paused schedule still has its slot', () => {
    const now = Date.parse('2026-02-04T12:00:00.000Z')
    const weekly = row({ timing: { kind: 'weekly', day: 1, time: '08:00' } })
    expect(nextSendAt(weekly, now, PAUSED)).toBeNull()
    expect(nextSendAt({ ...weekly, status: 'paused' }, now, ACTIVE)).toBe(
      '2026-02-09T08:00:00.000Z'
    )
    expect(nextSendAt(weekly, now, null)).toBeNull()
  })

  test('after_check uses the project next check, and all-projects has none', () => {
    const now = Date.parse('2026-02-04T12:00:00.000Z')
    const schedule = row({ timing: { kind: 'after_check' } })
    expect(nextSendAt(schedule, now, ACTIVE)).toBe('2026-03-01T08:00:00.000Z')
    expect(nextSendAt(schedule, now, { paused: false, nextCheckAt: null })).toBeNull()
    expect(nextSendAt(schedule, now, PAUSED)).toBeNull()
    expect(nextSendAt({ ...schedule, projectId: null }, now, null)).toBeNull()
    expect(
      nextSendAt(
        { ...schedule, projectId: null, timing: { kind: 'weekly', day: 1, time: '08:00' } },
        now,
        null
      )
    ).toBe('2026-02-09T08:00:00.000Z')
  })
})

function row(overrides: Partial<ReportSchedule>): ReportSchedule {
  return {
    id: 'sched-1',
    name: 'Monday report',
    projectId: 'proj-1',
    timing: { kind: 'after_check' },
    format: 'summary',
    sections: [],
    marketIds: [],
    recipients: ['client@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides
  }
}
