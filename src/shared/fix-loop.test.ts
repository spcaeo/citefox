import { describe, expect, test } from 'vitest'
import type { PromptCheckRow, PromptCheckStatus } from './domain'
import {
  backlinkPriority,
  changeStatus,
  dayBucket,
  daysLive,
  inNextRound,
  isLostGround,
  lostQuestions,
  needsBacklinks
} from './fix-loop'

function row(promptId: string, status: PromptCheckStatus): PromptCheckRow {
  return { promptId, status } as PromptCheckRow
}

describe('daysLive', () => {
  test("counts the computer's calendar days: live today at 8 PM in Toronto is still day 0", () => {
    const zone = process.env.TZ
    process.env.TZ = 'America/Toronto'
    try {
      // Local midnight Nov 2 (05:00Z) to 8 PM Nov 2 local (01:00Z on Nov 3).
      expect(daysLive('2026-11-02T05:00:00.000Z', '2026-11-03T01:00:00.000Z')).toBe(0)
      expect(daysLive('2026-11-02T05:00:00.000Z', '2026-11-03T06:00:00.000Z')).toBe(1)
    } finally {
      process.env.TZ = zone
    }
  })

  test('counts calendar days, negative before go-live', () => {
    expect(daysLive('2026-10-20T23:00:00.000Z', '2026-10-21T01:00:00.000Z')).toBe(1)
    expect(daysLive('2026-10-21T00:00:00.000Z', '2026-10-21T23:59:00.000Z')).toBe(0)
    expect(daysLive('2026-10-25T00:00:00.000Z', new Date('2026-10-23T12:00:00.000Z'))).toBe(-2)
    expect(daysLive('not a date', '2026-10-21T00:00:00.000Z')).toBeNull()
  })
})

describe('dayBucket', () => {
  test.each([
    [0, '0-3'],
    [3, '0-3'],
    [4, '4-7'],
    [7, '4-7'],
    [8, '8-13'],
    [13, '8-13'],
    [14, '14+'],
    [200, '14+']
  ] as const)('%i days is %s', (days, bucket) => {
    expect(dayBucket(days)).toBe(bucket)
  })

  test('before go-live and unknown dates have no bucket', () => {
    expect(dayBucket(-1)).toBeNull()
    expect(dayBucket(null)).toBeNull()
  })
})

describe('lost ground', () => {
  test('needs at least 3 lost and at least 30% of the questions cited before', () => {
    expect(isLostGround({ citedBefore: 10, lost: 3 })).toBe(true)
    expect(isLostGround({ citedBefore: 10, lost: 2 })).toBe(false)
    expect(isLostGround({ citedBefore: 11, lost: 3 })).toBe(false)
    expect(isLostGround({ citedBefore: 3, lost: 3 })).toBe(true)
    expect(isLostGround({ citedBefore: 0, lost: 0 })).toBe(false)
  })

  test('lost questions are cited before, checked now and not cited now', () => {
    const before = [
      row('a', 'page_cited'),
      row('b', 'page_cited'),
      row('c', 'page_cited'),
      row('d', 'not_cited')
    ]
    const now = [row('a', 'page_cited'), row('b', 'other_own_page'), row('d', 'page_cited')]
    expect(lostQuestions(before, now).map((item) => item.promptId)).toEqual(['b'])
  })
})

describe('changeStatus', () => {
  const base = { daysLive: 10, citedBefore: 0, citedNow: 0, lost: 0, measuredSinceLive: true }

  test('lost ground wins when measured since go-live', () => {
    expect(changeStatus({ ...base, citedBefore: 8, citedNow: 4, lost: 4 })).toBe('lost')
    expect(
      changeStatus({ ...base, citedBefore: 8, citedNow: 4, lost: 4, measuredSinceLive: false })
    ).toBe('cited')
  })

  test('cited, then too new (3 days or fewer), else not cited yet', () => {
    expect(changeStatus({ ...base, citedNow: 1, daysLive: 1 })).toBe('cited')
    expect(changeStatus({ ...base, daysLive: 3 })).toBe('too_new')
    expect(changeStatus({ ...base, daysLive: -2 })).toBe('too_new')
    expect(changeStatus({ ...base, daysLive: 4 })).toBe('not_cited')
    expect(changeStatus({ ...base, daysLive: null })).toBe('too_new')
  })
})

describe('backlinks and the next round', () => {
  test('pages not cited, lost or not indexed need backlinks', () => {
    expect(needsBacklinks({ status: 'not_cited', daysLive: 5, index: null })).toBe(true)
    expect(needsBacklinks({ status: 'lost', daysLive: 5, index: 'indexed' })).toBe(true)
    expect(needsBacklinks({ status: 'too_new', daysLive: 1, index: 'not_indexed' })).toBe(true)
    expect(needsBacklinks({ status: 'cited', daysLive: 9, index: 'indexed' })).toBe(false)
  })

  test('first: lost, not cited after a week, or not indexed after 3 days', () => {
    expect(backlinkPriority({ status: 'lost', daysLive: 1, index: null })).toBe('first')
    expect(backlinkPriority({ status: 'not_cited', daysLive: 7, index: null })).toBe('first')
    expect(backlinkPriority({ status: 'not_cited', daysLive: 6, index: null })).toBe('next')
    expect(backlinkPriority({ status: 'too_new', daysLive: 4, index: 'not_indexed' })).toBe('first')
    expect(backlinkPriority({ status: 'too_new', daysLive: 2, index: 'not_indexed' })).toBe('next')
  })

  test('the next round takes pages not cited yet and lost ground', () => {
    expect(inNextRound({ status: 'not_cited', daysLive: 5, index: null })).toBe(true)
    expect(inNextRound({ status: 'lost', daysLive: 5, index: null })).toBe(true)
    expect(inNextRound({ status: 'too_new', daysLive: 1, index: null })).toBe(false)
    expect(inNextRound({ status: 'cited', daysLive: 9, index: null })).toBe(false)
  })
})
