import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CLIENT_MODE_STORAGE_KEY,
  MOCK_CATALOG_STORAGE_KEY,
  MOCK_PACE_STORAGE_KEY,
  MOCK_SCENARIO_STORAGE_KEY,
  mocksAllowed,
  resolveClientMode
} from './flags'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveClientMode', () => {
  test('the real API is the default, dev included', () => {
    expect(CLIENT_MODE_STORAGE_KEY).toBe('citefox.client')
    expect(MOCK_SCENARIO_STORAGE_KEY).toBe('citefox.mock.scenario')
    expect(MOCK_PACE_STORAGE_KEY).toBe('citefox.mock.pace')
    expect(MOCK_CATALOG_STORAGE_KEY).toBe('citefox.mock.catalog')
    expect(resolveClientMode({ mocksAllowed: false, stored: null })).toBe('ipc')
    expect(resolveClientMode({ mocksAllowed: true, stored: null })).toBe('ipc')
    expect(resolveClientMode({ mocksAllowed: true, stored: 'ipc' })).toBe('ipc')
    expect(resolveClientMode({ mocksAllowed: true, stored: 'yes' })).toBe('ipc')
  })

  test('the stored mock flag works only where mocks are allowed', () => {
    expect(resolveClientMode({ mocksAllowed: true, stored: 'mock' })).toBe('mock')
    expect(resolveClientMode({ mocksAllowed: false, stored: 'mock' })).toBe('ipc')
  })
})

describe('mocksAllowed', () => {
  test('a release build does not allow mocks', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', '')
    expect(mocksAllowed()).toBe(false)
  })

  test('dev and the e2e build allow mocks', () => {
    vi.stubEnv('DEV', true)
    expect(mocksAllowed()).toBe(true)
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', '1')
    expect(mocksAllowed()).toBe(true)
  })
})
