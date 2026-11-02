import { describe, expect, test } from 'vitest'
import type { ClaudeCheckupResult } from '@shared/ipc'
import { API_KEY_LOGIN_LABEL, loginStatusLabel, type OnboardingCheckupResult } from './claudeLogin'

function checkup(
  login: OnboardingCheckupResult['login'],
  statusLabel: string
): OnboardingCheckupResult {
  const shared: ClaudeCheckupResult = {
    binaryPath: '/usr/local/bin/claude',
    version: '2.4.1',
    login: 'logged_in',
    plan: null,
    roundTrip: 'ok',
    durationMs: 1,
    resolvedModel: 'claude-sonnet-5-5',
    ready: true,
    message: 'CiteFox AI is ready.',
    nextStep: null,
    rows: {
      binary: { state: 'ok', statusLabel: 'OK', detail: '', nextStep: null },
      login: { state: 'ok', statusLabel, detail: '', nextStep: null },
      roundTrip: { state: 'ok', statusLabel: 'OK', detail: '', nextStep: null }
    }
  }
  return { ...shared, login }
}

describe('loginStatusLabel', () => {
  test('labels an API-key login exactly', () => {
    expect(loginStatusLabel(checkup('api_key', 'OK'))).toBe(API_KEY_LOGIN_LABEL)
    expect(API_KEY_LOGIN_LABEL).toBe('API key only')
  })

  test('keeps the engine label for the shared login values', () => {
    expect(loginStatusLabel(checkup('logged_in', 'OK'))).toBe('OK')
    expect(loginStatusLabel(checkup('logged_out', 'Not logged in'))).toBe('Not logged in')
    expect(loginStatusLabel(checkup('skipped', 'Skipped'))).toBe('Skipped')
  })
})
