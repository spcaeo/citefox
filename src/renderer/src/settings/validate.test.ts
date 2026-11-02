import { describe, expect, test } from 'vitest'
import { DEFAULT_CLAUDE_PROVIDER, DEFAULT_JINA_MODE, DEFAULT_MARKET_DEVICE } from '@shared/domain'
import {
  claudeBinaryPathError,
  draftFromSettings,
  settingsSaveError,
  SETTINGS_COPY,
  validateSettings,
  type SettingsDraft
} from './validate'

function draft(overrides: Partial<SettingsDraft> = {}): SettingsDraft {
  return {
    userName: 'Rakesh',
    defaultCountry: 'US',
    defaultLanguage: 'en',
    defaultLocation: 'Austin',
    defaultDevice: DEFAULT_MARKET_DEVICE,
    defaultIntervalDays: '14',
    defaultSamples: '1',
    defaultPromptCount: '10',
    claudeBinaryPath: '',
    claudeConcurrency: '2',
    claudeModel: '',
    claudeProvider: DEFAULT_CLAUDE_PROVIDER,
    codexBinaryPath: '',
    codexModel: '',
    codexQuickModel: '',
    jinaMode: DEFAULT_JINA_MODE,
    budget: '',
    ...overrides
  }
}

describe('validateSettings', () => {
  test('saves an empty model as the CLI default and an empty budget as no cap', () => {
    const result = validateSettings(draft())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.claudeModel).toBeNull()
    expect(result.patch.defaultIntervalDays).toBe(14)
    expect(result.patch.userName).toBe('Rakesh')
    expect(result.cap).toBeNull()
    expect(result.patch.defaultLocation).toBe('Austin')
  })

  test('ties invalid questions, samples, calls, and budget to those fields', () => {
    const result = validateSettings(
      draft({
        userName: '  ',
        defaultCountry: 'USA',
        defaultLanguage: 'EN',
        defaultSamples: '0',
        defaultPromptCount: 'ten',
        claudeConcurrency: '0',
        defaultIntervalDays: '21',
        budget: '1.5'
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.userName).toBe(SETTINGS_COPY.userName)
    expect(result.errors.defaultCountry).toBe(SETTINGS_COPY.countryInvalid)
    expect(result.errors.defaultLanguage).toBe(SETTINGS_COPY.languageInvalid)
    expect(result.errors.defaultSamples).toBe(SETTINGS_COPY.samples)
    expect(result.errors.defaultPromptCount).toBe(SETTINGS_COPY.prompts)
    expect(result.errors.claudeConcurrency).toBe(SETTINGS_COPY.concurrency)
    expect(result.errors.defaultIntervalDays).toBe(SETTINGS_COPY.interval)
    expect(result.errors.budget).toBe(SETTINGS_COPY.budget)
  })

  test('accepts UK and a named model, and keeps an empty country unset', () => {
    const result = validateSettings(
      draft({
        defaultCountry: 'UK',
        defaultLanguage: '',
        defaultLocation: '  ',
        claudeModel: 'claude-sonnet-5',
        budget: '5000',
        defaultIntervalDays: '30'
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.defaultCountry).toBe('UK')
    expect(result.patch.defaultLanguage).toBeNull()
    expect(result.patch.defaultLocation).toBeNull()
    expect(result.patch.claudeModel).toBe('claude-sonnet-5')
    expect(result.cap).toBe(5000)
    expect(result.patch.defaultIntervalDays).toBe(30)
  })

  test('round-trips a null model and a null name into empty fields', () => {
    const next = draftFromSettings(
      {
        userName: null,
        defaultCountry: null,
        defaultLanguage: null,
        defaultLocation: null,
        defaultDevice: 'mobile',
        defaultIntervalDays: 14,
        defaultSamples: 1,
        defaultPromptCount: 10,
        claudeBinaryPath: null,
        claudeConcurrency: 2,
        claudeModel: null,
        claudeProvider: 'claude-code',
        jinaMode: 'fallback'
      },
      ''
    )
    expect(next.userName).toBe('')
    expect(next.claudeModel).toBe('')
    expect(next.defaultDevice).toBe('mobile')
  })
})

describe('claudeBinaryPathError', () => {
  test('allows an empty path, which searches PATH and the usual install folders', () => {
    expect(claudeBinaryPathError('')).toBeNull()
    expect(claudeBinaryPathError('   ')).toBeNull()
  })

  test('accepts absolute POSIX and Windows paths to the claude program', () => {
    expect(claudeBinaryPathError('/Users/me/.local/bin/claude')).toBeNull()
    expect(claudeBinaryPathError('  /opt/homebrew/bin/claude  ')).toBeNull()
    expect(claudeBinaryPathError('C:\\Users\\me\\AppData\\claude.exe')).toBeNull()
    expect(claudeBinaryPathError('D:/tools/Claude.CMD')).toBeNull()
    expect(claudeBinaryPathError('\\\\server\\share\\claude.exe')).toBeNull()
  })

  test('rejects a relative path with the same words main uses', () => {
    expect(claudeBinaryPathError('claude')).toBe(SETTINGS_COPY.claudePathRelative('claude'))
    expect(claudeBinaryPathError('~/.local/bin/claude')).toBe(
      'The Claude Code path must be a full path to the claude program.'
    )
    expect(claudeBinaryPathError('bin\\claude.exe')).toBe(
      'The Claude Code path must be a full path to the claude program.'
    )
  })

  test('rejects another program, matching the POSIX name exactly', () => {
    expect(claudeBinaryPathError('/bin/bash')).toBe(
      'The Claude Code path must point to the claude program.'
    )
    expect(claudeBinaryPathError('/usr/local/bin/Claude')).toBe(
      'The Claude Code path must point to the claude program.'
    )
    expect(claudeBinaryPathError('/usr/local/bin/claude/')).toBe(
      'The Claude Code path must point to the claude program.'
    )
    expect(claudeBinaryPathError('C:\\Windows\\System32\\cmd.exe')).toBe(
      'The Claude Code path must point to the claude.exe or claude.cmd program.'
    )
    expect(claudeBinaryPathError('C:\\tools\\claude')).toBe(
      'The Claude Code path must point to the claude.exe or claude.cmd program.'
    )
  })

  test('validateSettings ties a bad path to the field and does not save it', () => {
    const result = validateSettings(draft({ claudeBinaryPath: '/bin/sh' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.claudeBinaryPath).toBe(
      'The Claude Code path must point to the claude program.'
    )
  })

  test('validateSettings saves a trimmed good path and an empty path as null', () => {
    const good = validateSettings(draft({ claudeBinaryPath: ' /usr/local/bin/claude ' }))
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.patch.claudeBinaryPath).toBe('/usr/local/bin/claude')
    const empty = validateSettings(draft({ claudeBinaryPath: '' }))
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.patch.claudeBinaryPath).toBeNull()
  })
})

describe('settingsSaveError', () => {
  test("strips Electron's invoke wrapper and the channel name", () => {
    const error = new Error(
      "Error invoking remote method 'settings:update': Error: settings:update: The Claude Code path must point to the claude.exe or claude.cmd program."
    )
    expect(settingsSaveError(error)).toEqual({
      message: 'The Claude Code path must point to the claude.exe or claude.cmd program.',
      field: 'claudeBinaryPath'
    })
  })

  test('keeps other messages on the form and falls back when the text is empty', () => {
    expect(settingsSaveError(new Error('settings:update: Choose a country.'))).toEqual({
      message: 'Choose a country.',
      field: null
    })
    expect(
      settingsSaveError(new Error("Error invoking remote method 'settings:update': Error: "))
    ).toEqual({
      message: 'Could not save settings. Try again.',
      field: null
    })
    expect(settingsSaveError('nope')).toEqual({
      message: 'Could not save settings. Try again.',
      field: null
    })
  })
})
