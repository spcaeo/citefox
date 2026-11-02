import { describe, expect, test } from 'vitest'
import { formatMoment } from '../utils/dates'
import { formatReadStamp } from './model'

const AFTERNOON = '2026-10-19T14:02:00.000Z'
const EARLY = '2026-10-19T02:30:00.000Z'

describe('formatReadStamp', () => {
  test('formats the instant in the process zone and clock, and keeps an invalid value', () => {
    expect(formatReadStamp('not-a-date')).toBe('not-a-date')
    expect(formatReadStamp(AFTERNOON)).toBe(formatMoment(AFTERNOON))
    expect(formatReadStamp(EARLY)).toBe(formatMoment(EARLY))
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    // The computer's clock style decides 12- or 24-hour; the zone decides the time.
    if (zone === 'America/Toronto') {
      expect(formatReadStamp(AFTERNOON)).toMatch(/Oct 19.*10:02/)
      expect(formatReadStamp(EARLY)).toMatch(/Oct 18.*(10:30|22:30)/)
    }
    if (zone === 'UTC') {
      expect(formatReadStamp(AFTERNOON)).toMatch(/Oct 19.*(2:02|14:02)/)
      expect(formatReadStamp(EARLY)).toMatch(/Oct 19.*2:30/)
    }
  })
})
