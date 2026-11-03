import {
  CLORO_CREDITS,
  type AnswerEngineId,
  type CheckErrorCode,
  type EngineId
} from '@shared/domain'
import { ProviderTimeoutError } from '../../providers/errors'
import { CITEFOX_USER_AGENT, type HttpResponse, type HttpTransport } from '../../providers/http'
import { parseRetryAfter, retryDelayMs } from '../../providers/retry'
import {
  CLORO_TIMEOUT_MS,
  cloroEngineUrl,
  cloroRequestBody,
  creditsCharged,
  readCloroFailure,
  type CloroFailure,
  type CloroQuery,
  type CloroSource
} from '../../providers/cloro/api'
import { readCloroAnswer, readCloroGoogle } from '../../providers/cloro/read'
import { withTimeout } from '../../providers/timeout'
import type { CaptureQuery, SerpCapture } from './capture'
import { redactSerpBody } from './redact'
import type { Logger } from '../../logging/logger'
import { createCallPacer, RATE_LIMIT_ATTEMPTS, type CallPacer } from './provider-pacer'

/**
 * HTTP attempts per cloro call for a failure cloro does not bill and that waiting cannot
 * fix by itself (a 5xx): the first try and one more. A timeout is never tried again:
 * cloro keeps running a call whose connection closed and bills it if it succeeds (the
 * paid-call rule in providers/retry).
 */
export const CLORO_ATTEMPTS = 2

export interface CloroCaptureOptions {
  transport: HttpTransport
  secret: string
  query: CaptureQuery
  secrets?: readonly string[]
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Called before every HTTP attempt. False means that attempt must not start. */
  beforeRequest?: () => Promise<boolean>
  /** Checked before a retry wait, so a cancel does not start another call. */
  stopRequested?: () => boolean
  now?: () => number
  /**
   * The provider's shared pace (provider-pacer.ts): its cooldown and start gap apply to
   * every call, and a 429 is retried on it. Without one the call paces itself.
   */
  pacer?: CallPacer
  /** Gets one line when a call ends in a failure, so a tester's log shows why a check failed. */
  logger?: Pick<Logger, 'warn'>
}

interface CallOutcome {
  kind: 'ok' | 'failure' | 'halted'
  /** HTTP attempts sent. Each one counts toward the project's cap like a search. */
  searches: number
  credits: number
  body: string | null
  failure: CloroFailure | null
  /** A timeout: cloro may still finish and bill the call. */
  timedOut: boolean
  /** Retry-After of a 429 the call gave up on because it is too long to wait for. */
  retryAfterMs: number | null
}

function failedOutcome(searches: number, failure: CloroFailure): CallOutcome {
  return {
    kind: 'failure',
    searches,
    credits: 0,
    body: null,
    failure,
    timedOut: false,
    retryAfterMs: null
  }
}

/** One log line for a call that ended in a failure: no key, no answer text. */
function logGaveUp(
  options: CloroCaptureOptions,
  engine: EngineId,
  status: number,
  tries: number,
  outcome: CallOutcome
): CallOutcome {
  options.logger?.warn('search call failed', {
    provider: 'cloro',
    engine,
    status,
    reason: outcome.failure?.code ?? 'other',
    tries,
    retryAfterMs: outcome.retryAfterMs
  })
  return outcome
}

