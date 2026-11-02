import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CiteFoxApi } from '@shared/ipc'
import { createTemplatesClient } from './client'

function installBridge(api: Partial<CiteFoxApi>): void {
  vi.stubGlobal('window', { citefox: api })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('templates client', () => {
  test('a release build without the e2e flag never uses the mock, even when asked', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', '')
    const list = vi.fn(() => Promise.resolve([]))
    installBridge({ 'templates:list': list })
    await createTemplatesClient('mock').list()
    expect(list).toHaveBeenCalledTimes(1)
  })

  test('dev and the e2e flag use the mock when asked', async () => {
    for (const [dev, flag] of [
      [true, ''],
      [false, '1']
    ] as const) {
      vi.stubEnv('DEV', dev)
      vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', flag)
      const list = vi.fn(() => Promise.resolve([]))
      installBridge({ 'templates:list': list })
      const templates = await createTemplatesClient('mock').list({ kind: 'coverage' })
      expect(list).not.toHaveBeenCalled()
      expect(templates.length).toBeGreaterThan(0)
    }
  })
})
