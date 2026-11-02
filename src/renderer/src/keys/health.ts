import {
  serpKeyAllowance,
  type ApiKeyMetadata,
  type ApiKeyProvider,
  type ConnectionState
} from '@shared/domain'
import { KEY_TEST_REASONS, type KeyTestReason, type KeyTestResult } from '@shared/ipc'

/** Warning reasons on `KeyTestResult`. Null on the result means the test is ok. */
export const KEY_WARNING_REASONS = KEY_TEST_REASONS

export type KeyWarningReason = KeyTestReason

const PROVIDER_NAME: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'SerpApi',
  cloro: 'cloro',
  jina: 'Jina',
  anthropic: 'Anthropic',
  youtube: 'YouTube'
}

export function isKeyWarningReason(value: unknown): value is KeyWarningReason {
  return typeof value === 'string' && KEY_WARNING_REASONS.some((item) => item === value)
}

/**
 * Classify a test from `reason`, never from the message text.
 * Null means the test is ok, so the screen can show the engine message (NFR-10).
 */
export function keyWarningReason(result: KeyTestResult): KeyWarningReason | null {
  if (result.reason === null) return null
  return isKeyWarningReason(result.reason) ? result.reason : null
}

/**
 * Copy for a known reason. Out of searches is a working key (lead decision).
 * A rejected key is a different warning.
 */
export function warningCopy(provider: ApiKeyProvider, reason: KeyWarningReason): string {
  const name = PROVIDER_NAME[provider]
  if (reason === 'rejected') {
    if (provider === 'serpapi') {
      return 'SerpApi rejected this key. Check the key on your SerpApi dashboard and paste it again.'
    }
    return `${name} rejected this key. Check the key and paste it again.`
  }
  if (reason === 'out_of_searches') {
    return `${name} is out of searches for this month. Raise the plan or wait until it resets.`
  }
  if (reason === 'rate_limited')
    return `${name} returned 429. Wait a moment and test the key again.`
  if (reason === 'timeout') return `The ${name} test timed out. Try again.`
  return `${name} returned a response CiteFox could not read. Try the key again.`
}

export const WORKING_KEY_NOTE = 'The key works. This warning is only that it has no searches left.'

/**
 * No key, or a key the user turned off, is `off` (FR-24.2).
 * A missing keychain item is `warning`. `unchecked` is saved and never tested.
 */
export function rollUpKeyState(
  key: Pick<ApiKeyMetadata, 'on' | 'state'> | null | undefined,
  keychainPresent = true
): ConnectionState {
  if (!key || !key.on) return 'off'
  if (!keychainPresent) return 'warning'
  return key.state
}

/**
 * Claude Code stays a connection even when the selected provider is `anthropic-api`.
 * Unchecked until the first checkup. Ready is ok. A next step is warning.
 */
export function rollUpClaudeState(checkup: { ready: boolean } | null | undefined): ConnectionState {
  if (!checkup) return 'unchecked'
  return checkup.ready ? 'ok' : 'warning'
}

/**
 * Searches still available this month (FR-24.1).
 * Null when this tested key has neither a plan allowance nor a cap.
 * Out of searches is 0. A null cap is not a number.
 */
export function searchesLeftForKey(
  key:
    | (Pick<ApiKeyMetadata, 'on' | 'state' | 'cap' | 'serpapiUsage'> & { usedThisMonth?: number })
    | null
    | undefined
): number | null {
  if (!key || !key.on) return null
  if (key.state === 'unchecked' || key.state === 'off') return null
  return serpKeyAllowance(key)?.left ?? null
}

/** Empty project ids are every project (lead decision). */
export function projectsLabel(projectIds: readonly string[]): string {
  if (projectIds.length === 0) return 'All projects'
  return projectIds.join(', ')
}

/** A null cap is no cap (lead decision). */
export function capLabel(cap: number | null): string {
  if (cap === null) return 'No cap'
  return `${cap.toLocaleString('en-US')} searches`
}

export function connectionStateLabel(
  state: ConnectionState
): 'OK' | 'Warning' | 'Off' | 'Not tested' {
  if (state === 'ok') return 'OK'
  if (state === 'warning') return 'Warning'
  if (state === 'off') return 'Off'
  return 'Not tested'
}

export function providerTitle(provider: ApiKeyProvider): string {
  return PROVIDER_NAME[provider]
}
