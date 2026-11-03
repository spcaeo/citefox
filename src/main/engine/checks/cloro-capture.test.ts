import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CLORO_CREDITS } from '@shared/domain'
import { ProviderTimeoutError } from '../../providers/errors'
import type { HttpRequest, HttpResponse, HttpTransport } from '../../providers/http'
import type { CaptureQuery } from './capture'
import {
  CLORO_ATTEMPTS,
  captureCloroAnswer,
  captureCloroGoogle,
  type CloroCaptureOptions
} from './cloro-capture'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/cloro')
const KEY = 'cloro-test-key-0000'

const query: CaptureQuery = {
  q: 'Does AT&T still support email to text?',
  gl: 'uk',
  hl: 'en',
  location: null,
  device: 'desktop'
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

function respond(status: number, body: string, headers?: Record<string, string>): HttpResponse {
  return headers === undefined ? { status, body } : { status, body, headers }
}

function errorBody(code: string): string {
  return JSON.stringify({ success: false, error: { code, message: 'cloro error' } })
}

type Script = (request: HttpRequest, attempt: number) => HttpResponse | Promise<HttpResponse>

function scripted(script: Script, events: string[] = []): HttpTransport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = []
  return {
    calls,
    async request(request) {
      calls.push(request)
      events.push('request')
      return script(request, calls.length)
    }
  }
}

/** A queue of responses, the last one repeated. */
function sequence(...responses: HttpResponse[]): Script {
  return (_request, attempt) => {
    const response = responses[Math.min(attempt, responses.length) - 1]
    if (response === undefined) throw new Error('no response scripted')
    return response
  }
}

function options(
  transport: HttpTransport,
  extra: Partial<CloroCaptureOptions> = {}
): CloroCaptureOptions & { sleeps: number[] } {
  const sleeps: number[] = []
  return {
    transport,
    secret: KEY,
    query,
    secrets: [KEY],
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    now: () => Date.parse('2026-10-24T12:00:00Z'),
    sleeps,
    ...extra
  }
}

