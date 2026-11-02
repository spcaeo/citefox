// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { leaveOverlayHash, normalHash, pushOverlayHash } from './screenOverlay'

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

afterEach(() => {
  window.history.replaceState(null, '', '#/')
})

describe('screen overlay history', () => {
  it('compares hashes without caring about key order or the leading #', () => {
    expect(normalHash('#/topics?b=2&a=1')).toBe(normalHash('/topics?a=1&b=2'))
    expect(normalHash('#/topics?a=')).toBe('/topics')
    expect(normalHash('')).toBe('/')
  })

  it('opening is a new entry, and closing steps back to it', async () => {
    window.history.replaceState(null, '', '#/overview')
    const before = window.history.length
    pushOverlayHash('#/overview?panel=method')
    await settle()
    expect(window.location.hash).toBe('#/overview?panel=method')
    expect(window.history.length).toBe(before + 1)
    leaveOverlayHash('#/overview')
    await settle()
    expect(window.location.hash).toBe('#/overview')
    // Forward is the closed drawer again; Back from the screen does not reopen it.
    window.history.forward()
    await settle()
    expect(window.location.hash).toBe('#/overview?panel=method')
  })

  it('a pasted link has nothing to go back to: closing rewrites the URL', async () => {
    window.history.replaceState(null, '', '#/overview')
    window.history.replaceState(null, '', '#/overview?panel=method')
    leaveOverlayHash('#/overview')
    expect(window.location.hash).toBe('#/overview')
  })
})
