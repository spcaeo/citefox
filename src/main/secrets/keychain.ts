import { Entry, findCredentials, type EntryOptions } from '@napi-rs/keyring'
import {
  appSecretRegistry,
  createKeychainSecretStore,
  type KeyringEntry,
  type SecretRegistry,
  type SecretStore
} from './secret-store'

/** Service name of every CiteFox keychain item. Matches `app.setName('CiteFox')`. */
export const KEYCHAIN_SERVICE = 'CiteFox'

/**
 * Service name in the "Test as a new user" profile. Different from
 * {@link KEYCHAIN_SERVICE}, so a test window can never read, overwrite or
 * delete a real key.
 */
export const TEST_PROFILE_KEYCHAIN_SERVICE = 'CiteFox Test'

export function keychainServiceFor(testProfile: boolean): string {
  return testProfile ? TEST_PROFILE_KEYCHAIN_SERVICE : KEYCHAIN_SERVICE
}

/**
 * Linux uses libsecret (Secret Service) so the item is a real keychain entry
 * that survives a reboot. macOS uses Keychain and Windows uses Credential
 * Manager; the option is ignored on those platforms.
 */
export const OS_KEYCHAIN_ENTRY_OPTIONS: EntryOptions = {
  linux: { store: 'secret-service' }
}

/**
 * Production secret store. Tests use `MemorySecretStore` and never call this.
 *
 * Nothing is read from the keychain at startup. Each secret joins the logger's
 * registry on its first get or set, which is before the process can log it.
 * Reading every CiteFox item up front made macOS ask for the keychain password
 * once per item, before any window opened, whenever the items were written by
 * a build with a different signature (dev, unsigned, or a re-signed release).
 */
export function createOsKeychainSecretStore(
  registry: SecretRegistry = appSecretRegistry(),
  service: string = KEYCHAIN_SERVICE
): SecretStore {
  return createKeychainSecretStore(
    {
      open(service, account): KeyringEntry {
        return new Entry(service, account, OS_KEYCHAIN_ENTRY_OPTIONS)
      }
    },
    { service, registry }
  )
}

/**
 * Account names of every item under one service, and removal by name. Only
 * "Test as a new user → Start fresh" uses it, with the test service. The
 * secrets `findCredentials` returns are dropped here and never logged.
 */
export function osServiceKeychain(service: string): {
  readonly service: string
  accounts(): string[]
  remove(account: string): void
} {
  return {
    service,
    accounts: () => findCredentials(service).map((credential) => credential.account),
    remove(account: string): void {
      new Entry(service, account, OS_KEYCHAIN_ENTRY_OPTIONS).deletePassword()
    }
  }
}
