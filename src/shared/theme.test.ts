import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, isThemePreference, THEME_PREFERENCES } from './domain'
import { resolveTheme, THEME_GROUND } from './theme'

describe('resolveTheme', () => {
  it('holds light and dark whatever the computer uses', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('sepia', true)).toBe('sepia')
  })

  it('follows the computer for system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('theme preference', () => {
  it('is system, light, dark or sepia, and starts as sepia', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark', 'sepia'])
    expect(DEFAULT_THEME).toBe('sepia')
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('auto')).toBe(false)
    expect(isThemePreference('')).toBe(false)
  })
})

describe('THEME_GROUND', () => {
  const tokens = readFileSync(
    join(process.cwd(), 'src/renderer/src/styles/tokens.css'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  function groundIn(selector: string): string | undefined {
    const start = tokens.indexOf(selector)
    const body = tokens.slice(tokens.indexOf('{', start), tokens.indexOf('}', start))
    return /--ground:\s*([^;]+);/.exec(body)?.[1]?.trim()
  }

  it('matches --ground in each theme, so the window shows no other colour first', () => {
    expect(groundIn(':root,\n  [data-theme] {')).toBe(THEME_GROUND.light)
    expect(groundIn(":root[data-theme='dark'],")).toBe(THEME_GROUND.dark)
    expect(groundIn(":root[data-theme='sepia'],")).toBe(THEME_GROUND.sepia)
  })
})
