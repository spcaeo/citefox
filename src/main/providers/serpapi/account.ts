import type { ConnectionState, SerpApiUsage } from '@shared/domain'
import type { KeyTestReason } from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import type { SecretStore } from '../../secrets/secret-store'
import { redactString } from '../../logging/redact'
import { keyTestReasonForCode, wrapProviderError } from '../errors'
import { CITEFOX_USER_AGENT, endpointLabel, requestWithRetry, type HttpTransport } from '../http'
import { isRecord } from '../json-schema'
import { logProvider, resolveSecretList } from '../log'
import { planLabel } from '@shared/plan-label'

export const SERPAPI_ACCOUNT_URL = 'https://serpapi.com/account.json'

export interface SerpApiKeyTest {
  state: ConnectionState
  message: string
  nextStep: string | null
  usage: SerpApiUsage | null
  /** Null when `state` is `ok`. */
  reason: KeyTestReason | null
}

export interface SerpApiAccountClientOptions {
  transport: HttpTransport
  logger: Logger
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  secrets?: readonly string[] | (() => readonly string[])
}

/**
 * SERP-7. Usage comes from the account endpoint. SERP-1: the key is read from
 * SecretStore and is not taken as a function argument. Section 2.3: a failed
 * test does not suggest opening another free account.
 */
export function createSerpApiAccountClient(options: SerpApiAccountClientOptions): {
  testKey(secretStore: SecretStore, keychainRef: string): Promise<SerpApiKeyTest>
} {
  const timeoutMs = options.timeoutMs ?? 15_000
  return {
    async testKey(secretStore: SecretStore, keychainRef: string): Promise<SerpApiKeyTest> {
      let secret: string | null
      try {
        secret = secretStore.get(keychainRef)
      } catch (error) {
        const wrapped = wrapProviderError(error, resolveSecretList(options.secrets))
        logProvider(
          options.logger,
          'error',
          'serpapi account test failed',
          { message: wrapped.message },
          []
        )
        return {
          state: 'warning',
          message: wrapped.message,
          nextStep: wrapped.nextStep,
          usage: null,
          reason: keyTestReasonForCode(wrapped.code)
        }
      }
      if (secret === null) {
        return {
          state: 'warning',
          message: 'The SerpApi key is missing from the keychain.',
          nextStep: 'Add the key again. CiteFox reads it from the keychain.',
          usage: null,
          reason: 'other'
        }
      }
      const secrets = resolveSecretList(options.secrets, [secret])
      try {
        const url = new URL(SERPAPI_ACCOUNT_URL)
        url.searchParams.set('api_key', secret)
        const response = await requestWithRetry(
          options.transport,
          {
            method: 'GET',
            url: url.href,
            headers: { accept: 'application/json', 'user-agent': CITEFOX_USER_AGENT }
          },
          { timeoutMs, label: 'SerpApi account', secrets, sleep: options.sleep }
        )
        const interpreted = interpretSerpApiAccount(response.status, response.body, secrets)
        logProvider(
          options.logger,
          'info',
          'serpapi account test finished',
          {
            endpoint: endpointLabel(SERPAPI_ACCOUNT_URL),
            status: response.status,
            state: interpreted.state,
            snippet: response.body.slice(0, 200)
          },
          secrets
        )
        return interpreted
      } catch (error) {
        const wrapped = wrapProviderError(error, secrets)
        logProvider(
          options.logger,
          'error',
          'serpapi account test failed',
          { endpoint: endpointLabel(SERPAPI_ACCOUNT_URL), message: wrapped.message },
          secrets
        )
        return {
          state: 'warning',
          message: wrapped.message,
          nextStep: wrapped.nextStep,
          usage: null,
          reason: keyTestReasonForCode(wrapped.code)
        }
      }
    }
  }
}

/**
 * `unchecked` is only for a key that has not been tested. A finished account
 * call is `ok` or `warning`. `off` is reserved for no key stored, or a key
 * the user turned off, and is not returned from this test.
 */
export function classifySerpApiAccount(input: {
  attempted: boolean
  invalidKey: boolean
  outOfSearches: boolean
  httpStatus: number | null
}): ConnectionState {
  if (!input.attempted) return 'unchecked'
  if (input.invalidKey || input.httpStatus === 401 || input.httpStatus === 403) return 'warning'
  if (input.outOfSearches) return 'warning'
  if (input.httpStatus === 200) return 'ok'
  return 'warning'
}

