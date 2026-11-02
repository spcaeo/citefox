/**
 * Light / dark / sepia / system theme (Settings › Appearance). Main and the renderer
 * both use this: main to pick the window's background before the page paints,
 * the renderer to set `<html data-theme>`.
 */

import type { ResolvedTheme, ThemePreference } from './domain'

/**
 * The window background in each theme. Each equals `--ground` in
 * renderer/src/styles/tokens.css (theme.test.ts checks), so the window never
 * shows a different colour before the page paints.
 */
export const THEME_GROUND: Readonly<Record<ResolvedTheme, string>> = {
  light: '#ffffff',
  dark: '#111111',
  sepia: '#f7f0e1'
}

/**
 * What the operating system is told (`nativeTheme.themeSource`): it knows only light
 * and dark, so sepia's menus, scroll bars and dialogs are light.
 */
export function nativeThemeSource(preference: ThemePreference): 'system' | 'light' | 'dark' {
  return preference === 'sepia' ? 'light' : preference
}

/** The theme on screen: the choice, or for `system` what the computer uses. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}