describe('captureCloroGoogle', () => {
  test('posts the Google body with a Bearer key and reads the recorded overview', async () => {
    const transport = scripted(() =>
      respond(200, fixture('google-overview.json'), { 'X-Credits-Charged': '7' })
    )
    const captured = await captureCloroGoogle(options(transport))
    expect(transport.calls).toHaveLength(1)
    const [call] = transport.calls
    expect(call?.method).toBe('POST')
    expect(call?.url).toBe('https://api.cloro.dev/v1/monitor/google')
    expect(call?.headers?.authorization).toBe(`Bearer ${KEY}`)
    expect(call?.headers?.['content-type']).toBe('application/json')
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      query: query.q,
      country: 'GB',
      hl: 'en',
      device: 'desktop',
      include: { aioverview: { markdown: true } }
    })
    expect(captured).toMatchObject({
      hasAio: true,
      neededFollowup: false,
      searches: 1,
      halted: false,
      errorCode: null,
      message: null,
      credits: 7,
      provider: 'cloro'
    })
    expect(captured.aioText).toMatch(/^Yes, AT&T permanently shut down/)
    expect(captured.references).toHaveLength(5)
    expect(captured.markdown).toContain('**June 17, 2025**')
    expect(captured.extras?.organic).toHaveLength(8)
    expect(captured.rawSearchJson).not.toBeNull()
  })

  test('no AI Overview is a normal result, and a missing charge header uses the price table', async () => {
    const transport = scripted(() => respond(200, fixture('google-no-overview.json')))
    const captured = await captureCloroGoogle(options(transport))
    expect(captured).toMatchObject({
      hasAio: false,
      errorCode: null,
      searches: 1,
      aioText: null,
      references: [],
      markdown: null,
      credits: CLORO_CREDITS.google_aio
    })
    expect(captured.extras?.organic).toHaveLength(9)
  })

  test('the stored body never holds the key', async () => {
    const echo = JSON.stringify({
      success: true,
      result: { aioverview: { text: `Echo ${KEY}`, sources: [] }, apiKey: KEY }
    })
    const transport = scripted(() => respond(200, echo, { 'x-credits-charged': '7' }))
    const captured = await captureCloroGoogle(options(transport))
    expect(captured.rawSearchJson).not.toContain(KEY)
  })

  test('a timeout is not retried and says cloro may still charge it', async () => {
    const transport = scripted(
      (request) =>
        new Promise<HttpResponse>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const opts = options(transport, { timeoutMs: 20 })
    const captured = await captureCloroGoogle(opts)
    expect(transport.calls).toHaveLength(1)
    expect(opts.sleeps).toEqual([])
    expect(captured).toMatchObject({
      searches: 1,
      halted: false,
      hasAio: false,
      errorCode: 'timeout',
      message: 'The cloro call timed out. cloro may still charge it.',
      nextStep: 'Check the network and try again.',
      credits: 0
    })
  })

  test('MODEL_UNAVAILABLE on Google is an error sample, not retried', async () => {
    const transport = scripted(() => respond(503, errorBody('MODEL_UNAVAILABLE')))
    const captured = await captureCloroGoogle(options(transport))
    expect(transport.calls).toHaveLength(1)
    expect(captured.errorCode).toBe('other')
    expect(captured.message).toContain('Google AI Overview is not available')
    expect(captured.credits).toBe(0)
  })

  test('a rate limit carries Retry-After and the Connections next step', async () => {
    const transport = scripted(() =>
      respond(429, errorBody('RATE_LIMITED'), { 'Retry-After': '3' })
    )
    const opts = options(transport)
    const captured = await captureCloroGoogle(opts)
    expect(transport.calls).toHaveLength(CLORO_ATTEMPTS)
    expect(opts.sleeps).toEqual([3000])
    expect(captured).toMatchObject({
      searches: 2,
      errorCode: 'rate_limited',
      message: 'Your CiteFox credits key is being limited right now.',
      nextStep: 'Open Connections and check your CiteFox credits key.',
      retryAfterMs: 3000,
      credits: 0
    })
  })
})

