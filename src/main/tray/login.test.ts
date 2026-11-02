import { describe, expect, test } from 'vitest'
import { loginItemSettings } from './login'

describe('login item settings', () => {
  test('sets open at login without the removed openAsHidden flag', () => {
    expect(loginItemSettings(true)).toEqual({ openAtLogin: true })
    expect(loginItemSettings(false)).toEqual({ openAtLogin: false })
    expect(Object.hasOwn(loginItemSettings(true), 'openAsHidden')).toBe(false)
  })
})
