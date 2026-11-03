import type { CheckErrorCode, SearchProvider } from '@shared/domain'
import type { MarketDevice } from '@shared/domain'
import type { GoogleExtras } from '../../providers/serpapi/extras'
import { serpApiGl } from '@shared/domain'
import { RATE_LIMITED_MESSAGE } from '../../providers/cloro/api'
import { ProviderTimeoutError } from '../../providers/errors'
import { CITEFOX_USER_AGENT, type HttpResponse, type HttpTransport } from '../../providers/http'
import { isRecord } from '../../providers/json-schema'
import {
  mayRetryPaidCall,
  parseRetryAfter,
  requestNotSent,
  RETRY_DELAY_CAP_MS,
  retryDelayMs
} from '../../providers/retry'
import { SERPAPI_SEARCH_URL, interpretSearch } from '../../providers/serpapi/search'
import { withTimeout } from '../../providers/timeout'
import { createCallPacer, RATE_LIMIT_ATTEMPTS, type CallPacer } from './provider-pacer'
import { redactSerpBody } from './redact'

/**
 * How long one SerpApi search may take before it is a timeout. A search that loads an AI
 * Overview can take well over 20 s; a cut-off search is still billed, so waiting longer is
 * cheaper than trying again.
 */
export const SERP_TIMEOUT_MS = 60_000

/**
 * HTTP attempts per SerpApi search (one Google search, or one AI Overview follow-up): the
 * first try and at most one retry. Searches run with `no_cache`, so SerpApi may bill every
 * attempt, and the paid-call rule (`mayRetryPaidCall` in providers/retry.ts) decides which
 * failures get that retry: a request that never reached SerpApi (DNS, connection refused)
 * and a 429 within the Retry-After cap do; a timeout, a dropped connection, a 408 or a 5xx
 * never do, because SerpApi may already have billed that search. An empty 200 keeps its
 * one retry (FR-5.5). Every attempt is counted.
 */
export const SERP_SEARCH_ATTEMPTS = 2

export interface CaptureQuery {
  q: string
  gl: string
  hl: string
  location: string | null
  device: MarketDevice
}

export interface CaptureReference {
  url: string
  title: string | null
}

export interface SerpCapture {
  hasAio: boolean
  neededFollowup: boolean
  searches: number
  /** True when a later provider call was not started because the check was cancelled. */
  halted: boolean
  errorCode: CheckErrorCode | null
  message: string | null
  nextStep: string | null
  aioText: string | null
  references: readonly CaptureReference[]
  rawSearchJson: string | null
  rawAioJson: string | null
  /**
   * SerpApi's Retry-After on a `rate_limited` failure, in milliseconds.
   * Null when it sent none. The key rotation rests the key that long.
   */
  retryAfterMs: number | null
  /** cloro credits charged (`X-Credits-Charged`). Absent or 0 for SerpApi, which bills searches. */
  credits?: number
  /** Who ran the search. Absent means SerpApi. */
  provider?: SearchProvider
  /** cloro's AI Overview as markdown, when it sent one. */
  markdown?: string | null
  /** Organic top 10 and "People also ask", read by the provider. Absent: read from `rawSearchJson`. */
  extras?: GoogleExtras
}

export interface CaptureOptions {
  transport: HttpTransport
  secret: string
  query: CaptureQuery
  secrets?: readonly string[]
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /**
   * Called before every SerpApi HTTP attempt, including retries and the AI Overview follow-up.
   * False means that attempt must not start. An attempt already in flight is left to finish.
   */
  beforeRequest?: () => Promise<boolean>
  /** Synchronous cancel flag checked before a retry wait, so backoff does not start another search. */
  stopRequested?: () => boolean
  /** Clock for an HTTP-date Retry-After. Defaults to `Date.now`. */
  now?: () => number
  /**
   * SerpApi's shared pace (provider-pacer.ts): its cooldown applies to every search, and
   * a 429 is retried on it. Without one the search paces itself.
   */
  pacer?: CallPacer
}

