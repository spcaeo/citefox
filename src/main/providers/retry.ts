import { ProviderError } from './errors'
import { sleep } from './timeout'

/** NFR-2. Three attempts, then the failure stands. */
export const RETRY_ATTEMPTS = 3

/** First wait is 200 ms, then 400 ms. Attempt 1 is the first try, not a wait. */
export const RETRY_BASE_DELAY_MS = 200

/**
 * Upper bound on a retry wait. Exponential backoff stays under this.
 * A Retry-After of minutes is cut here so a key test cannot stall the app.
 */
export const RETRY_DELAY_CAP_MS = 30_000

export function retryDelayMs(failedAttempt: number, baseDelayMs = RETRY_BASE_DELAY_MS): number {
  return baseDelayMs * 2 ** (failedAttempt - 1)
}

/**
 * `Retry-After` is either delay-seconds or an HTTP-date.
 * Returns milliseconds from `nowMs`, or null when the header is unusable.
 */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds)) return null
    return Math.max(0, Math.round(seconds * 1000))
  }
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, parsed - nowMs)
}

/**
 * Paid-call rule. A SerpApi search is billed per request (checks send `no_cache`), and
 * SerpApi may run, and bill, a search even when CiteFox never sees its answer. So a failed
 * paid attempt is retried only when it clearly never cost anything:
 *
 * - retry: the request never left this computer or never reached SerpApi (the DNS lookup
 *   failed, the connection was refused, the host or network was unreachable), or SerpApi
 *   refused it with a 429 rate limit before running the search;
 * - never retry: a timeout once the request was sent, a connection dropped mid-request, a
 *   408 or any 5xx once SerpApi accepted the request. The search may already be billed, so
 *   a second attempt could pay twice. The failure stands; the user presses Check now.
 *
 * A key SerpApi rejects, or an account out of searches, is never retried either: waiting
 * does not fix it. Free calls (the account test, Jina, YouTube) keep NFR-2's retries.
 */
export type PaidAttemptFailure =
  /** The request never reached the server ({@link requestNotSent}). */
  | { kind: 'not_sent' }
  /** Sent, then no answer: a timeout or a connection dropped mid-request. */
  | { kind: 'sent' }
  /** The server answered with this HTTP status. */
  | { kind: 'status'; status: number }

export function mayRetryPaidCall(failure: PaidAttemptFailure): boolean {
  if (failure.kind === 'not_sent') return true
  if (failure.kind === 'sent') return false
  return failure.status === 429
}

/** Socket and DNS codes that mean the request was never delivered to the server. */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT'
])

/**
 * True when a transport error shows the request never reached the server: a
 * {@link ProviderError} marked `notSent`, or a socket or DNS code from the list above on
 * the error or its causes (fetch puts it on `cause`; several addresses tried in turn give
 * an AggregateError, which counts only when every address failed that way). A reset,
 * a broken pipe or an unknown error is not proof, so it is false.
 */
export function requestNotSent(error: unknown, depth = 0): boolean {
  if (depth > 4 || typeof error !== 'object' || error === null) return false
  if (error instanceof ProviderError) {
    if (error.notSent) return true
    if (error.code === 'timeout') return false
  }
  const record = error as { code?: unknown; cause?: unknown; errors?: unknown }
  if (typeof record.code === 'string' && NOT_SENT_CODES.has(record.code)) return true
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    return record.errors.every((item) => requestNotSent(item, depth + 1))
  }
  return requestNotSent(record.cause, depth + 1)
}

/**
 * Runs `run` up to `attempts` times. `done: false` waits, then tries again.
 * The last attempt is returned even when it still wants a retry.
 */
export async function runAttempts<T>(
  run: (attempt: number) => Promise<{ done: boolean; value: T; delayMs?: number }>,
  options?: {
    attempts?: number
    baseDelayMs?: number
    /** Caps both exponential backoff and a Retry-After wait. */
    capMs?: number
    sleep?: (ms: number) => Promise<void>
  }
): Promise<T> {
  const attempts = options?.attempts ?? RETRY_ATTEMPTS
  const baseDelayMs = options?.baseDelayMs ?? RETRY_BASE_DELAY_MS
  const capMs = options?.capMs ?? RETRY_DELAY_CAP_MS
  const sleepFn = options?.sleep ?? sleep
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ProviderError('Retry attempts must be a positive integer', {
      code: 'network',
      state: 'warning',
      nextStep: 'Try again.'
    })
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outcome = await run(attempt)
    if (outcome.done || attempt === attempts) return outcome.value
    const backoff = retryDelayMs(attempt, baseDelayMs)
    const requested = outcome.delayMs === undefined ? backoff : Math.max(backoff, outcome.delayMs)
    await sleepFn(Math.min(Math.max(0, requested), capMs))
  }
  throw new ProviderError('Retry loop ended without a result', {
    code: 'network',
    state: 'warning',
    nextStep: 'Try again.'
  })
}
