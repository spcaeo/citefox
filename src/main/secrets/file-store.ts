import { existsSync, readFileSync } from 'node:fs'
import { atomicWriteFile } from '../storage/atomic-file'
import { createOsKeychainSecretStore, osServiceKeychain } from './keychain'
import {
  createKeychainSecretStore,
  type KeyringEntry,
  type SecretRegistry,
  type SecretStore
} from './secret-store'

/**
 * Test and development only. Points CiteFox at a JSON file instead of the OS
 * keychain, so e2e runs never write to (or prompt for) the real login keychain.
 * A packaged app ignores it.
 */
export const SECRETS_FILE_ENV = 'CITEFOX_SECRETS_FILE'

/** `{ "<service>": { "<account>": "<secret>" } }`, written with mode 0600. */
type SecretsFile = Record<string, Record<string, string>>

/** The file to use instead of the keychain, or null for the OS keychain. */
export function devSecretsFile(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (isPackaged) return null
  const file = env[SECRETS_FILE_ENV]?.trim()
  return file ? file : null
}

/**
 * The app's secret store: the file from {@link devSecretsFile} in an
 * unpackaged run that asks for it, otherwise the OS keychain.
 */
export function createAppSecretStore(
  isPackaged: boolean,
  registry: SecretRegistry,
  service: string
): SecretStore {
  const file = devSecretsFile(isPackaged)
  return file === null
    ? createOsKeychainSecretStore(registry, service)
    : createFileSecretStore(file, registry, service)
}

/** {@link osServiceKeychain} with the same file switch as {@link createAppSecretStore}. */
export function appServiceKeychain(
  isPackaged: boolean,
  service: string
): ReturnType<typeof osServiceKeychain> {
  const file = devSecretsFile(isPackaged)
  if (file === null) return osServiceKeychain(service)
  return {
    service,
    accounts: () => Object.keys(readSecretsFile(file)[service] ?? {}),
    remove(account: string): void {
      fileEntry(file, service, account).deletePassword()
    }
  }
}

/** A secret store that keeps items in one JSON file. Same checks and redaction as the keychain. */
export function createFileSecretStore(
  file: string,
  registry: SecretRegistry,
  service: string
): SecretStore {
  return createKeychainSecretStore(
    { open: (entryService, account) => fileEntry(file, entryService, account) },
    { service, registry }
  )
}

function fileEntry(file: string, service: string, account: string): KeyringEntry {
  return {
    setPassword(password: string): void {
      const data = readSecretsFile(file)
      data[service] = { ...data[service], [account]: password }
      writeSecretsFile(file, data)
    },
    getPassword(): string | null {
      return readSecretsFile(file)[service]?.[account] ?? null
    },
    deletePassword(): boolean {
      const data = readSecretsFile(file)
      const items = data[service]
      if (items === undefined || !(account in items)) return false
      delete items[account]
      writeSecretsFile(file, data)
      return true
    }
  }
}

function readSecretsFile(file: string): SecretsFile {
  if (!existsSync(file)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // JSON.parse quotes part of the text in its message, and the text holds secrets.
    throw new Error('The secrets file is not valid JSON')
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as SecretsFile) : {}
}

function writeSecretsFile(file: string, data: SecretsFile): void {
  atomicWriteFile(file, `${JSON.stringify(data, null, 2)}\n`)
}