/**
 * SERP-3 and SERP-4. One Google search, then `google_ai_overview` on the same
 * key when the overview is only a page token. A token expiry runs that pair
 * once more. Each of those searches gets {@link SERP_SEARCH_ATTEMPTS} HTTP attempts at most
 * (a retry only where the paid-call rule allows it), and every attempt counts (FR-5.5).
 */
export async function captureSerpApi(options: CaptureOptions): Promise<SerpCapture> {
  const secrets = options.secrets ?? [options.secret]
  const sleep = options.sleep ?? (async () => undefined)
  const timeoutMs = options.timeoutMs ?? SERP_TIMEOUT_MS
  let searches = 0
  let neededFollowup = false
  let lastSearch: string | null = null
  let lastAio: string | null = null
  const googleParams: Record<string, string> = {
    engine: 'google',
    q: options.query.q,
    gl: serpApiGl(options.query.gl),
    hl: options.query.hl.toLowerCase(),
    device: options.query.device,
    no_cache: 'true'
  }
  if (options.query.location !== null) googleParams.location = options.query.location
  for (let pair = 0; pair < 2; pair += 1) {
    const google = await callSerp(options, secrets, sleep, timeoutMs, googleParams, (count) => {
      searches += count
    })
    lastSearch = google.rawSearch
    if (google.outcome === 'halted') {
      return stopped(searches, neededFollowup, lastSearch, lastAio)
    }
    if (google.outcome === 'expired') continue
    if (google.outcome === 'failure') {
      return failed(google, searches, neededFollowup, google.rawSearch, null)
    }
    if (google.pageToken !== null) {
      neededFollowup = true
      const follow = await callSerp(
        options,
        secrets,
        sleep,
        timeoutMs,
        { engine: 'google_ai_overview', page_token: google.pageToken },
        (count) => {
          searches += count
        },
        true
      )
      lastAio = follow.rawSearch
      if (follow.outcome === 'halted') {
        return stopped(searches, neededFollowup, lastSearch, lastAio)
      }
      if (follow.outcome === 'expired') continue
      if (follow.outcome === 'failure') {
        return failed(follow, searches, neededFollowup, google.rawSearch, follow.rawSearch)
      }
      return loaded(follow, searches, true, google.rawSearch, follow.rawSearch)
    }
    return loaded(google, searches, false, google.rawSearch, null)
  }
  return {
    hasAio: false,
    neededFollowup,
    searches,
    halted: false,
    errorCode: 'token_expired',
    message: 'The AI Overview follow-up expired. CiteFox tried once more with the same key.',
    nextStep: 'Press Check now to try again.',
    aioText: null,
    references: [],
    rawSearchJson: lastSearch,
    rawAioJson: lastAio,
    retryAfterMs: null
  }
}

interface CallBody {
  outcome: 'loaded' | 'expired' | 'failure' | 'halted'
  pageToken: string | null
  hasAio: boolean
  errorCode: CheckErrorCode | null
  message: string | null
  nextStep: string | null
  aioText: string | null
  references: CaptureReference[]
  rawSearch: string | null
  retryAfterMs: number | null
}

