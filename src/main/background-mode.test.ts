import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { backgroundTestMode, focusWindow, revealWindow } from './background-mode'

function fakeWindow(visible = false): BrowserWindow & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    show: vi.fn(() => calls.push('show')),
    showInactive: vi.fn(() => calls.push('showInactive')),
    setOpacity: vi.fn((value: number) => calls.push(`opacity:${value}`)),
    focus: vi.fn(() => calls.push('focus')),
    isVisible: vi.fn(() => visible)
  } as unknown as BrowserWindow & { calls: string[] }
}

describe('background test mode', () => {
  it('only applies to unpackaged builds with CITEFOX_E2E_BACKGROUND=1', () => {
    expect(backgroundTestMode(false, { CITEFOX_E2E_BACKGROUND: '1' })).toBe(true)
    expect(backgroundTestMode(true, { CITEFOX_E2E_BACKGROUND: '1' })).toBe(false)
    expect(backgroundTestMode(false, {})).toBe(false)
  })

  it('shows normally outside background mode', () => {
    const win = fakeWindow()
    revealWindow(win, false, 'darwin')
    expect(win.calls).toEqual(['show'])
  })

  it('on macOS shows the window inactive and transparent', () => {
    const win = fakeWindow()
    revealWindow(win, true, 'darwin')
    expect(win.calls).toEqual(['opacity:0', 'showInactive'])
  })

  it('on Linux shows the window inactive but keeps it painted normally', () => {
    const win = fakeWindow()
    revealWindow(win, true, 'linux')
    expect(win.calls).toEqual(['showInactive'])
  })

  it('never focuses a window in background mode', () => {
    const win = fakeWindow(true)
    focusWindow(win, true)
    expect(win.calls).toEqual([])
    const normal = fakeWindow(true)
    focusWindow(normal, false)
    expect(normal.calls).toEqual(['show', 'focus'])
  })
})
