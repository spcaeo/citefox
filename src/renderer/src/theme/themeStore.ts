/**
 * The theme on screen (Settings › Appearance). `<html data-theme>` is always
 * the resolved theme, `light`, `dark` or `sepia`: tokens.css keys off it, and tests and
 * screenshots read it.
 *
 * The choice comes from main (`settings:get`, then `settings:themeChanged` when
 * Settings or View › Appearance changes it). For `system` the renderer follows
 * `prefers-color-scheme`, which main's `nativeTheme.themeSource` drives, and
 * updates live when the computer switches. public/theme-boot.js sets the first
 * value before the page paints.
 */

import { useSyncExternalStore } from 'react'
import type { AppSettingsSnapshot, ThemeChangedEvent } from '@shared/ipc'
import {
  DEFAULT_THEME,
  isThemePreference,
  type ResolvedTheme,
  type ThemePreference
} from '@shared/domain'
import { resolveTheme } from '@shared/theme'

export const DARK_QUERY = '(prefers-color-scheme: dark)'

let preference: ThemePreference = DEFAULT_THEME
const listeners = new Set<() => void>()

function darkMedia(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DARK_QUERY)
}

/** True when the computer (or main's nativeTheme) asks for dark. */
export function systemPrefersDark(): boolean {
  return darkMedia()?.matches ?? false
}

export function getThemePreference(): ThemePreference {
  return preference
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(preference, systemPrefersDark())
}

/** Writes the resolved theme to `<html data-theme>`. */
export function applyTheme(): ResolvedTheme {
  const resolved = getResolvedTheme()
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme !== resolved) {
    document.documentElement.dataset.theme = resolved
  }
  return resolved
}

function notify(): void {
  applyTheme()
  for (const listener of listeners) listener()
}

/** Where theme-boot.js finds the choice before the page paints (sepia is not a system mode). */
export const THEME_CACHE_KEY = 'citefox.theme'

/** Sets the choice on screen at once. Saving it is the caller's job (`settings:update`). */
export function setThemePreference(next: ThemePreference): void {
  preference = next
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, next)
  } catch {
    // No storage: the first frame follows the computer, then this applies.
  }
  notify()
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The two preload channels the sync uses (tests pass a fake). */
export interface ThemeBridge {
  'settings:get'(): Promise<AppSettingsSnapshot>
  'settings:themeChanged'(listener: (payload: ThemeChangedEvent) => void): () => void
}

/** The preload bridge, or null without one (a unit test of another screen, a plain browser). */
export function themeBridge(): ThemeBridge | null {
  if (typeof window === 'undefined' || !(window as Partial<Window>).citefox) return null
  const api = window.citefox as unknown as Partial<ThemeBridge>
  if (typeof api['settings:get'] !== 'function') return null
  if (typeof api['settings:themeChanged'] !== 'function') return null
  return api as ThemeBridge
}

/**
 * Applies the theme now, loads the saved choice, then follows main's pushes and
 * the computer's light/dark switches. Returns a stop function.
 */
export function startThemeSync(bridge: ThemeBridge | null = themeBridge()): () => void {
  applyTheme()
  let stopped = false
  const media = darkMedia()
  const onMedia = (): void => {
    notify()
  }
  media?.addEventListener('change', onMedia)
  const offPush = bridge?.['settings:themeChanged']((payload) => {
    if (isThemePreference(payload.theme)) setThemePreference(payload.theme)
  })
  void bridge?.['settings:get']()
    .then((snapshot) => {
      const saved = snapshot.settings.theme
      if (!stopped && saved !== undefined && isThemePreference(saved)) setThemePreference(saved)
    })
    .catch(() => {
      // The theme stays as the computer shows it; Settings still works.
    })
  return () => {
    stopped = true
    media?.removeEventListener('change', onMedia)
    offPush?.()
  }
}

/** The saved choice, live. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getThemePreference, () => DEFAULT_THEME)
}

/** The theme on screen, live. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'light' as const)
}
