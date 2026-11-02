import type { CloroCredits, ConnectionState } from '@shared/domain'
import type { KeyTestReason } from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import type { SecretStore } from '../../secrets/secret-store'
import { keyTestReasonForCode, wrapProviderError } from '../errors'
import { CITEFOX_USER_AGENT, endpointLabel, requestWithRetry, type HttpTransport } from '../http'
import { isRecord } from '../json-schema'
import { logProvider, resolveSecretList } from '../log'
import { CLORO_CREDITS_URL } from './api'

export interface CloroKeyTest {
  state: ConnectionState
  message: string
  nextStep: string | null
  credits: CloroCredits | null
  /** Null when `state` is `ok`. */
  reason: KeyTestReason | null
}

export interface CloroAccountClientOptions {
  transport: HttpTransport
  logger: Logger
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  secrets?: readonly string[] | (() => readonly string[])
}

/**
 * Tests a cloro key with `GET /v1/credits`, which cloro does not bill, and reads the
 * balance Connections shows. The key is read from the keychain, never taken as an argument.
 */
export function createCloroAccountClient(options: CloroAccountClientOptions): {
  testKey(secretStore: SecretStore, keychainRef: string): Promise<CloroKeyTest>
} {
  const timeoutMs = options.timeoutMs ?? 15_000
  return {
    async testKey(secretStore, keychainRef) {
      let secret: string | null
      try {
        secret = secretStore.get(keychainRef)
      } catch (error) {
        const wrapped = wrapProviderError(error, resolveSecretList(options.secrets))
        return warning(wrapped.message, wrapped.nextStep, keyTestReasonForCode(wrapped.code))
      }
      if (secret === null) {
        return warning(
          'The cloro key is missing from the keychain.',
          'Add the key again. CiteFox reads it from the keychain.',
          'other'
        )
      }
      const secrets = resolveSecretList(options.secrets, [secret])
      try {
        const response = await requestWithRetry(
          options.transport,
          {
            method: 'GET',
            url: CLORO_CREDITS_URL,
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${secret}`,
              'user-agent': CITEFOX_USER_AGENT
            }
          },
          { timeoutMs, label: 'cloro credits', secrets, sleep: options.sleep }
        )
        const interpreted = interpretCloroCredits(response.status, response.body)
        logProvider(
          options.logger,
          'info',
          'cloro key test finished',
          {
            endpoint: endpointLabel(CLORO_CREDITS_URL),
            status: response.status,
            state: interpreted.state
          },
          secrets
        )
        return interpreted
      } catch (error) {
        const wrapped = wrapProviderError(error, secrets)
        logProvider(
          options.logger,
          'error',
          'cloro key test failed',
          { endpoint: endpointLabel(CLORO_CREDITS_URL), message: wrapped.message },
          secrets
        )
        return warning(wrapped.message, wrapped.nextStep, keyTestReasonForCode(wrapped.code))
      }
    }
  }
}

/** Reads a `/v1/credits` answer. Messages are fixed sentences, never the body or the key. */
export function interpretCloroCredits(status: number, bodyText: string): CloroKeyTest {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText) as unknown
  } catch {
    parsed = null
  }
  if (status === 401 || status === 403) {
    return warning(
      'cloro rejected this key.',
      'Copy a new key from the cloro dashboard and replace this one.',
      'rejected'
    )
  }
  if (status === 429) {
    return warning('cloro is limiting this key.', 'Wait a moment and test again.', 'rate_limited')
  }
  const credits = status === 200 ? creditsFrom(parsed) : null
  if (credits === null) {
    return warning(
      status === 200
        ? 'cloro returned a response CiteFox could not read.'
        : 'cloro did not answer the key test.',
      'Test the key again. If it keeps failing, check status.cloro.dev.',
      'other'
    )
  }
  if (credits.remaining === 0) {
    return {
      state: 'warning',
      message: 'This cloro key is out of credits.',
      nextStep: 'Wait for the plan to reset, or top up on the cloro dashboard.',
      credits,
      reason: 'out_of_searches'
    }
  }
  return { state: 'ok', message: okMessage(credits), nextStep: null, credits, reason: null }
}

function creditsFrom(value: unknown): CloroCredits | null {
  if (!isRecord(value)) return null
  const remaining = wholeNumber(value.remaining)
  if (remaining === null) return null
  const resets = typeof value.cycleResetsAt === 'string' ? value.cycleResetsAt.trim() : ''
  return {
    remaining,
    perCycle: wholeNumber(value.perCycle),
    resetsAt:
      resets.length > 0 && !Number.isNaN(Date.parse(resets)) ? new Date(resets).toISOString() : null
  }
}

function okMessage(credits: CloroCredits): string {
  const left = credits.remaining.toLocaleString('en-US')
  if (credits.perCycle === null) return `Key works. ${left} credits left.`
  return `Key works. ${left} of ${credits.perCycle.toLocaleString('en-US')} credits left this cycle.`
}

function warning(message: string, nextStep: string | null, reason: KeyTestReason): CloroKeyTest {
  return { state: 'warning', message, nextStep, credits: null, reason }
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}
