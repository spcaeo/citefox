import { describe, expect, test } from 'vitest'
import {
  IpcRequestError,
  parsePlaygroundRun,
  parseRunCheckup,
  parseSettingsPatch
} from './ipc-request'

describe('theme validation', () => {
  test('accepts system, light and dark on a settings patch, and nothing else', () => {
    for (const theme of ['system', 'light', 'dark'] as const) {
      expect(parseSettingsPatch({ theme })).toEqual({ theme })
    }
    expect(() => parseSettingsPatch({ theme: 'auto' })).toThrow(IpcRequestError)
    expect(() => parseSettingsPatch({ theme: null })).toThrow(IpcRequestError)
    expect(() => parseSettingsPatch({ theme: 1 })).toThrow(IpcRequestError)
  })
})

describe('celebration switches', () => {
  test('accept booleans on a settings patch, and nothing else', () => {
    expect(parseSettingsPatch({ celebrate: false, celebrateSound: false })).toEqual({
      celebrate: false,
      celebrateSound: false
    })
    expect(parseSettingsPatch({ celebrateSound: true })).toEqual({ celebrateSound: true })
    expect(() => parseSettingsPatch({ celebrateSound: 'on' })).toThrow(IpcRequestError)
    expect(() => parseSettingsPatch({ celebrateSound: null })).toThrow(IpcRequestError)
  })
})

describe('prompt count validation', () => {
  test('accepts 1000 and rejects 1001 on a settings patch', () => {
    expect(parseSettingsPatch({ sidebar: 'collapsed' })).toEqual({ sidebar: 'collapsed' })
    expect(() => parseSettingsPatch({ sidebar: 'hidden' })).toThrow(IpcRequestError)
    expect(() => parseSettingsPatch({ sidebar: true })).toThrow(IpcRequestError)
    expect(parseSettingsPatch({ defaultPromptCount: 1000 })).toEqual({ defaultPromptCount: 1000 })
    expect(() => parseSettingsPatch({ defaultPromptCount: 1001 })).toThrow(IpcRequestError)
    expect(() => parseSettingsPatch({ defaultPromptCount: 1001 })).toThrow(
      'settings:update: The maximum prompt count is 1000.'
    )
  })

  test('accepts 1000 and rejects 1001 on a playground override', () => {
    const request = {
      url: 'https://example.com/pricing',
      overrides: { body: null, promptCount: 1000, brandName: null }
    }
    expect(parsePlaygroundRun(request).overrides?.promptCount).toBe(1000)
    expect(() =>
      parsePlaygroundRun({
        ...request,
        overrides: { body: null, promptCount: 1001, brandName: null }
      })
    ).toThrow('playground:run: The maximum prompt count is 1000.')
  })
})

describe('Claude binary path validation', () => {
  const good = process.platform === 'win32' ? 'C:\\Tools\\claude.exe' : '/usr/local/bin/claude'

  test('accepts an absolute path to claude and null', () => {
    expect(parseSettingsPatch({ claudeBinaryPath: good })).toEqual({ claudeBinaryPath: good })
    expect(parseSettingsPatch({ claudeBinaryPath: null })).toEqual({ claudeBinaryPath: null })
    expect(parseRunCheckup({ binaryPath: good })).toEqual({ binaryPath: good })
    expect(parseRunCheckup({ binaryPath: null })).toEqual({ binaryPath: null })
  })

  test.each(['/bin/sh', 'claude', '../claude', '/usr/bin/python3', '/tmp/claude-helper'])(
    'rejects %s with a clear message on both channels',
    (value) => {
      expect(() => parseSettingsPatch({ claudeBinaryPath: value })).toThrow(
        /settings:update: .*claude/
      )
      expect(() => parseRunCheckup({ binaryPath: value })).toThrow(
        /claudeCode:runCheckup: .*claude/
      )
    }
  )
})