async function callSerp(
  options: CaptureOptions,
  secrets: readonly string[],
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  params: Readonly<Record<string, string>>,
  count: (attempts: number) => void,
  followUp = false
): Promise<CallBody> {
  const now = options.now ?? Date.now
  let last: CallBody = failedCall(
    'other',
    'SerpApi did not return an AI Overview CiteFox could read.',
    null
  )
  const pacer = options.pacer ?? createCallPacer('serpapi', { now, sleep })
  let rateLimitedTries = 0
  let afterRateLimit = false
  for (let attempt = 1; attempt <= SERP_SEARCH_ATTEMPTS; attempt += 1) {
    // Wait out the shared cooldown first.
    const ticket = await pacer.begin(options.stopRequested)
    if (ticket === null) return haltedCall()
    if (afterRateLimit) {
      // The same search again after a 429: refused before it ran, so not counted or
      // checked against the cap a second time. A cancel still stops it.
      if (options.stopRequested?.() === true) return haltedCall()
    } else {
      // A cancel or cap stop between retries is a halt, never an error sample.
      if (!(await admitted(options))) return haltedCall()
      count(1)
    }
    afterRateLimit = false
    let response: HttpResponse
    try {
      response = await withTimeout(
        (signal) =>
          options.transport.request({
            method: 'GET',
            url: searchUrl(options.secret, params),
            headers: { accept: 'application/json', 'user-agent': CITEFOX_USER_AGENT },
            timeoutMs,
            signal
          }),
        timeoutMs,
        'SerpApi search',
        secrets
      )
    } catch (error) {
      const timeout = error instanceof ProviderTimeoutError
      last = failedCall(
        timeout ? 'timeout' : 'other',
        timeout
          ? 'The SerpApi search timed out.'
          : 'SerpApi did not return an AI Overview CiteFox could read.',
        timeout ? 'Check the network and try again.' : null
      )
      // Paid-call rule: only a request that never reached SerpApi is sent again.
      const notSent = !timeout && requestNotSent(error)
      if (
        mayRetryPaidCall({ kind: notSent ? 'not_sent' : 'sent' }) &&
        attempt < SERP_SEARCH_ATTEMPTS
      ) {
        if (options.stopRequested?.() === true) return haltedCall()
        await sleep(retryDelayMs(attempt))
        continue
      }
      return last
    }
    const { status, body } = response
    const kind = documentKind(body)
    if (status === 200 && kind === 'empty') {
      last = failedCall(
        'empty',
        'The search service returned an empty response, also on the retry.',
        null,
        redact(body, secrets)
      )
      if (attempt < SERP_SEARCH_ATTEMPTS) {
        if (options.stopRequested?.() === true) return haltedCall()
        await sleep(retryDelayMs(attempt))
        continue
      }
      return last
    }
    const interpreted = interpretSearch(status, body, secrets, followUp)
    const raw = redact(body, secrets)
    if (interpreted.failure === null) pacer.succeeded()
    if (interpreted.expired) return { ...failedCall('other', '', null, raw), outcome: 'expired' }
    if (interpreted.failure !== null) {
      const code = interpreted.failure.code
      const retryAfterMs =
        code === 'rate_limited'
          ? parseRetryAfter(headerValue(response.headers, 'retry-after'), now())
          : null
      last = {
        ...failedCall(code, interpreted.failure.message, nextFor(code), raw),
        retryAfterMs
      }
      if (code === 'rate_limited') {
        // Slow every worker down and send this search again; only a Retry-After too long
        // to wait for, or the sixth refusal, ends it.
        const verdict = pacer.rateLimited(ticket, retryAfterMs)
        rateLimitedTries += 1
        if (!verdict.giveUp && rateLimitedTries < RATE_LIMIT_ATTEMPTS) {
          if (options.stopRequested?.() === true) return haltedCall()
          afterRateLimit = true
          attempt -= 1
          continue
        }
        return {
          ...last,
          message: RATE_LIMITED_MESSAGE,
          nextStep: null,
          retryAfterMs: verdict.giveUp ? retryAfterMs : null
        }
      }
      // A rejected key or an account out of searches never recovers by waiting, whatever
      // the HTTP status (SerpApi can send a 429 for both). An empty call is retried (FR-5.5).
      // Otherwise the paid-call rule: a 429 is retried, a 408 or 5xx never is.
      const retry =
        code === 'empty' ||
        (mayRetryPaidCall({ kind: 'status', status }) &&
          code !== 'rejected' &&
          code !== 'out_of_searches')
      // A Retry-After past the retry cap goes to the next key instead of stalling here.
      const tooLong = retryAfterMs !== null && retryAfterMs > RETRY_DELAY_CAP_MS
      if (retry && !tooLong && attempt < SERP_SEARCH_ATTEMPTS) {
        if (options.stopRequested?.() === true) return haltedCall()
        await sleep(Math.max(retryDelayMs(attempt), retryAfterMs ?? 0))
        continue
      }
      return last
    }
    if (interpreted.pageToken !== null) {
      return {
        outcome: 'loaded',
        pageToken: interpreted.pageToken,
        hasAio: false,
        errorCode: null,
        message: null,
        nextStep: null,
        aioText: null,
        references: [],
        rawSearch: raw,
        retryAfterMs: null
      }
    }
    return {
      outcome: 'loaded',
      pageToken: null,
      hasAio: interpreted.overview !== null,
      errorCode: null,
      message: null,
      nextStep: null,
      aioText: interpreted.overview?.text ?? null,
      references: [...(interpreted.overview?.references ?? [])],
      rawSearch: raw,
      retryAfterMs: null
    }
  }
  return last
}