async function callCloro(engine: EngineId, options: CloroCaptureOptions): Promise<CallOutcome> {
  const secrets = options.secrets ?? [options.secret]
  const sleep = options.sleep ?? (async () => undefined)
  const timeoutMs = options.timeoutMs ?? CLORO_TIMEOUT_MS
  const now = options.now ?? Date.now
  const pacer = options.pacer ?? createCallPacer('cloro', { now, sleep })
  const query: CloroQuery = {
    q: options.query.q,
    gl: options.query.gl,
    hl: options.query.hl,
    location: options.query.location,
    device: options.query.device
  }
  let searches = 0
  let last: CallOutcome = failedOutcome(0, {
    code: 'other',
    message: 'The search service did not answer this call.',
    retryable: false
  })
  let rateLimitedTries = 0
  let otherTries = 0
  let afterRateLimit = false
  for (;;) {
    // Wait out the shared cooldown and the gap since the last call to cloro.
    const ticket = await pacer.begin(options.stopRequested)
    if (ticket === null) return { ...last, kind: 'halted', searches, failure: null }
    if (afterRateLimit) {
      // The same search again after a 429: not billed, so not counted or checked against
      // the cap a second time. A cancel still stops it.
      if (options.stopRequested?.() === true) {
        return { ...last, kind: 'halted', searches, failure: null }
      }
    } else {
      // A cancel or cap stop before a retry is a halt, never an error sample (as SerpApi).
      if (options.beforeRequest !== undefined && !(await options.beforeRequest())) {
        return { ...last, kind: 'halted', searches, failure: null }
      }
      searches += 1
    }
    afterRateLimit = false
    let response: HttpResponse
    try {
      response = await withTimeout(
        (signal) =>
          options.transport.request({
            method: 'POST',
            url: cloroEngineUrl(engine),
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              authorization: `Bearer ${options.secret}`,
              'user-agent': CITEFOX_USER_AGENT
            },
            body: JSON.stringify(cloroRequestBody(engine, query)),
            timeoutMs,
            signal
          }),
        timeoutMs,
        'cloro call',
        secrets
      )
    } catch (error) {
      const timeout = error instanceof ProviderTimeoutError
      return {
        ...failedOutcome(searches, {
          code: 'other',
          message: timeout
            ? 'The search took too long and was stopped. It may still use a credit. Try the check again.'
            : 'CiteFox could not reach the search service. Check the network and try again.',
          retryable: false
        }),
        timedOut: timeout
      }
    }
    const body = redactSerpBody(response.body, secrets)
    const failure = readCloroFailure(engine, response.status, response.body)
    if (failure === null) {
      pacer.succeeded()
      return {
        kind: 'ok',
        searches,
        credits: creditsCharged(response.headers) ?? CLORO_CREDITS[engine],
        body,
        failure: null,
        timedOut: false,
        retryAfterMs: null
      }
    }
    last = {
      kind: 'failure',
      searches,
      // A failed call is not billed; a charge header on one is still believed.
      credits: creditsCharged(response.headers) ?? 0,
      body,
      failure,
      timedOut: false,
      retryAfterMs: null
    }
    if (failure.code === 'rate_limited') {
      // Slow every worker down, then try this call again; only a Retry-After too long to
      // wait for, or the sixth refusal, ends it.
      const retryAfterMs = parseRetryAfter(headerValue(response.headers, 'retry-after'), now())
      const verdict = pacer.rateLimited(ticket, retryAfterMs)
      rateLimitedTries += 1
      if (verdict.giveUp) {
        return logGaveUp(options, engine, response.status, rateLimitedTries, {
          ...last,
          retryAfterMs
        })
      }
      if (rateLimitedTries >= RATE_LIMIT_ATTEMPTS) {
        return logGaveUp(options, engine, response.status, rateLimitedTries, last)
      }
      if (options.stopRequested?.() === true) return { ...last, kind: 'halted', failure: null }
      afterRateLimit = true
      continue
    }
    otherTries += 1
    if (!failure.retryable || otherTries >= CLORO_ATTEMPTS) {
      return logGaveUp(options, engine, response.status, otherTries, last)
    }
    if (options.stopRequested?.() === true) return { ...last, kind: 'halted', failure: null }
    await sleep(retryDelayMs(otherTries))
  }
}

