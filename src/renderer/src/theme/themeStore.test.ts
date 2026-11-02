// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemePreference } from '@shared/domain'
import type { AppSettingsSnapshot, ThemeChangedEvent } from '@shared/ipc'
import {
  DARK_QUERY,
  getResolvedTheme,
  setThemePreference,
  startThemeSync,
  subscribeTheme,
  type ThemeBridge
} from './themeStore'

/** prefers-color-scheme the test can flip, like macOS switching appearance. */
function fakeMedia(dark: boolean): { set(dark: boolean): void } {
  let matches = dark
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === DARK_QUERY ? matches : false
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
  }))
  return {
    set(next) {
      matches = next
      for (const listener of listeners) listener()
    }
  }
}

function fakeBridge(saved: ThemePreference | undefined): ThemeBridge & {
  push(theme: ThemePreference): void
} {
  const listeners = new Set<(payload: ThemeChangedEvent) => void>()
  return {
    'settings:get': () =>
      Promise.resolve({
        settings: { theme: saved },
        dataDirectory: '/data'
      } as unknown as AppSettingsSnapshot),
    'settings:themeChanged': (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push(theme) {
      for (const listener of listeners) listener({ theme })
    }
  }
}

const html = (): string | undefined => document.documentElement.dataset.theme

beforeEach(() => {
  setThemePreference('system')
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('theme store', () => {
  it('writes the resolved theme to <html data-theme>, never "system"', () => {
    fakeMedia(true)
    setThemePreference('system')
    expect(html()).toBe('dark')
    setThemePreference('light')
    expect(html()).toBe('light')
    setThemePreference('dark')
    expect(html()).toBe('dark')
  })

  it('follows the computer live in system mode only', () => {
    const media = fakeMedia(false)
    const stop = startThemeSync(null)
    expect(html()).toBe('light')
    media.set(true)
    expect(html()).toBe('dark')
    setThemePreference('light')
    media.set(false)
    media.set(true)
    expect(html()).toBe('light')
    stop()
  })

  it('loads the saved choice from main and follows its pushes', async () => {
    fakeMedia(false)
    const bridge = fakeBridge('dark')
    const seen: string[] = []
    const off = subscribeTheme(() => seen.push(getResolvedTheme()))
    const stop = startThemeSync(bridge)
    await vi.waitFor(() => {
      expect(html()).toBe('dark')
    })
    bridge.push('light')
    expect(html()).toBe('light')
    bridge.push('system')
    expect(html()).toBe('light')
    expect(seen).toEqual(['dark', 'light', 'light'])
    stop()
    bridge.push('dark')
    expect(html()).toBe('light')
    off()
  })

  it('keeps following the computer when the saved choice is missing', async () => {
    fakeMedia(true)
    const stop = startThemeSync(fakeBridge(undefined))
    await Promise.resolve()
    expect(html()).toBe('dark')
    stop()
  })
})
