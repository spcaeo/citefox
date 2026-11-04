import { describe, expect, it } from 'vitest'
import { formatExportDate } from './export/timezone'
import { dayText } from './assistant/packet-text'
import { day } from './ask/words'
import { formatMoment } from '../shared/moment'

const NOW = new Date('2026-11-03T12:00:00Z')

describe('formatMoment (shared, main and renderer)', () => {
  it('shows the day and the time in the zone asked for', () => {
    const iso = '2026-10-29T19:12:00Z'
    expect(formatMoment(iso, { timeZone: 'UTC', locale: 'en-US', now: NOW })).toBe(
      'Oct 29, 7:12 PM'
    )
    expect(formatMoment(iso, { timeZone: 'America/Toronto', locale: 'en-US', now: NOW })).toBe(
      'Oct 29, 3:12 PM'
    )
  })

  it('follows the computer clock style: a 24-hour locale reads 24-hour, never forced', () => {
    const iso = '2026-10-29T19:12:00Z'
    expect(formatMoment(iso, { timeZone: 'UTC', locale: 'en-GB', now: NOW })).toContain('19:12')
    expect(formatMoment(iso, { timeZone: 'UTC', locale: 'en-US', now: NOW })).toContain('PM')
  })

  it('writes the year when it is not this year, or when asked', () => {
    const options = { timeZone: 'UTC', locale: 'en-US', now: NOW }
    expect(formatMoment('2025-03-02T19:12:00Z', options)).toBe('Mar 2, 2025, 7:12 PM')
    expect(formatMoment('2026-03-02T19:12:00Z', { ...options, year: true })).toBe(
      'Mar 2, 2026, 7:12 PM'
    )
  })

  it('reads an em dash for a missing or broken time', () => {
    expect(formatMoment(null)).toBe('—')
    expect(formatMoment('nope')).toBe('—')
  })
})

describe('main-process dates carry a time in the computer zone, not UTC', () => {
  const iso = '2026-10-19T23:30:00Z'

  it('Ask CiteFox answers', () => {
    expect(day(iso, { timeZone: 'America/Toronto', locale: 'en-US' })).toBe('Oct 19, 2026, 7:30 PM')
    expect(day('not a date')).toBe('not a date')
  })

  it('the assistant packet keeps the numeric day of the same zone beside the words', () => {
    expect(dayText(iso, { timeZone: 'America/Toronto', locale: 'en-US' })).toBe(
      'Oct 19, 2026, 7:30 PM (2026-10-19)'
    )
    expect(dayText(iso, { timeZone: 'Asia/Tokyo', locale: 'en-US' })).toBe(
      'Oct 20, 2026, 8:30 AM (2026-10-20)'
    )
    expect(dayText(null)).toBe('unknown date')
  })

  it('report dates with a time never force a 24-hour clock', () => {
    expect(formatExportDate('2026-10-20T02:00:00Z', 'America/Toronto', true, 'en-US')).toBe(
      'Oct 19, 2026, 10:00 PM'
    )
    expect(formatExportDate('2026-10-20T02:00:00Z', 'America/Toronto')).toBe('Oct 19, 2026')
  })
})
