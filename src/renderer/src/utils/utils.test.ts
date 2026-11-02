import { describe, expect, it } from 'vitest'
import { formatClock as m3Clock, formatDay as m3Day, cycleSort as m3Cycle } from '../m3/model'
import { formatDay as setupDay } from '../pageSetup/model'
import { cycleSort as gridCycle } from '../projects/gridModel'
import { formatClock, formatDay, formatMoment, formatWhen } from './dates'
import { cycleSort } from './sort'

const ISO = '2026-10-19T23:30:00.000Z'

describe('one date helper', () => {
  it('formats a day and a clock in a given zone, with or without the year', () => {
    expect(formatDay(ISO, { timeZone: 'UTC' })).toBe('Oct 19, 2026')
    expect(formatDay(ISO, { timeZone: 'Asia/Tokyo', year: false })).toBe('Oct 20')
    expect(formatClock(ISO, { timeZone: 'America/Chicago', locale: 'en-US' })).toBe('6:30 PM')
    expect(formatClock(ISO, { timeZone: 'America/Chicago', locale: 'en-GB' })).toBe('18:30')
    expect(formatDay(ISO, { timeZone: 'UTC', locale: 'en-GB' })).toBe('19 Oct 2026')
    expect(formatDay(ISO, { timeZone: 'UTC', locale: 'en-GB', year: false })).toBe('19 Oct')
    expect(formatDay(null)).toBe('—')
    expect(formatDay('not a date')).toBe('—')
    expect(formatClock('not a date')).toBe('—')
  })

  it('backs the m3 and page setup helpers', () => {
    expect(m3Day(ISO)).toBe(formatDay(ISO))
    expect(m3Clock(ISO)).toBe(formatClock(ISO))
    expect(setupDay(ISO)).toBe(formatDay(ISO, { timeZone: 'UTC' }))
  })
})

describe('one sort cycle', () => {
  it('is the same function for the pages grid and the m3 grids', () => {
    expect(gridCycle).toBe(cycleSort)
    expect(m3Cycle).toBe(cycleSort)
    expect(cycleSort([], 'a', false)).toEqual([{ key: 'a', dir: 'asc' }])
    expect(cycleSort([{ key: 'a', dir: 'asc' }], 'a', false)).toEqual([{ key: 'a', dir: 'desc' }])
    expect(cycleSort([{ key: 'a', dir: 'desc' }], 'a', false)).toEqual([])
    expect(cycleSort([{ key: 'a', dir: 'asc' }], 'b', true)).toEqual([
      { key: 'a', dir: 'asc' },
      { key: 'b', dir: 'asc' }
    ])
  })
})

describe('formatMoment', () => {
  const now = new Date('2026-10-29T20:00:00Z')
  it('shows the day and the time, so two checks on one day read apart', () => {
    const first = formatMoment('2026-10-29T13:05:00Z', {
      timeZone: 'America/New_York',
      now,
      locale: 'en-US'
    })
    const second = formatMoment('2026-10-29T19:12:00Z', {
      timeZone: 'America/New_York',
      now,
      locale: 'en-US'
    })
    expect(first).toBe('Oct 29, 9:05 AM')
    expect(second).toBe('Oct 29, 3:12 PM')
  })
  it('adds the year only for another year, and follows a 24-hour clock language', () => {
    expect(formatMoment('2025-03-02T19:12:00Z', { timeZone: 'UTC', now, locale: 'en-US' })).toBe(
      'Mar 2, 2025, 7:12 PM'
    )
    expect(formatMoment('2026-10-29T19:12:00Z', { timeZone: 'UTC', now, locale: 'en-GB' })).toBe(
      '29 Oct, 19:12'
    )
  })
  it('reads a missing or broken moment as a dash', () => {
    expect(formatMoment(null)).toBe('—')
    expect(formatMoment('nope')).toBe('—')
  })
})

describe('formatClock', () => {
  it("follows the computer's clock style instead of forcing 24 hours", () => {
    const iso = '2026-10-29T15:12:00Z'
    expect(formatClock(iso, { timeZone: 'UTC', locale: 'en-US' })).toBe('3:12 PM')
    expect(formatClock(iso, { timeZone: 'UTC', locale: 'en-GB' })).toBe('15:12')
    expect(formatClock(null)).toBe('—')
  })
})

describe('formatWhen', () => {
  const now = new Date('2026-10-29T20:00:00Z')
  const options = { timeZone: 'UTC', now, locale: 'en-US' }
  it('reads a picked day (local midnight) as its day, with no made-up time', () => {
    expect(formatWhen('2026-10-19T00:00:00Z', options)).toBe('Oct 19')
    expect(formatWhen('2025-10-19T00:00:00Z', options)).toBe('Oct 19, 2025')
  })
  it('reads any other instant as a moment with its time', () => {
    expect(formatWhen('2026-10-19T15:12:00Z', options)).toBe('Oct 19, 3:12 PM')
    expect(formatWhen(null)).toBe('—')
  })
})
