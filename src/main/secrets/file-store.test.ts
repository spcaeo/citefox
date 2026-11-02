import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { appServiceKeychain, createFileSecretStore, devSecretsFile } from './file-store'
import { SecretRegistry, SecretStoreError } from './secret-store'

describe('devSecretsFile', () => {
  test('only applies to unpackaged builds that name a file', () => {
    expect(devSecretsFile(false, { CITEFOX_SECRETS_FILE: '/tmp/s.json' })).toBe('/tmp/s.json')
    expect(devSecretsFile(true, { CITEFOX_SECRETS_FILE: '/tmp/s.json' })).toBeNull()
    expect(devSecretsFile(false, { CITEFOX_SECRETS_FILE: '  ' })).toBeNull()
    expect(devSecretsFile(false, {})).toBeNull()
  })
})

describe('file secret store', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'citefox-secrets-'))
    file = path.join(dir, 'secrets.json')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  test('sets, gets, and deletes per service, in a private file', () => {
    const registry = new SecretRegistry()
    const store = createFileSecretStore(file, registry, 'CiteFox')
    const other = createFileSecretStore(file, new SecretRegistry(), 'CiteFox Test')
    expect(store.get('citefox.serpapi.one')).toBeNull()
    store.set('citefox.serpapi.one', 'correct-horse-battery')
    expect(store.get('citefox.serpapi.one')).toBe('correct-horse-battery')
    expect(other.get('citefox.serpapi.one')).toBeNull()
    expect(registry.list()).toEqual(['correct-horse-battery'])
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    store.delete('citefox.serpapi.one')
    store.delete('citefox.serpapi.one')
    expect(store.get('citefox.serpapi.one')).toBeNull()
    expect(registry.list()).toEqual([])
  })

  test('keeps the keychain checks on refs and secrets', () => {
    const store = createFileSecretStore(file, new SecretRegistry(), 'CiteFox')
    expect(() => store.set('../secret', 'correct-horse-battery')).toThrow(SecretStoreError)
    expect(() => store.set('citefox.serpapi.one', '')).toThrow(SecretStoreError)
  })

  test('a corrupt file fails without echoing its contents', () => {
    const store = createFileSecretStore(file, new SecretRegistry(), 'CiteFox')
    store.set('citefox.serpapi.one', 'correct-horse-battery')
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.slice(0, -5))
    expect(() => store.get('citefox.serpapi.one')).toThrow('The secrets file is not valid JSON')
  })

  test('the test-profile "start fresh" list and removal use the file too', () => {
    vi.stubEnv('CITEFOX_SECRETS_FILE', file)
    const store = createFileSecretStore(file, new SecretRegistry(), 'CiteFox Test')
    store.set('citefox.serpapi.one', 'correct-horse-battery')
    const keychain = appServiceKeychain(false, 'CiteFox Test')
    expect(keychain.accounts()).toEqual(['citefox.serpapi.one'])
    keychain.remove('citefox.serpapi.one')
    expect(keychain.accounts()).toEqual([])
  })
})
