import { describe, expect, it } from 'vitest'
import { releaseLine, releaseTime } from './release-line'

describe('release line', () => {
  it('has exactly the owner shape, in Toronto time', () => {
    expect(
      releaseLine({ version: '2.276.0', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' })
    ).toBe('v2.276.0 · build 1424 · Nov 2, 2026 8:49 AM EST')
  })

  it('shows EDT in summer, whatever the computer zone', () => {
    expect(releaseTime('2026-07-02T03:05:00.000Z')).toBe('Jul 1, 2026 11:05 PM EDT')
  })

  it('leaves out what the build does not know', () => {
    expect(releaseLine({ version: '0.12.0' })).toBe('v0.12.0')
    expect(releaseLine({ version: '0.12.0', number: null, builtAt: 'nonsense' })).toBe('v0.12.0')
    expect(releaseLine({ version: '0.12.0', number: 0, builtAt: '2026-11-02T13:49:00Z' })).toBe(
      'v0.12.0 · Nov 2, 2026 8:49 AM EST'
    )
  })
})
