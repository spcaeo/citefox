import {
  CLORO_CREDITS,
  type AnswerEngineId,
  type CheckErrorCode,
  type EngineId
} from '@shared/domain'
import { ProviderTimeoutError } from '../../providers/errors'
import { CITEFOX_USER_AGENT, type HttpResponse, type HttpTransport } from '../../providers/http'
import { parseRetryAfter, RETRY_DELAY_CAP_MS, retryDelayMs } from '../../providers/retry'
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

/**
 * HTTP attempts per cloro call. A second try is made only after a failure cloro does not
 * bill (a 429 or a 5xx). A timeout is never tried again: cloro keeps running a call whose
 * connection closed and bills it if it succeeds (the paid-call rule in providers/retry).
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
  retryAfterMs: number | null
}

async function callCloro(engine: EngineId, options: CloroCaptureOptions): Promise<CallOutcome> {
  const secrets = options.secrets ?? [options.secret]
  const sleep = options.sleep ?? (async () => undefined)
  const timeoutMs = options.timeoutMs ?? CLORO_TIMEOUT_MS
  const now = options.now ?? Date.now
  const query: CloroQuery = {
    q: options.query.q,
    gl: options.query.gl,
    hl: options.query.hl,
    location: options.query.location,
    device: options.query.device
  }
  let searches = 0
  let last: CallOutcome = {
    kind: 'failure',
    searches: 0,
    credits: 0,
    body: null,
    failure: {
      code: 'other',
      message: 'The search service did not answer this call.',
      retryable: false
    },
    timedOut: false,
    retryAfterMs: null
  }
  for (let attempt = 1; attempt <= CLORO_ATTEMPTS; attempt += 1) {
    // A cancel or cap stop before a retry is a halt, never an error sample (as SerpApi).
    if (options.beforeRequest !== undefined && !(await options.beforeRequest())) {
      return { ...last, kind: 'halted', searches, failure: null }
    }
    searches += 1
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
        kind: 'failure',
        searches,
        credits: 0,
        body: null,
        failure: {
          code: 'other',
          message: timeout
            ? 'The cloro call timed out. cloro may still charge it.'
            : 'CiteFox could not reach cloro.',
          retryable: false
        },
        timedOut: timeout,
        retryAfterMs: null
      }
    }
    const body = redactSerpBody(response.body, secrets)
    const failure = readCloroFailure(engine, response.status, response.body)
    if (failure === null) {
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
    const retryAfterMs = parseRetryAfter(headerValue(response.headers, 'retry-after'), now())
    last = {
      kind: 'failure',
      searches,
      // A failed call is not billed; a charge header on one is still believed.
      credits: creditsCharged(response.headers) ?? 0,
      body,
      failure,
      timedOut: false,
      retryAfterMs
    }
    const tooLong = retryAfterMs !== null && retryAfterMs > RETRY_DELAY_CAP_MS
    if (!failure.retryable || tooLong || attempt === CLORO_ATTEMPTS) return last
    if (options.stopRequested?.() === true) return { ...last, kind: 'halted', failure: null }
    await sleep(Math.max(retryDelayMs(attempt), retryAfterMs ?? 0))
  }
  return last
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
  if (code === 'rejected' || code === 'out_of_searches' || code === 'rate_limited') {
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
