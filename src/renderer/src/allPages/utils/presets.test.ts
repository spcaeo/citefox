import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'
import { dueBucket, WORKING_STATUSES } from './views'

const NOW = new Date(2026, 9, 23, 10, 0)

function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function preset(id: string): (typeof PRESETS)[number] {
  const found = PRESETS.find((item) => item.id === id)
  if (found === undefined) throw new Error(`missing preset ${id}`)
  return found
}

describe('All pages presets', () => {
  it('Tracked counts like the tile: tracked, setting up and paused', () => {
    expect([...(preset('tracked').state.filters?.status ?? [])].sort()).toEqual(
      [...WORKING_STATUSES].sort()
    )
  })

  it('Due soon keeps pages due within 7 days, not every tracked page', () => {
    const due = preset('due')
    expect(due.label).toBe('Due within 7 days')
    expect(due.state.filters?.status).toBeUndefined()
    expect([...(due.state.filters?.next ?? [])].sort()).toEqual(['today', 'week'])
  })

  it('buckets the next check: today (or overdue), within 7 days, later, none', () => {
    expect(dueBucket({ nextCheckAt: inDays(-2) }, NOW)).toBe('today')
    expect(dueBucket({ nextCheckAt: inDays(0) }, NOW)).toBe('today')
    expect(dueBucket({ nextCheckAt: inDays(3) }, NOW)).toBe('week')
    expect(dueBucket({ nextCheckAt: inDays(7) }, NOW)).toBe('week')
    expect(dueBucket({ nextCheckAt: inDays(10) }, NOW)).toBe('later')
    expect(dueBucket({ nextCheckAt: null }, NOW)).toBe('none')
  })
})
