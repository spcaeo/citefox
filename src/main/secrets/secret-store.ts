import { API_KEY_HINT_LENGTH, type ApiKeyProvider } from '@shared/domain'
import { randomUUID } from 'node:crypto'
import { redactError } from '../logging/redact'

/** Secrets this short are stored with an empty hint so the tail is not the whole secret. */
const HINT_OMIT_MAX_LENGTH = 8

const MAX_SECRET_LENGTH = 4096
const KEYCHAIN_REF = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const HEX_KEY = /^[a-f0-9]{64}$/
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{10,}/

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretStoreError'
  }
}

/**
 * A keychain item addressed by `keychain_ref`. Implementations store the secret
 * only in that item. SQLite and settings.json keep the ref and a masked hint.
 */
export interface SecretStore {
  set(keychainRef: string, secret: string): void
  get(keychainRef: string): string | null
  delete(keychainRef: string): void
}

/** In-memory stand-in for tests. Nothing is written to disk. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  constructor(private readonly registry?: SecretRegistry) {}

  set(keychainRef: string, secret: string): void {
    assertKeychainRef(keychainRef)
    assertSecret(secret)
    this.values.set(keychainRef, secret)
    this.registry?.remember(keychainRef, secret)
  }

  get(keychainRef: string): string | null {
    assertKeychainRef(keychainRef)
    const secret = this.values.get(keychainRef) ?? null
    if (secret !== null) this.registry?.remember(keychainRef, secret)
    return secret
  }

  delete(keychainRef: string): void {
    assertKeychainRef(keychainRef)
    if (!this.values.has(keychainRef)) return
    this.values.delete(keychainRef)
    this.registry?.forget(keychainRef)
  }
}

/**
 * One platform credential. The real OS entry from `@napi-rs/keyring` matches
 * this shape. Tests pass a fake.
 */
export interface KeyringEntry {
  setPassword(password: string): void
  getPassword(): string | null
  deletePassword(): boolean
}

export interface KeyringEntryFactory {
  open(service: string, account: string): KeyringEntry
}

export interface StoredCredential {
  account: string
  password: string
}

export interface KeychainSecretStoreOptions {
  service?: string
  registry?: SecretRegistry
  /** Items already in the keychain, seeded into the registry before any get. */
  existing?: readonly StoredCredential[]
}

/** OS keychain store. `factory` is the only thing that talks to the platform. */
export function createKeychainSecretStore(
  factory: KeyringEntryFactory,
  options?: KeychainSecretStoreOptions
): SecretStore {
  const service = options?.service ?? 'CiteFox'
  const registry = options?.registry
  if (registry !== undefined) {
    for (const item of options?.existing ?? []) {
      registry.remember(item.account, item.password)
    }
  }
  return {
    set(keychainRef, secret) {
      assertKeychainRef(keychainRef)
      assertSecret(secret)
      const entry = factory.open(service, keychainRef)
      const previous = readEntry(entry, secret)
      try {
        entry.setPassword(secret)
      } catch (error) {
        throw toSafeError(error, [secret, previous])
      }
      registry?.remember(keychainRef, secret)
    },
    get(keychainRef) {
      assertKeychainRef(keychainRef)
      const entry = factory.open(service, keychainRef)
      let secret: string | null
      try {
        secret = entry.getPassword()
      } catch (error) {
        throw toSafeError(error, [])
      }
      if (secret !== null) registry?.remember(keychainRef, secret)
      return secret
    },
    delete(keychainRef) {
      assertKeychainRef(keychainRef)
      const entry = factory.open(service, keychainRef)
      const previous = readEntry(entry, null)
      try {
        entry.deletePassword()
      } catch (error) {
        throw toSafeError(error, [previous])
      }
      registry?.forget(keychainRef)
    }
  }
}

/**
 * Secrets currently held in this process, keyed by keychain ref, so the logger
 * can mask the exact value even when it does not match a known key pattern.
 * The registry is memory only. Two refs may share one secret; deleting one
 * keeps the value while the other ref still holds it.
 */
export class SecretRegistry {
  private readonly byRef = new Map<string, string>()

  remember(keychainRef: string, secret: string): void {
    if (secret.length === 0) return
    this.byRef.set(keychainRef, secret)
  }

  forget(keychainRef: string): void {
    this.byRef.delete(keychainRef)
  }

  list(): readonly string[] {
    return [...new Set(this.byRef.values())]
  }
}

let processRegistry: SecretRegistry | undefined

/** Process-wide registry the production logger and OS keychain share. */
export function appSecretRegistry(): SecretRegistry {
  processRegistry ??= new SecretRegistry()
  return processRegistry
}

/** Account name stored in `api_keys.keychain_ref`. It is not the secret. */
export function createKeychainRef(provider: ApiKeyProvider): string {
  return `citefox.${provider}.${randomUUID()}`
}

/**
 * Keychain account for one `api_keys` row (SERP-1, FR-11.11).
 * The account is the provider plus the key id. It is not the secret.
 * Existing rows keep the `keychain_ref` they were saved with.
 */
export function keychainAccountForKey(provider: ApiKeyProvider, keyId: string): string {
  if (
    !/^[a-z0-9][a-z0-9._:-]{0,80}$/.test(keyId) ||
    HEX_KEY.test(keyId) ||
    ANTHROPIC_KEY.test(keyId)
  ) {
    throw new SecretStoreError('Invalid keychain ref')
  }
  const account = `citefox.${provider}.${keyId}`
  assertKeychainRef(account)
  return account
}

export function assertKeychainRef(keychainRef: string): void {
  if (
    !KEYCHAIN_REF.test(keychainRef) ||
    HEX_KEY.test(keychainRef) ||
    ANTHROPIC_KEY.test(keychainRef)
  ) {
    throw new SecretStoreError('Invalid keychain ref')
  }
}

/**
 * Last {@link API_KEY_HINT_LENGTH} characters stored in `api_keys.hint`.
 * Empty when the secret is {@link HINT_OMIT_MAX_LENGTH} characters or fewer,
 * so a short secret is not shown in full. The UI adds the bullet mask.
 */
export function maskedHint(secret: string): string {
  assertSecret(secret)
  if (secret.length <= HINT_OMIT_MAX_LENGTH) return ''
  return secret.slice(-API_KEY_HINT_LENGTH)
}

const MASKED_HINT = /^(?:|[\x21-\x7E]{4})$/

export function isMaskedHint(value: string): boolean {
  return MASKED_HINT.test(value)
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    throw new SecretStoreError('Invalid secret')
  }
  if (secret.includes('\0')) throw new SecretStoreError('Invalid secret')
}

function readEntry(entry: KeyringEntry, secret: string | null): string | null {
  try {
    return entry.getPassword()
  } catch (error) {
    throw toSafeError(error, [secret])
  }
}

function toSafeError(error: unknown, secrets: readonly (string | null)[]): Error {
  const known = secrets.filter((secret): secret is string => secret !== null && secret.length > 0)
  return redactError(error, { secrets: known })
}
