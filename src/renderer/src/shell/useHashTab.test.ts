import { describe, expect, it } from 'vitest'
import { hashTab, withHashTab } from './useHashTab'

describe('tabs in the route', () => {
  it('reads ?tab= from a hash', () => {
    expect(hashTab('#/projects?tab=usage')).toBe('usage')
    expect(hashTab('#/projects')).toBeNull()
    expect(hashTab('#/x?view=a', 'view')).toBe('a')
  })

  it('sets and clears ?tab= and keeps other params', () => {
    expect(withHashTab('#/projects', 'usage')).toBe('#/projects?tab=usage')
    expect(withHashTab('#/projects?tab=usage', null)).toBe('#/projects')
    expect(withHashTab('#/x?dialog=reset', 'usage')).toBe('#/x?dialog=reset&tab=usage')
    expect(withHashTab('/x', 'a')).toBe('#/x?tab=a')
  })
})
