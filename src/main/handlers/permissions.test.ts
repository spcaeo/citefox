import { afterEach, describe, expect, test } from 'vitest'
import type { PermissionsSnapshot } from '@shared/ipc'
import { memoryConsentStore } from '../permissions/consent'
import { memoryPermissionSystem } from '../permissions/system'
import {
  BINARY,
  cleanupHarness,
  harness,
  keyRequest,
  noSecret,
  probeFor,
  SECRET
} from './test-harness'

afterEach(cleanupHarness)

function item(snapshot: PermissionsSnapshot, id: string): PermissionsSnapshot['items'][number] {
  const found = snapshot.items.find((entry) => entry.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

/** A fake Mac: no real keychain, launchd, notification or login item is touched. */
function mac(): {
  system: ReturnType<typeof memoryPermissionSystem>
  consent: ReturnType<typeof memoryConsentStore>
} {
  return {
    system: memoryPermissionSystem({ platform: 'darwin', loginItemSupported: true }),
    consent: memoryConsentStore()
  }
}

describe('IPC handlers: permissions', () => {
  test('permissions:list reads state only and names nothing secret', async () => {
    const fakes = mac()
    const { handlers, logs } = harness({
      permissionSystem: fakes.system,
      permissionConsent: fakes.consent
    })
    await handlers['keys:add'](keyRequest('serpapi', SECRET))
    const snapshot = await handlers['permissions:list']()
    expect(snapshot.platform).toBe('darwin')
    expect(item(snapshot, 'claude').state).toBe('unchecked')
    expect(item(snapshot, 'serpapi').state).toBe('unchecked')
    expect(item(snapshot, 'keychain')).toMatchObject({
      state: 'unchecked',
      statusLabel: '1 secret saved · access not checked'
    })
    expect(item(snapshot, 'notifications').state).toBe('off')
    expect(item(snapshot, 'background')).toMatchObject({ state: 'off', statusLabel: 'Off' })
    expect(item(snapshot, 'loginItem').state).toBe('off')
    expect(fakes.system.notificationsShown).toBe(0)
    expect(noSecret(snapshot, logs, SECRET)).toBe(true)
  })

  test('requesting the Claude item runs the checkup with the saved path', async () => {
    const fakes = mac()
    const { handlers, progress } = harness({
      permissionSystem: fakes.system,
      permissionConsent: fakes.consent,
      claudeProbe: { ...probeFor([BINARY]), searchPath: () => BINARY }
    })
    const result = await handlers['permissions:request']({ id: 'claude' })
    expect(result.ok).toBe(true)
    expect(result.snapshot.claude).toMatchObject({
      state: 'ready',
      summary: 'connected',
      fresh: true
    })
    expect(item(result.snapshot, 'claude').state).toBe('ok')
    expect(progress.length).toBeGreaterThan(0)
  })

  test('keychain, notifications, background and login item act only when asked', async () => {
    const fakes = mac()
    const { handlers, logs } = harness({
      permissionSystem: fakes.system,
      permissionConsent: fakes.consent
    })
    await handlers['keys:add'](keyRequest('serpapi', SECRET))

    const keychain = await handlers['permissions:request']({ id: 'keychain' })
    expect(keychain).toMatchObject({ ok: true, message: 'CiteFox can read the saved secret.' })
    expect(item(keychain.snapshot, 'keychain').state).toBe('ok')
    expect(noSecret(keychain, logs, SECRET)).toBe(true)

    const notes = await handlers['permissions:request']({ id: 'notifications' })
    expect(notes.ok).toBe(true)
    expect(fakes.system.notificationsShown).toBe(1)
    expect(fakes.consent.read().notifications).toBe(true)
    expect(item(notes.snapshot, 'notifications')).toMatchObject({ state: 'ok', statusLabel: 'On' })

    const background = await handlers['permissions:request']({ id: 'background' })
    expect(background.ok).toBe(true)
    expect(item(background.snapshot, 'background').state).toBe('ok')
    expect((await handlers['schedule:getApp']()).checkWhenClosed).toBe(true)

    const login = await handlers['permissions:request']({ id: 'loginItem' })
    expect(login).toMatchObject({ ok: true, message: 'CiteFox now opens at login.' })
    expect(fakes.consent.read().loginItem).toBe(true)
    expect(fakes.system.loginItem.enabled()).toBe(true)
    expect((await handlers['schedule:getApp']()).startAtLogin).toBe(true)
  })

  test('a blocked notification and a missing keychain item say so', async () => {
    const system = memoryPermissionSystem({ platform: 'darwin', notificationResult: 'failed' })
    const consent = memoryConsentStore()
    const { handlers, secrets } = harness({ permissionSystem: system, permissionConsent: consent })
    const added = await handlers['keys:add'](keyRequest('serpapi', SECRET))
    secrets.delete(added.keychainRef)
    const keychain = await handlers['permissions:request']({ id: 'keychain' })
    expect(keychain.ok).toBe(false)
    expect(item(keychain.snapshot, 'keychain').statusLabel).toBe('Could not read 1 key')
    const notes = await handlers['permissions:request']({ id: 'notifications' })
    expect(notes.ok).toBe(false)
    expect(item(notes.snapshot, 'notifications').state).toBe('action')
  })

  test('items set up on their own screen, unknown ids and extra fields are refused', async () => {
    const { handlers } = harness({ permissionConsent: memoryConsentStore() })
    await expect(handlers['permissions:request']({ id: 'serpapi' })).rejects.toThrow(
      'permissions:request: Set this up on its own screen.'
    )
    await expect(handlers['permissions:request']({ id: 'camera' } as never)).rejects.toThrow(
      'permissions:request: Unknown permission'
    )
    await expect(
      handlers['permissions:request']({ id: 'claude', secret: SECRET } as never)
    ).rejects.toThrow('permissions:request: Invalid request')
  })

  test('the login item is refused in a development build', async () => {
    const { handlers } = harness({
      permissionSystem: memoryPermissionSystem({ platform: 'darwin', loginItemSupported: false }),
      permissionConsent: memoryConsentStore()
    })
    const snapshot = await handlers['permissions:list']()
    expect(item(snapshot, 'loginItem').statusLabel).toBe('Only in the installed app')
    const result = await handlers['permissions:request']({ id: 'loginItem' })
    expect(result.ok).toBe(false)
  })
})
