import { describe, expect, it } from 'vitest'
import { START_WAYS } from './examples'
import { WAYS_TO_START_LABEL, startWayOptions } from './ways'

describe('the one list of ways to start', () => {
  it('counts its own ways', () => {
    expect(START_WAYS).toHaveLength(6)
    expect(WAYS_TO_START_LABEL).toBe('Six ways to start')
  })

  it('gives every way an icon and title, Search Console as coming later', () => {
    const options = startWayOptions({ domain: 'textbolt.com' })
    expect(options.map((option) => option.id)).toEqual([...START_WAYS])
    expect(options.find((option) => option.id === 'gsc')?.later).toBe(true)
    expect(options.filter((option) => option.later)).toHaveLength(1)
  })
})
