import { rmSync } from 'node:fs'
import { basename } from 'node:path'
import type { OpenTestProfileRequest, OpenTestProfileResult } from '@shared/ipc'
import type { Logger } from '../logging/logger'
import { TEST_PROFILE_KEYCHAIN_SERVICE } from '../secrets/keychain'
import { TEST_PROFILE_FOLDER } from './profile'

/** The keychain items of one service. Production uses @napi-rs/keyring. */
export interface ServiceKeychain {
  readonly service: string
  /** Account names only; a secret never leaves this call. */
  accounts(): string[]
  remove(account: string): void
}

export interface TestProfileDeps {
  /** `<appData>/CiteFox Test Profile`. */
  dataDir: string
  /** Must be the 'CiteFox Test' service. */
  keychain: ServiceKeychain
  isRunning(): boolean
  /** Starts the detached test window. A running one is focused by its own lock. */
  launch(): void
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  removeFolder?: (path: string) => void
}

export const CLOSE_TEST_WINDOW_FIRST = 'Close the test window first, then start fresh.'

/**
 * `app:openTestProfile`. `fresh` clears the test profile's folder and its own
 * keychain items first, and only while no test window is open. Opening while
 * one is open focuses it and reports `alreadyOpen`.
 */
export function openTestProfile(
  deps: TestProfileDeps,
  request: OpenTestProfileRequest
): OpenTestProfileResult {
  const running = deps.isRunning()
  if (request.fresh) {
    if (running) return { ok: false, message: CLOSE_TEST_WINDOW_FIRST }
    try {
      clearTestProfile(deps)
    } catch (error: unknown) {
      deps.logger.error('CiteFox could not clear the test profile', error)
      return {
        ok: false,
        message: 'CiteFox could not clear the test profile. Close any test window and try again.'
      }
    }
  }
  try {
    deps.launch()
  } catch (error: unknown) {
    deps.logger.error('CiteFox could not open the test profile', error)
    return { ok: false, message: 'CiteFox could not open the test window.' }
  }
  deps.logger.info(
    `CiteFox opened the test profile${request.fresh ? ' fresh' : ''}${running ? ' (already open)' : ''}`
  )
  return { ok: true, alreadyOpen: running }
}

/**
 * Deletes the test profile folder and every 'CiteFox Test' keychain item.
 * Refuses anything else, so the real data and the 'CiteFox' items stay.
 */
export function clearTestProfile(deps: TestProfileDeps): void {
  if (deps.keychain.service !== TEST_PROFILE_KEYCHAIN_SERVICE) {
    throw new Error('Refusing to clear keychain items that are not the test profile’s')
  }
  if (basename(deps.dataDir) !== TEST_PROFILE_FOLDER) {
    throw new Error('Refusing to clear a folder that is not the test profile')
  }
  let failed = 0
  for (const account of deps.keychain.accounts()) {
    try {
      deps.keychain.remove(account)
    } catch {
      failed += 1
    }
  }
  if (failed > 0) throw new Error(`${failed} test profile keychain items could not be removed`)
  const remove =
    deps.removeFolder ?? ((path: string) => rmSync(path, { recursive: true, force: true }))
  remove(deps.dataDir)
}
