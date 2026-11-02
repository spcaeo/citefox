import { describe, expect, test } from 'vitest'
import { isOutOfSearches } from './usage'

describe('isOutOfSearches', () => {
  test('is true only when the test reason is out of searches', () => {
    expect(isOutOfSearches({ reason: 'out_of_searches' })).toBe(true)
    expect(isOutOfSearches({ reason: 'rejected' })).toBe(false)
    expect(isOutOfSearches({ reason: 'rate_limited' })).toBe(false)
    expect(isOutOfSearches({ reason: 'timeout' })).toBe(false)
    expect(isOutOfSearches({ reason: 'other' })).toBe(false)
    expect(isOutOfSearches({ reason: null })).toBe(false)
    expect(isOutOfSearches(null)).toBe(false)
  })
})
