import { redactString } from '../logging/redact'
import { ProviderError, ProviderTimeoutError, wrapProviderError } from './errors'
import { parseRetryAfter, requestNotSent, runAttempts } from './retry'
import { pinnedHttpRequest, ResponseTooLargeError } from './pinned-http'
import { withTimeout } from './timeout'

export const CITEFOX_USER_AGENT = 'CiteFox'

export interface HttpRequest {
  method: 'GET' | 'POST'
  url: string
  headers?: Readonly<Record<string, string>>
  body?: string
  timeoutMs: number
  signal?: AbortSignal
  /**
   * SSRF guard for user-supplied URLs. Returns every address the host may be
   * reached at, each already validated, or throws. The real transport then
   * connects only to those addresses (no second DNS lookup).
   */
  resolveHost?: (hostname: string) => Promise<readonly string[]>
  /** Abort and fail once the body passes this many bytes. */
  maxBodyBytes?: number
}

export interface HttpResponse {
  status: number
  body: string
  /** Raw body bytes, when the transport has them, for charset-aware decoding. */
  bytes?: Uint8Array
  /** Header names are matched case-insensitively. `retry-after` drives 429 waits. */
  headers?: Readonly<Record<string, string>>
}

/** The only HTTP exit. Tests pass a fake. Production uses `fetch`. */
export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])

export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status)
}

/** Origin and path only, so a query string cannot carry a key into a log. */
export function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return 'request'
  }
}

/**
 * Real HTTPS transport. Redirects are not followed: a 3xx with an
 * Authorization header or an api_key query must not be sent to another host.
 * A request with `resolveHost` goes through {@link pinnedHttpRequest}, which
 * connects only to the validated addresses.
 */
export function createFetchHttpTransport(): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      const label = endpointLabel(request.url)
      if (request.resolveHost !== undefined) return pinnedHttpRequest(request, label)
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: 'manual',
          signal: request.signal
        })
        const body =
          request.maxBodyBytes === undefined
            ? await response.text()
            : await cappedText(response, request.maxBodyBytes, label)
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })
        return { status: response.status, body, headers }
      } catch (error) {
        if (error instanceof ResponseTooLargeError) throw error
        if (request.signal?.aborted) throw new ProviderTimeoutError(label, request.timeoutMs)
        const message = error instanceof Error ? error.message : 'Network request failed'
        throw new ProviderError(`Network request failed for ${label}: ${redactString(message)}`, {
          code: 'network',
          state: 'warning',
          nextStep: 'Check the network and try again.',
          notSent: requestNotSent(error)
        })
      }
    }
  }
}

async function cappedText(response: Response, maxBytes: number, label: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new ResponseTooLargeError(label, maxBytes)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ResponseTooLargeError(label, maxBytes)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface HttpCallOptions {
  sleep?: (ms: number) => Promise<void>
  secrets?: readonly string[]
  timeoutMs: number
  label: string
  /** Clock for an HTTP-date Retry-After. Defaults to `Date.now`. */
  now?: () => number
  /** Total attempts, first one included. Defaults to NFR-2's three. */
  attempts?: number
  /**
   * False for a request that must not be sent twice once it may have reached
   * the server, such as a billed model POST: a timeout then fails at once.
   * A transient status is still retried, because the server answered.
   */
  retryTimeouts?: boolean
}

/**
 * NFR-2. Transient HTTP statuses and timeouts are retried three times
 * unless `attempts` or `retryTimeouts` narrows that.
 * The wait is exponential (200 ms, then 400 ms). A 429 (or any retried
 * response) with Retry-After waits at least that long, and never longer
 * than the retry cap. 401 and other definitive client errors return immediately.
 */
export async function requestWithRetry(
  transport: HttpTransport,
  request: Omit<HttpRequest, 'timeoutMs' | 'signal'>,
  options: HttpCallOptions
): Promise<HttpResponse> {
  const secrets = options.secrets ?? []
  const now = options.now ?? Date.now
  const outcome = await runAttempts(
    async () => {
      try {
        const response = await withTimeout(
          (signal) =>
            transport.request({
              ...request,
              timeoutMs: options.timeoutMs,
              signal
            }),
          options.timeoutMs,
          options.label,
          secrets
        )
        return {
          done: !isTransientHttpStatus(response.status),
          value: response,
          delayMs: parseRetryAfter(headerValue(response.headers, 'retry-after'), now()) ?? undefined
        }
      } catch (error) {
        if (error instanceof ProviderTimeoutError) {
          return {
            done: options.retryTimeouts === false,
            value: { status: 0, body: '' }
          }
        }
        throw wrapProviderError(error, secrets)
      }
    },
    {
      sleep: options.sleep,
      ...(options.attempts === undefined ? {} : { attempts: options.attempts })
    }
  )
  if (outcome.status === 0)
    throw new ProviderTimeoutError(options.label, options.timeoutMs, secrets)
  return outcome
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) return undefined
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value
  }
  return undefined
}
