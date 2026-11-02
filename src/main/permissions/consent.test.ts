import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  createPermissionConsentStore,
  defaultConsent,
  notificationsAllowed,
  parseConsent,
  permissionsFilePath
} from './consent'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-consent-'))
  directories.push(directory)
  return permissionsFilePath(directory)
}

describe('permission consent', () => {
  test('a new install has agreed to nothing; an upgraded install keeps what it had', () => {
    const fresh = createPermissionConsentStore({
      filePath: tempFile(),
      existingInstall: () => false
    })
    expect(fresh.read()).toEqual(defaultConsent(false))
    const upgraded = createPermissionConsentStore({
      filePath: tempFile(),
      existingInstall: () => true
    })
    expect(upgraded.read()).toMatchObject({ loginItem: true, notifications: true })
  })

  test('updates are written to permissions.json and read back', () => {
    const filePath = tempFile()
    const store = createPermissionConsentStore({ filePath, existingInstall: () => false })
    store.update({ notifications: true, notificationResult: 'shown' })
    const text = readFileSync(filePath, 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1, notifications: true })
    const again = createPermissionConsentStore({ filePath, existingInstall: () => true })
    expect(again.read()).toMatchObject({ notifications: true, loginItem: false })
  })

  test('a corrupt or foreign file reads as missing', () => {
    const filePath = tempFile()
    writeFileSync(filePath, '{nope')
    const store = createPermissionConsentStore({ filePath, existingInstall: () => false })
    expect(store.read()).toEqual(defaultConsent(false))
    expect(parseConsent(JSON.stringify({ version: 2, loginItem: true }))).toBeNull()
    expect(
      parseConsent(JSON.stringify({ version: 1, keychainFailed: -3, keychainCheckedAt: 'x' }))
    ).toMatchObject({ keychainFailed: 0, keychainCheckedAt: null })
  })

  test('only macOS waits for consent before a desktop notification', () => {
    const none = defaultConsent(false)
    expect(notificationsAllowed('darwin', none)).toBe(false)
    expect(notificationsAllowed('win32', none)).toBe(true)
    expect(notificationsAllowed('linux', none)).toBe(true)
    expect(notificationsAllowed('darwin', { ...none, notifications: true })).toBe(true)
  })
})