describe('cloro retry rules', () => {
  test('the gate is asked before every HTTP attempt', async () => {
    const events: string[] = []
    const transport = scripted(
      sequence(
        respond(429, errorBody('RATE_LIMITED')),
        respond(200, fixture('chatgpt.json'), { 'x-credits-charged': '7' })
      ),
      events
    )
    const opts = options(transport, {
      beforeRequest: async () => {
        events.push('gate')
        return true
      }
    })
    const captured = await captureCloroAnswer('chatgpt', opts)
    expect(events).toEqual(['gate', 'request', 'gate', 'request'])
    expect(captured.searches).toBe(2)
    expect(captured.outcome).toBe('answer')
    expect(captured.credits).toBe(7)
    expect(opts.sleeps).toEqual([200])
  })

  test('429 then success counts two searches and succeeds', async () => {
    const transport = scripted(
      sequence(
        respond(429, errorBody('RATE_LIMITED')),
        respond(200, fixture('google-overview.json'), { 'x-credits-charged': '7' })
      )
    )
    const captured = await captureCloroGoogle(options(transport))
    expect(transport.calls).toHaveLength(2)
    expect(captured).toMatchObject({ searches: 2, hasAio: true, errorCode: null, credits: 7 })
  })

  test('a 5xx is retried once, then the failure stands', async () => {
    const transport = scripted(() => respond(503, ''))
    const opts = options(transport)
    const captured = await captureCloroAnswer('gemini', opts)
    expect(transport.calls).toHaveLength(2)
    expect(opts.sleeps).toEqual([200])
    expect(captured).toMatchObject({
      outcome: 'error',
      searches: 2,
      errorCode: 'other',
      message: 'The search service could not answer this call.',
      nextStep: null,
      credits: 0
    })
  })

  test.each([
    [401, 'INVALID_API_KEY', 'rejected'],
    [403, 'FORBIDDEN', 'out_of_searches'],
    [402, 'INSUFFICIENT_CREDITS', 'out_of_searches'],
    [400, 'VALIDATION', 'other']
  ] as const)('%i %s is not retried', async (status, code, errorCode) => {
    const transport = scripted(() => respond(status, errorBody(code)))
    const opts = options(transport)
    const captured = await captureCloroAnswer('chatgpt', opts)
    expect(transport.calls).toHaveLength(1)
    expect(opts.sleeps).toEqual([])
    expect(captured).toMatchObject({ outcome: 'error', searches: 1, errorCode })
  })

  test('a timeout thrown by the transport is never retried', async () => {
    const transport = scripted(() => {
      throw new ProviderTimeoutError('cloro call', 300_000, [KEY])
    })
    const opts = options(transport)
    const captured = await captureCloroAnswer('chatgpt', opts)
    expect(transport.calls).toHaveLength(1)
    expect(opts.sleeps).toEqual([])
    expect(captured).toMatchObject({
      outcome: 'error',
      searches: 1,
      errorCode: 'timeout',
      message: 'The cloro call timed out. cloro may still charge it.',
      credits: 0
    })
  })

  test('a network error is not retried and does not mention charging', async () => {
    const transport = scripted(() => {
      throw new Error(`socket hang up ${KEY}`)
    })
    const captured = await captureCloroAnswer('copilot', options(transport))
    expect(transport.calls).toHaveLength(1)
    expect(captured).toMatchObject({
      outcome: 'error',
      errorCode: 'other',
      message: 'CiteFox could not reach cloro.'
    })
    expect(captured.message).not.toContain(KEY)
  })

  test('a Retry-After past the cap is not waited for', async () => {
    const transport = scripted(() =>
      respond(429, errorBody('RATE_LIMITED'), { 'retry-after': '60' })
    )
    const opts = options(transport)
    const captured = await captureCloroAnswer('chatgpt', opts)
    expect(transport.calls).toHaveLength(1)
    expect(opts.sleeps).toEqual([])
    expect(captured).toMatchObject({ searches: 1, errorCode: 'rate_limited', retryAfterMs: 60_000 })
  })

  test('a gate that refuses the first attempt halts with no call and no search', async () => {
    const transport = scripted(() => respond(200, fixture('chatgpt.json')))
    const captured = await captureCloroAnswer(
      'chatgpt',
      options(transport, { beforeRequest: async () => false })
    )
    expect(transport.calls).toHaveLength(0)
    expect(captured).toMatchObject({
      halted: true,
      searches: 0,
      credits: 0,
      errorCode: null,
      rawJson: null
    })
    const google = await captureCloroGoogle(
      options(transport, { beforeRequest: async () => false })
    )
    expect(transport.calls).toHaveLength(0)
    expect(google).toMatchObject({ halted: true, searches: 0, errorCode: null, credits: 0 })
  })

  test('stopRequested after a retryable failure starts no second call', async () => {
    const transport = scripted(() => respond(429, errorBody('RATE_LIMITED')))
    const opts = options(transport, { stopRequested: () => true })
    const captured = await captureCloroAnswer('chatgpt', opts)
    expect(transport.calls).toHaveLength(1)
    expect(opts.sleeps).toEqual([])
    expect(captured.searches).toBe(1)
  })

  test('a cancel between retries is a halt, not an error sample (as SerpApi)', async () => {
    const transport = scripted(() => respond(429, errorBody('RATE_LIMITED')))
    const captured = await captureCloroAnswer(
      'chatgpt',
      options(transport, { stopRequested: () => true })
    )
    expect(captured.halted).toBe(true)
  })

  test('a gate that refuses the retry is a halt, not an error sample (as SerpApi)', async () => {
    let asked = 0
    const transport = scripted(() => respond(503, ''))
    const captured = await captureCloroGoogle(
      options(transport, {
        beforeRequest: async () => {
          asked += 1
          return asked === 1
        }
      })
    )
    expect(transport.calls).toHaveLength(1)
    expect(captured.searches).toBe(1)
    expect(captured.halted).toBe(true)
  })
})

