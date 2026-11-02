import type { ConnectionState } from '@shared/domain'
import type { KeyTestReason } from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import type { SecretStore } from '../../secrets/secret-store'
import { keyTestReasonForCode, wrapProviderError } from '../errors'
import { CITEFOX_USER_AGENT, requestWithRetry, type HttpTransport } from '../http'
import { isRecord } from '../json-schema'
import { logProvider, resolveSecretList } from '../log'

/** A stable public page. The test only checks that Reader accepts the key. */
export const JINA_READER_PROBE_URL = 'https://r.jina.ai/https://example.com'

/** Reader replies are Markdown. Anything past this size is not a page CiteFox can use. */
export const JINA_MAX_BODY_BYTES = 5 * 1024 * 1024

/** Reader URL for a page. The target is appended, not encoded, which is the Reader form. */
export function jinaReaderUrl(pageUrl: string): string {
  return `https://r.jina.ai/${pageUrl}`
}

export interface JinaReadResult {
  status: number
  body: string
}

export interface JinaKeyTest {
  state: ConnectionState
  message: string
  nextStep: string | null
  /** Null when `state` is `ok`. */
  reason: KeyTestReason | null
}

export interface JinaReaderClientOptions {
  transport: HttpTransport
  logger: Logger
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  secrets?: readonly string[] | (() => readonly string[])
}

/**
 * Minimal Reader connectivity test (FR-2.5, FR-11.6). The key is read from
 * SecretStore. An empty key is not a test: that case stays in the UI.
 */
export function createJinaReaderClient(options: JinaReaderClientOptions): {
  testKey(secretStore: SecretStore, keychainRef: string): Promise<JinaKeyTest>
  /** Fetch one page. A null secret still calls Reader, at the lower rate limit (FR-2.5). */
  read(pageUrl: string, secret: string | null): Promise<JinaReadResult>
} {
  const timeoutMs = options.timeoutMs ?? 20_000
  return {
    async read(pageUrl: string, secret: string | null): Promise<JinaReadResult> {
      const secrets = resolveSecretList(options.secrets, secret === null ? [] : [secret])
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-return-format': 'markdown',
        'user-agent': CITEFOX_USER_AGENT,
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'x-no-cache': 'true'
      }
      if (secret !== null) headers.authorization = `Bearer ${secret}`
      const url = jinaReaderUrl(pageUrl)
      const response = await requestWithRetry(
        options.transport,
        { method: 'GET', url, headers, maxBodyBytes: JINA_MAX_BODY_BYTES },
        { timeoutMs, label: 'Jina Reader', secrets, sleep: options.sleep }
      )
      logProvider(
        options.logger,
        'info',
        'jina reader fetch finished',
        { endpoint: url, status: response.status, snippet: response.body.slice(0, 200) },
        secrets
      )
      return { status: response.status, body: response.body }
    },
    async testKey(secretStore: SecretStore, keychainRef: string): Promise<JinaKeyTest> {
      let secret: string | null
      try {
        secret = secretStore.get(keychainRef)
      } catch (error) {
        const wrapped = wrapProviderError(error, resolveSecretList(options.secrets))
        logProvider(
          options.logger,
          'error',
          'jina reader test failed',
          { message: wrapped.message },
          []
        )
        return {
          state: 'warning',
          message: wrapped.message,
          nextStep: wrapped.nextStep,
          reason: keyTestReasonForCode(wrapped.code)
        }
      }
      if (secret === null) {
        return {
          state: 'warning',
          message: 'The Jina key is missing from the keychain.',
          nextStep: 'Add a Jina key, or skip Jina and use the lower rate limits.',
          reason: 'other'
        }
      }
      const secrets = resolveSecretList(options.secrets, [secret])
      try {
        const response = await requestWithRetry(
          options.transport,
          {
            method: 'GET',
            url: JINA_READER_PROBE_URL,
            headers: {
              authorization: `Bearer ${secret}`,
              accept: 'application/json',
              'x-return-format': 'markdown',
              'user-agent': CITEFOX_USER_AGENT
            }
          },
          { timeoutMs, label: 'Jina Reader', secrets, sleep: options.sleep }
        )
        const interpreted = interpretJina(response.status, response.body)
        logProvider(
          options.logger,
          'info',
          'jina reader test finished',
          {
            endpoint: JINA_READER_PROBE_URL,
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
          'jina reader test failed',
          { endpoint: JINA_READER_PROBE_URL, message: wrapped.message },
          secrets
        )
        return {
          state: 'warning',
          message: wrapped.message,
          nextStep: wrapped.nextStep,
          reason: keyTestReasonForCode(wrapped.code)
        }
      }
    }
  }
}

export function interpretJina(status: number, bodyText: string): JinaKeyTest {
  if (
    status === 401 ||
    status === 403 ||
    jsonCode(bodyText) === 401 ||
    jsonCode(bodyText) === 403
  ) {
    return {
      state: 'warning',
      message: 'Jina rejected this key.',
      nextStep:
        'Check the key at jina.ai and replace it, or skip Jina and use the lower rate limits.',
      reason: 'rejected'
    }
  }
  if (status === 429 || jsonCode(bodyText) === 429) {
    return {
      state: 'warning',
      message: 'Jina Reader is rate limiting this key.',
      nextStep: 'Wait and test again. Without a key, Reader still works at lower rate limits.',
      reason: 'rate_limited'
    }
  }
  if (status >= 300 && status < 400) {
    return {
      state: 'warning',
      message: 'Jina Reader sent a redirect CiteFox did not follow.',
      nextStep: 'Test the key again.',
      reason: 'other'
    }
  }
  if (status === 200 && bodyText.trim().length > 0) {
    return {
      state: 'ok',
      message: 'Key works. CiteFox will use the higher rate limits.',
      nextStep: null,
      reason: null
    }
  }
  return {
    state: 'warning',
    message: 'Jina Reader returned a response CiteFox could not read.',
    nextStep: 'Test the key again.',
    reason: 'other'
  }
}

function jsonCode(bodyText: string): number | null {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!isRecord(parsed) || typeof parsed.code !== 'number') return null
    return parsed.code
  } catch {
    return null
  }
}
