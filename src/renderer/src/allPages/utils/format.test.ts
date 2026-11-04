import { describe, expect, it } from 'vitest'
import { checkedLabel } from './format'

describe('checkedLabel', () => {
  const now = new Date('2026-10-29T20:00:00Z')

  it('shows the time of a check, today or another day (owner rule: events show their time)', () => {
    expect(checkedLabel('2026-10-29T15:12:00Z', now)).toBe('Today 3:12 PM')
    expect(checkedLabel('2026-10-19T15:12:00Z', now)).toBe('Oct 19, 3:12 PM')
  })

  it('reads an em dash when no check ran', () => {
    expect(checkedLabel(null, now)).toBe('—')
    expect(checkedLabel('not a date', now)).toBe('—')
  })
})