async function admitted(options: CaptureOptions): Promise<boolean> {
  if (options.beforeRequest === undefined) return true
  return options.beforeRequest()
}

function haltedCall(): CallBody {
  return {
    outcome: 'halted',
    pageToken: null,
    hasAio: false,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: null,
    references: [],
    rawSearch: null,
    retryAfterMs: null
  }
}

function stopped(
  searches: number,
  neededFollowup: boolean,
  rawSearch: string | null,
  rawAio: string | null
): SerpCapture {
  return {
    hasAio: false,
    neededFollowup,
    searches,
    halted: true,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: null,
    references: [],
    rawSearchJson: rawSearch,
    rawAioJson: rawAio,
    retryAfterMs: null
  }
}

function loaded(
  body: CallBody,
  searches: number,
  neededFollowup: boolean,
  rawSearch: string | null,
  rawAio: string | null
): SerpCapture {
  return {
    hasAio: body.hasAio,
    neededFollowup,
    searches,
    halted: false,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: body.hasAio ? body.aioText : null,
    references: body.hasAio ? body.references : [],
    rawSearchJson: rawSearch,
    rawAioJson: rawAio,
    retryAfterMs: null
  }
}

function failed(
  body: CallBody,
  searches: number,
  neededFollowup: boolean,
  rawSearch: string | null,
  rawAio: string | null
): SerpCapture {
  return {
    hasAio: false,
    neededFollowup,
    searches,
    halted: false,
    errorCode: body.errorCode ?? 'other',
    message: body.message,
    nextStep: body.nextStep,
    aioText: null,
    references: [],
    rawSearchJson: rawSearch,
    rawAioJson: rawAio,
    retryAfterMs: body.retryAfterMs
  }
}

function failedCall(
  code: CheckErrorCode,
  message: string,
  nextStep: string | null,
  raw: string | null = null
): CallBody {
  return {
    outcome: 'failure',
    pageToken: null,
    hasAio: false,
    errorCode: code,
    message,
    nextStep,
    aioText: null,
    references: [],
    rawSearch: raw,
    retryAfterMs: null
  }
}

function nextFor(code: CheckErrorCode): string | null {
  if (code === 'timeout') return 'Check the network and try again.'
  // A rate limit is about the plan, not the key: the message says what to do.
  if (code === 'rejected' || code === 'out_of_searches') {
    return 'Open Connections and check this SerpApi key.'
  }
  return null
}

function searchUrl(secret: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(SERPAPI_SEARCH_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  url.searchParams.set('api_key', secret)
  return url.href
}

function documentKind(body: string): 'empty' | 'serp' | 'other' {
  if (body.trim().length === 0) return 'empty'
  try {
    const parsed = JSON.parse(body) as unknown
    if (!isRecord(parsed)) return 'other'
    if (
      parsed.search_metadata !== undefined ||
      parsed.ai_overview !== undefined ||
      typeof parsed.error === 'string'
    ) {
      return 'serp'
    }
    return 'empty'
  } catch {
    return 'other'
  }
}

function redact(body: string, secrets: readonly string[]): string {
  return redactSerpBody(body, secrets)
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) return undefined
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name)
  return match === undefined ? undefined : headers[match]
}