describe('captureCloroAnswer', () => {
  test('posts the answer body to the engine URL and reads the recorded ChatGPT answer', async () => {
    const transport = scripted(() =>
      respond(200, fixture('chatgpt.json'), { 'X-Credits-Charged': '7' })
    )
    const captured = await captureCloroAnswer('chatgpt', options(transport))
    const [call] = transport.calls
    expect(call?.url).toBe('https://api.cloro.dev/v1/monitor/chatgpt')
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      prompt: query.q,
      country: 'GB',
      include: { markdown: true }
    })
    expect(captured).toMatchObject({
      outcome: 'answer',
      searches: 1,
      halted: false,
      credits: 7,
      errorCode: null,
      message: null
    })
    expect(captured.text).toMatch(/^Yes\. AT&T discontinued/)
    expect(captured.markdown).not.toBeNull()
    expect(captured.sources).toHaveLength(5)
    expect(captured.rawJson).not.toBeNull()
  })

  test('credits come from X-Credits-Charged when sent', async () => {
    const transport = scripted(() =>
      respond(200, fixture('chatgpt.json'), { 'x-credits-charged': '5' })
    )
    const captured = await captureCloroAnswer('perplexity', options(transport))
    expect(captured.credits).toBe(5)
  })

  test('without X-Credits-Charged the engine price table is used', async () => {
    const transport = scripted(() => respond(200, fixture('chatgpt.json')))
    const perplexity = await captureCloroAnswer('perplexity', options(transport))
    const copilot = await captureCloroAnswer('copilot', options(transport))
    expect(perplexity.credits).toBe(CLORO_CREDITS.perplexity)
    expect(perplexity.credits).toBe(6)
    expect(copilot.credits).toBe(CLORO_CREDITS.copilot)
    expect(copilot.credits).toBe(7)
  })

  test('MODEL_UNAVAILABLE is unavailable, charged 0 whatever the header says, never retried', async () => {
    const transport = scripted(() =>
      respond(503, fixture('perplexity-unavailable.json'), { 'X-Credits-Charged': '6' })
    )
    const opts = options(transport)
    const captured = await captureCloroAnswer('perplexity', opts)
    expect(transport.calls).toHaveLength(1)
    expect(opts.sleeps).toEqual([])
    expect(captured).toMatchObject({
      outcome: 'unavailable',
      searches: 1,
      halted: false,
      credits: 0,
      errorCode: null,
      nextStep: null,
      text: null,
      sources: []
    })
    expect(captured.message).toBe(
      'Perplexity is not available right now. CiteFox tries again at the next check.'
    )
  })

  test('MODEL_UNAVAILABLE in a 200 envelope is unavailable too', async () => {
    const transport = scripted(() => respond(200, fixture('perplexity-unavailable.json')))
    const captured = await captureCloroAnswer('perplexity', options(transport))
    expect(captured).toMatchObject({ outcome: 'unavailable', credits: 0, searches: 1 })
  })

  test('a short reply with no sources is no_answer and still charged', async () => {
    const body = JSON.stringify({
      success: true,
      result: { text: 'I cannot help with that.', sources: [], markdown: null }
    })
    const transport = scripted(() => respond(200, body, { 'x-credits-charged': '6' }))
    const captured = await captureCloroAnswer('gemini', options(transport))
    expect(captured).toMatchObject({
      outcome: 'no_answer',
      credits: 6,
      text: 'I cannot help with that.',
      sources: []
    })
  })

  test('the stored answer body never holds the key', async () => {
    const body = JSON.stringify({ success: true, result: { text: `Echo ${KEY} `.repeat(30) } })
    const transport = scripted(() => respond(200, body))
    const captured = await captureCloroAnswer('chatgpt', options(transport))
    expect(captured.rawJson).not.toContain(KEY)
  })
})
