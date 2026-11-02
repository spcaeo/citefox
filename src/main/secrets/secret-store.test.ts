import { describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { KEYCHAIN_SERVICE, OS_KEYCHAIN_ENTRY_OPTIONS } from './keychain'
import {
  createKeychainRef,
  keychainAccountForKey,
  createKeychainSecretStore,
  isMaskedHint,
  maskedHint,
  MemorySecretStore,
  SecretRegistry,
  SecretStoreError,
  type KeyringEntry
} from './secret-store'

describe('MemorySecretStore', () => {
  test('sets, gets, overwrites, and deletes by keychain ref', () => {
    const store = new MemorySecretStore()
    expect(store.get('citefox.serpapi.one')).toBeNull()
    store.set('citefox.serpapi.one', 'correct-horse-battery')
    expect(store.get('citefox.serpapi.one')).toBe('correct-horse-battery')
    store.set('citefox.serpapi.one', 'replacement-horse-battery')
    expect(store.get('citefox.serpapi.one')).toBe('replacement-horse-battery')
    store.delete('citefox.serpapi.one')
    store.delete('citefox.serpapi.one')
    expect(store.get('citefox.serpapi.one')).toBeNull()
  })

  test('rejects an empty secret, a path-like ref, and a ref that is itself a key', () => {
    const store = new MemorySecretStore()
    expect(() => store.set('citefox.serpapi.one', '')).toThrow(SecretStoreError)
    expect(() => store.set('../secret', 'correct-horse-battery')).toThrow(SecretStoreError)
    expect(() => store.set('a'.repeat(64), 'correct-horse-battery')).toThrow(SecretStoreError)
    expect(() => store.get('sk-ant-api03-abcdefghij')).toThrow(SecretStoreError)
  })

  test('tracks secrets for redaction until the last copy is deleted', () => {
    const registry = new SecretRegistry()
    const store = new MemorySecretStore(registry)
    const secret = 'correct-horse-battery'
    const short = 'shortkey'
    store.set('citefox.serpapi.one', secret)
    store.set('citefox.jina.two', secret)
    store.set('citefox.youtube.three', short)
    store.delete('citefox.serpapi.one')
    expect(registry.list()).toContain(secret)
    expect(registry.list()).toContain(short)
    store.delete('citefox.jina.two')
    expect(registry.list()).not.toContain(secret)
    expect(registry.list()).toContain(short)
  })

  test('registers on get and drops the previous value when a ref is overwritten', () => {
    const registry = new SecretRegistry()
    const store = new MemorySecretStore(registry)
    store.set('citefox.serpapi.one', 'correct-horse-battery')
    registry.forget('citefox.serpapi.one')
    expect(registry.list()).not.toContain('correct-horse-battery')
    expect(store.get('citefox.serpapi.one')).toBe('correct-horse-battery')
    expect(registry.list()).toContain('correct-horse-battery')
    store.set('citefox.serpapi.one', 'replacement-horse-battery')
    expect(registry.list()).not.toContain('correct-horse-battery')
    expect(registry.list()).toEqual(['replacement-horse-battery'])
  })
})

describe('keychain adapter', () => {
  test('uses the factory and does not throw when the item is missing', () => {
    const entries = new Map<string, MemoryEntry>()
    const store = createKeychainSecretStore(
      {
        open(service, account) {
          expect(service).toBe('CiteFox')
          const existing = entries.get(account)
          if (existing) return existing
          const created = new MemoryEntry()
          entries.set(account, created)
          return created
        }
      },
      { service: 'CiteFox' }
    )
    expect(store.get('citefox.youtube.one')).toBeNull()
    store.set('citefox.youtube.one', 'correct-horse-battery')
    expect(store.get('citefox.youtube.one')).toBe('correct-horse-battery')
    store.delete('citefox.youtube.one')
    expect(store.get('citefox.youtube.one')).toBeNull()
  })

  test('seeds existing items and registers a secret read back from the store', () => {
    const registry = new SecretRegistry()
    const seeded = 'seeded-unusual-value'
    const preloaded = 'unusual-preloaded-secret'
    const entries = new Map<string, MemoryEntry>()
    const existing = new MemoryEntry()
    existing.setPassword(preloaded)
    entries.set('citefox.jina.existing', existing)
    const store = createKeychainSecretStore(
      {
        open(_service, account) {
          const found = entries.get(account)
          if (found) return found
          const created = new MemoryEntry()
          entries.set(account, created)
          return created
        }
      },
      {
        service: 'CiteFox',
        registry,
        existing: [{ account: 'citefox.serpapi.seeded', password: seeded }]
      }
    )
    expect(registry.list()).toEqual([seeded])
    expect(store.get('citefox.jina.existing')).toBe(preloaded)
    expect(registry.list()).toContain(preloaded)
    store.delete('citefox.jina.existing')
    expect(registry.list()).not.toContain(preloaded)
    expect(registry.list()).toContain(seeded)
    store.delete('citefox.serpapi.seeded')
    expect(registry.list()).not.toContain(seeded)
  })

  test('redacts a platform error that includes the secret', () => {
    const secret = 'correct-horse-battery'
    const store = createKeychainSecretStore({
      open() {
        return {
          setPassword() {
            throw new Error(`save failed for ${secret}`)
          },
          getPassword() {
            return null
          },
          deletePassword() {
            return false
          }
        }
      }
    })
    expect(() => store.set('citefox.serpapi.one', secret)).toThrow(Error)
    try {
      store.set('citefox.serpapi.one', secret)
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : ''
      expect(message).not.toContain(secret)
      expect(message).toContain('[REDACTED]')
    }
  })
})

describe('hints and refs', () => {
  test('stores no hint for a secret of 8 characters or fewer', () => {
    expect(maskedHint('correct-horse-battery')).toBe('tery')
    expect(maskedHint('12345678')).toBe('')
    expect(maskedHint('123456789')).toBe('6789')
    expect(maskedHint('abcd')).toBe('')
    expect(maskedHint('abc')).toBe('')
    expect(isMaskedHint('tery')).toBe(true)
    expect(isMaskedHint('')).toBe(true)
    expect(isMaskedHint('••••tery')).toBe(false)
    expect(isMaskedHint('correct-horse-battery')).toBe(false)
    expect(maskedHint(`sk-ant-api03-${'e'.repeat(20)}wxyz`)).toBe('wxyz')
  })

  test('builds a keychain ref that is safe to store', () => {
    const ref = createKeychainRef('serpapi')
    expect(ref).toMatch(/^citefox\.serpapi\.[0-9a-f-]{36}$/)
  })

  test('pins the OS keychain to Secret Service under the CiteFox service', () => {
    expect(KEYCHAIN_SERVICE).toBe('CiteFox')
    expect(OS_KEYCHAIN_ENTRY_OPTIONS.linux?.store).toBe('secret-service')
  })
})

describe('keychain account per key id', () => {
  test('adds and removes each key under its own account', () => {
    const registry = new SecretRegistry()
    const entries = new Map<string, MemoryEntry>()
    const store = createKeychainSecretStore(
      {
        open(service, account) {
          expect(service).toBe('CiteFox')
          const existing = entries.get(account)
          if (existing) return existing
          const created = new MemoryEntry()
          entries.set(account, created)
          return created
        }
      },
      { service: 'CiteFox', registry }
    )
    const firstSecret = 'correct-horse-battery'
    const secondSecret = 'another-horse-battery'
    const first = keychainAccountForKey('serpapi', 'key-1')
    const second = keychainAccountForKey('serpapi', 'key-2')
    expect(first).toBe('citefox.serpapi.key-1')
    expect(second).toBe('citefox.serpapi.key-2')
    expect(first).not.toContain(firstSecret)
    store.set(first, firstSecret)
    store.set(second, secondSecret)
    expect(store.get(first)).toBe(firstSecret)
    expect(store.get(second)).toBe(secondSecret)
    expect(registry.list()).toEqual(expect.arrayContaining([firstSecret, secondSecret]))
    store.delete(first)
    expect(store.get(first)).toBeNull()
    expect(store.get(second)).toBe(secondSecret)
    expect(registry.list()).not.toContain(firstSecret)
    expect(registry.list()).toContain(secondSecret)
    store.delete(second)
    expect(entries.get(second)?.getPassword()).toBeNull()
    expect(() => keychainAccountForKey('serpapi', 'KEY')).toThrow(SecretStoreError)
    expect(() => keychainAccountForKey('serpapi', 'ab'.repeat(32))).toThrow(SecretStoreError)
    expect(() => keychainAccountForKey('serpapi', 'sk-ant-api03-abcdefghij')).toThrow(
      SecretStoreError
    )
    expect(first).not.toBe(firstSecret)
    expect(second).not.toBe(secondSecret)
  })
})

describe('logger and the secret registry', () => {
  test('redacts every stored secret, then shows it again after delete', () => {
    const registry = new SecretRegistry()
    const store = new MemorySecretStore(registry)
    const unusual = 'correct-horse-battery'
    const short = 'shortkey'
    const hex = 'ab'.repeat(32)
    store.set('citefox.serpapi.one', unusual)
    store.set('citefox.jina.two', short)
    const lines: string[] = []
    const logger = createLogger({
      write: (_level, line) => lines.push(line),
      secrets: () => registry.list()
    })
    logger.info(`saw ${unusual} and ${short}`)
    expect(lines[0]).not.toContain(unusual)
    expect(lines[0]).not.toContain(short)
    expect(lines[0]).toContain('[REDACTED]')
    store.delete('citefox.serpapi.one')
    logger.info(`later ${unusual}`)
    expect(lines[1]).toContain(unusual)
    expect(lines[1]).not.toContain(short)
    logger.info(`hash ${hex}`)
    expect(lines[2]).not.toContain(hex)
    expect(lines[2]).toContain('[REDACTED]')
  })
})

class MemoryEntry implements KeyringEntry {
  private value: string | null = null

  setPassword(password: string): void {
    this.value = password
  }

  getPassword(): string | null {
    return this.value
  }

  deletePassword(): boolean {
    const had = this.value !== null
    this.value = null
    return had
  }
}