export function interpretSerpApiAccount(
  status: number,
  bodyText: string,
  secrets: readonly string[]
): SerpApiKeyTest {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText) as unknown
  } catch {
    return {
      state: 'warning',
      message: 'SerpApi returned a response CiteFox could not read.',
      nextStep: 'Test the key again. If it keeps failing, check serpapi.com status.',
      usage: null,
      reason: 'other'
    }
  }
  if (!isRecord(parsed)) {
    return {
      state: 'warning',
      message: 'SerpApi returned a response CiteFox could not read.',
      nextStep: 'Test the key again. If it keeps failing, check serpapi.com status.',
      usage: null,
      reason: 'other'
    }
  }
  const errorText = typeof parsed.error === 'string' ? parsed.error : ''
  const invalid = status === 401 || status === 403 || /invalid api key/i.test(errorText)
  const usage = usageFromAccount(parsed)
  const outOfSearches = isOutOfSearches(parsed, usage) || /run out of searches/i.test(errorText)
  if (invalid) {
    return {
      state: classifySerpApiAccount({
        attempted: true,
        invalidKey: true,
        outOfSearches: false,
        httpStatus: status
      }),
      message: 'SerpApi rejected this key.',
      nextStep: 'Copy a new key from the SerpApi dashboard and replace this one.',
      usage: null,
      reason: 'rejected'
    }
  }
  if (outOfSearches) {
    return {
      state: classifySerpApiAccount({
        attempted: true,
        invalidKey: false,
        outOfSearches: true,
        httpStatus: status
      }),
      message:
        usage === null ? 'This key is out of searches for the month.' : outOfSearchesMessage(usage),
      nextStep: 'Wait for the plan to reset, or add a key you are entitled to use.',
      usage,
      reason: 'out_of_searches'
    }
  }
  if (status === 429) {
    return {
      state: 'warning',
      message: 'SerpApi is limiting this key.',
      nextStep: 'Wait and test again, or check the plan hourly limit.',
      usage,
      reason: 'rate_limited'
    }
  }
  if (status >= 300 && status < 400) {
    return {
      state: 'warning',
      message: 'SerpApi sent a redirect CiteFox did not follow.',
      nextStep: 'Test the key again.',
      usage: null,
      reason: 'other'
    }
  }
  if (status !== 200 || usage === null) {
    return {
      state: 'warning',
      message:
        status === 200
          ? 'SerpApi did not report usage for this key.'
          : 'SerpApi did not answer the account check.',
      nextStep: 'Test the key again. If it keeps failing, check serpapi.com status.',
      usage: null,
      reason: 'other'
    }
  }
  return {
    state: 'ok',
    message: redactString(okMessage(usage), { secrets }),
    nextStep: null,
    usage,
    reason: null
  }
}

function usageFromAccount(record: Record<string, unknown>): SerpApiUsage | null {
  const used = finiteInt(record.this_month_usage)
  if (used === null) return null
  const planLimit = finiteInt(record.searches_per_month)
  const plan =
    typeof record.plan_name === 'string' &&
    record.plan_name.trim().length > 0 &&
    record.plan_name.length <= 80
      ? record.plan_name.trim()
      : null
  return { used, planLimit, plan }
}

function isOutOfSearches(record: Record<string, unknown>, usage: SerpApiUsage | null): boolean {
  const left = finiteInt(record.plan_searches_left)
  const totalLeft = finiteInt(record.total_searches_left)
  if (left === 0 || totalLeft === 0) return true
  return usage !== null && usage.planLimit !== null && usage.used >= usage.planLimit
}

function okMessage(usage: SerpApiUsage): string {
  if (usage.planLimit === null) {
    const plan = usage.plan === null ? '' : ` on the ${planLabel(usage.plan)}`
    return `Key works. ${grouped(usage.used)} searches used this month${plan}.`
  }
  const plan = usage.plan === null ? '' : ` on the ${planLabel(usage.plan)}`
  return `Key works. ${grouped(usage.used)} of ${grouped(usage.planLimit)} searches used this month${plan}.`
}

function outOfSearchesMessage(usage: SerpApiUsage): string {
  const plan = usage.plan === null ? '' : ` on the ${planLabel(usage.plan)}`
  if (usage.planLimit === null) return `This key is out of searches for the month${plan}.`
  return `This key is out of searches for the month. ${grouped(usage.used)} of ${grouped(usage.planLimit)} used${plan}.`
}

function grouped(value: number): string {
  return value.toLocaleString('en-US')
}

function finiteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}