/** A Google AI Overview capture through cloro: the SerpApi capture's shape, plus credits. */
export async function captureCloroGoogle(options: CloroCaptureOptions): Promise<SerpCapture> {
  const call = await callCloro('google_aio', options)
  const base: SerpCapture = {
    hasAio: false,
    neededFollowup: false,
    searches: call.searches,
    halted: call.kind === 'halted',
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: null,
    references: [],
    rawSearchJson: call.body,
    rawAioJson: null,
    retryAfterMs: null,
    credits: call.credits,
    provider: 'cloro'
  }
  if (call.kind === 'halted') return base
  if (call.kind === 'failure' || call.body === null) {
    const failure = call.failure
    return {
      ...base,
      errorCode: googleErrorCode(failure, call.timedOut),
      message: failure?.message ?? 'The search service did not answer this call.',
      nextStep: nextStepFor(failure, call.timedOut),
      retryAfterMs: failure?.code === 'rate_limited' ? call.retryAfterMs : null
    }
  }
  const read = readCloroGoogle(call.body)
  return {
    ...base,
    hasAio: read.overview !== null,
    aioText: read.overview?.text ?? null,
    references: read.overview?.references ?? [],
    markdown: read.markdown,
    extras: read.extras
  }
}

/**
 * One answer engine's reply. `answer` and `no_answer` are results; `unavailable` is the
 * engine being down at cloro; `error` is a failed call. Only a result is charged.
 */
export interface AnswerCapture {
  outcome: 'answer' | 'no_answer' | 'unavailable' | 'error'
  searches: number
  halted: boolean
  credits: number
  errorCode: CheckErrorCode | null
  message: string | null
  nextStep: string | null
  text: string | null
  markdown: string | null
  sources: readonly CloroSource[]
  rawJson: string | null
  retryAfterMs: number | null
}

export function emptyAnswer(): AnswerCapture {
  return {
    outcome: 'error',
    searches: 0,
    halted: false,
    credits: 0,
    errorCode: null,
    message: null,
    nextStep: null,
    text: null,
    markdown: null,
    sources: [],
    rawJson: null,
    retryAfterMs: null
  }
}

export async function captureCloroAnswer(
  engine: AnswerEngineId,
  options: CloroCaptureOptions
): Promise<AnswerCapture> {
  const call = await callCloro(engine, options)
  const base: AnswerCapture = {
    ...emptyAnswer(),
    searches: call.searches,
    halted: call.kind === 'halted',
    credits: call.credits,
    rawJson: call.body
  }
  if (call.kind === 'halted') return base
  if (call.kind === 'failure' || call.body === null) {
    const failure = call.failure
    if (failure?.code === 'unavailable') {
      // Not charged, whatever the header said: nothing was answered.
      return { ...base, outcome: 'unavailable', credits: 0, message: failure.message }
    }
    return {
      ...base,
      outcome: 'error',
      errorCode: googleErrorCode(failure, call.timedOut),
      message: failure?.message ?? 'The search service did not answer this call.',
      nextStep: nextStepFor(failure, call.timedOut),
      retryAfterMs: failure?.code === 'rate_limited' ? call.retryAfterMs : null
    }
  }
  const read = readCloroAnswer(call.body)
  return {
    ...base,
    outcome: read.empty ? 'no_answer' : 'answer',
    text: read.text,
    markdown: read.markdown,
    sources: read.sources
  }
}

function googleErrorCode(failure: CloroFailure | null, timedOut: boolean): CheckErrorCode {
  if (timedOut) return 'timeout'
  if (failure === null) return 'other'
  if (failure.code === 'unavailable') return 'other'
  return failure.code
}

function nextStepFor(failure: CloroFailure | null, timedOut: boolean): string | null {
  if (timedOut) return 'Check the network and try again.'
  const code = failure?.code
  // A rate limit is about the plan, not the key: the message says what to do.
  if (code === 'rejected' || code === 'out_of_searches') {
    return 'Open Connections and check your CiteFox credits key.'
  }
  return null
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) return undefined
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name)
  return match === undefined ? undefined : headers[match]
}
