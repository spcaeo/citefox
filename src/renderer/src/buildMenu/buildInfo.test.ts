import { describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc'
import {
  buildInfoText,
  buildLine,
  chipParts,
  chipText,
  menuTitle,
  platformLabel
} from './buildInfo'
import { dialogFromHash, withDialog } from './dialogHash'
import { resetLabel, testProfileNotice } from './useBuildActions'

const BUILT = new Date(2026, 9, 22, 19, 50)

const INFO: AppInfo = {
  name: 'CiteFox',
  version: '0.11.0',
  build: { commit: '1787acc', builtAt: BUILT.toISOString() }
}

describe('build words', () => {
  it('writes the chip, the menu title and the build line', () => {
    expect(chipText(INFO)).toBe('v0.11.0 · 22 Oct · 1787acc')
    expect(menuTitle(INFO)).toBe('CiteFox 0.11.0')
    expect(buildLine(INFO)).toBe('Build 1787acc · 22 Oct 2026, 19:50')
  })

  it('leaves out what the build does not know', () => {
    const noCommit: AppInfo = { ...INFO, build: { commit: null, builtAt: BUILT.toISOString() } }
    expect(chipText(noCommit)).toBe('v0.11.0 · 22 Oct')
    expect(buildLine(noCommit)).toBe('Built 22 Oct 2026, 19:50')
    const bare: AppInfo = { name: 'CiteFox', version: '0.11.0' }
    expect(chipParts(bare)).toEqual({ version: 'v0.11.0', date: null, commit: null })
    expect(buildLine(bare)).toBeNull()
    const badDate: AppInfo = { ...INFO, build: { commit: 'abc', builtAt: 'not a date' } }
    expect(chipText(badDate)).toBe('v0.11.0 · abc')
  })

  it('names the OS and Electron version', () => {
    expect(
      platformLabel({
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140.0 Electron/44.0.1 Safari/537.36'
      })
    ).toBe('macOS · Electron 44.0.1')
    expect(platformLabel({ platform: 'Win32', userAgent: '' })).toBe('Windows')
    expect(platformLabel({ platform: 'Linux x86_64' })).toBe('Linux')
    expect(platformLabel({})).toBe('Unknown OS')
  })

  it('copies one fact per line, with the test profile when it is one', () => {
    const text = buildInfoText({ ...INFO, testProfile: true }, 'macOS')
    expect(text.split('\n')).toEqual([
      'CiteFox 0.11.0',
      'Commit: 1787acc',
      `Built: 22 Oct 2026, 19:50 (${BUILT.toISOString()})`,
      'OS: macOS',
      'Window: test profile'
    ])
    expect(buildInfoText({ name: 'CiteFox', version: '1.0.0' }, 'Linux')).toContain(
      'Commit: unknown'
    )
  })

  it('words the test-profile results and the reset label', () => {
    expect(testProfileNotice({ ok: true, alreadyOpen: false }, false).message).toBe(
      'Test window opened'
    )
    expect(testProfileNotice({ ok: true, alreadyOpen: false }, true).message).toBe(
      'Fresh test window opened'
    )
    expect(testProfileNotice({ ok: true, alreadyOpen: true }, false).message).toBe(
      'Test window is already open'
    )
    expect(testProfileNotice({ ok: false, message: 'Nope.' }, false)).toEqual({
      message: 'Nope.',
      tone: 'bad'
    })
    expect(resetLabel(false)).toBe('Reset CiteFox, keep my keys…')
    expect(resetLabel(true)).toBe('Reset this test profile, keep its keys…')
  })
})

describe('build dialog on the URL', () => {
  it('adds and removes ?dialog= and keeps the route and its other values', () => {
    expect(withDialog('#/settings', 'reset')).toBe('#/settings?dialog=reset')
    expect(withDialog('#/pages?view=tracked', 'fresh-test')).toBe(
      '#/pages?view=tracked&dialog=fresh-test'
    )
    expect(withDialog('#/pages?view=tracked&dialog=reset', null)).toBe('#/pages?view=tracked')
    expect(withDialog('', 'reset')).toBe('#?dialog=reset')
    expect(withDialog('#/p/abc/pages/1/results?market=m', 'reset')).toBe(
      '#/p/abc/pages/1/results?market=m&dialog=reset'
    )
  })

  it('reads only known dialogs', () => {
    expect(dialogFromHash('#/settings?dialog=reset')).toBe('reset')
    expect(dialogFromHash('#/start/choose?dialog=fresh-test')).toBe('fresh-test')
    expect(dialogFromHash('#/settings?dialog=other')).toBeNull()
    expect(dialogFromHash('#/settings')).toBeNull()
  })
})
