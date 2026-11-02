import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Service name of every CiteFox keychain item (`KEYCHAIN_SERVICE` in src/main/secrets). */
const KEYCHAIN_SERVICE = 'CiteFox'

/**
 * Where an e2e launch keeps its secrets. `launchCiteFox` sets
 * `CITEFOX_SECRETS_FILE` to this file in the run's data folder, so the app
 * never writes to the real login keychain (macOS Keychain, Windows Credential
 * Manager, or the Secret Service). The file goes when the folder goes.
 */
export function testSecretsFile(userDataDir: string): string {
  return path.join(userDataDir, 'e2e-secrets.json')
}

/** True when the run's secrets file holds a CiteFox item for `account` (a keychain_ref). */
export function keychainItemExists(userDataDir: string, account: string): boolean {
  const file = testSecretsFile(userDataDir)
  if (!existsSync(file)) return false
  const items = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>
  return Object.hasOwn(items[KEYCHAIN_SERVICE] ?? {}, account)
}
