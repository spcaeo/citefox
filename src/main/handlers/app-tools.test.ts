import { afterEach, describe, expect, test } from 'vitest'
import { TEST_PROFILE_UNAVAILABLE } from '@shared/permissions'
import { devRestartExitCode, type AppTools } from '../app-tools'
import { memoryPermissionSystem } from '../permissions/system'
import { cleanupHarness, harness } from './test-harness'

afterEach(cleanupHarness)

function recordingTools(): AppTools & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    resetKeepKeys() {
      calls.push('reset')
      return { ok: true }
    },
    openTestProfile(request) {
      calls.push(request)
      return { ok: true, alreadyOpen: false }
    }
  }
}

describe('build menu testing tools', () => {
  test('answers "not available" when the app has no tools (tests and tools)', async () => {
    const { handlers } = harness()
    await expect(handlers['app:resetKeepKeys']()).resolves.toEqual({
      ok: false,
      message: 'Not available here.'
    })
    await expect(handlers['app:openTestProfile']({ fresh: false })).resolves.toEqual({
      ok: false,
      message: 'Not available here.'
    })
  })

  test('passes each request to the tools', async () => {
    const tools = recordingTools()
    const { handlers } = harness({ appTools: tools })
    await expect(handlers['app:resetKeepKeys']()).resolves.toEqual({ ok: true })
    await expect(handlers['app:openTestProfile']({ fresh: true })).resolves.toEqual({
      ok: true,
      alreadyOpen: false
    })
    expect(tools.calls).toEqual(['reset', { fresh: true }])
  })

  test('refuses an open request without a fresh flag', async () => {
    const tools = recordingTools()
    const { handlers } = harness({ appTools: tools })
    await expect(
      handlers['app:openTestProfile']({ fresh: 'yes' } as unknown as { fresh: boolean })
    ).rejects.toThrow(/app:openTestProfile/)
    expect(tools.calls).toEqual([])
  })

  test('app info carries the build and the test profile flag as given', async () => {
    const info = {
      name: 'CiteFox',
      version: '0.12.0',
      build: { commit: '59f998b', builtAt: '2026-10-22T19:54:41.000Z' },
      testProfile: true
    }
    const { handlers } = harness({ appInfo: () => info })
    expect(await handlers['app:getInfo']()).toEqual(info)
  })
})

describe('what CiteFox needs, in the test profile', () => {
  test('background checks and open at login are not available', async () => {
    const system = {
      ...memoryPermissionSystem({ platform: 'darwin', loginItemSupported: true }),
      testProfile: true
    }
    const { handlers } = harness({ permissionSystem: system })
    const snapshot = await handlers['permissions:list']()
    for (const id of ['background', 'loginItem']) {
      const item = snapshot.items.find((entry) => entry.id === id)
      expect(item).toMatchObject({
        state: 'not_needed',
        statusLabel: TEST_PROFILE_UNAVAILABLE,
        action: null
      })
    }
    const background = await handlers['permissions:request']({ id: 'background' })
    expect(background.ok).toBe(false)
    expect(background.message).toMatch(/test profile/)
    const login = await handlers['permissions:request']({ id: 'loginItem' })
    expect(login.ok).toBe(false)
    expect(system.loginItem.enabled()).toBe(false)
  })
})

describe('devRestartExitCode', () => {
  test('only an unpackaged build with a valid code exits instead of relaunching', () => {
    expect(devRestartExitCode(false, { CITEFOX_DEV_RESTART_EXIT_CODE: '75' })).toBe(75)
    expect(devRestartExitCode(true, { CITEFOX_DEV_RESTART_EXIT_CODE: '75' })).toBeNull()
    expect(devRestartExitCode(false, {})).toBeNull()
    expect(devRestartExitCode(false, { CITEFOX_DEV_RESTART_EXIT_CODE: '0' })).toBeNull()
    expect(devRestartExitCode(false, { CITEFOX_DEV_RESTART_EXIT_CODE: 'x' })).toBeNull()
  })
})
