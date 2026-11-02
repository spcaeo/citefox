import { describe, expect, test } from 'vitest'
import type { Logger } from '../../logging/logger'
import { MemorySecretStore, type SecretStore } from '../../secrets/secret-store'
import { ProviderTimeoutError } from '../errors'
import type { HttpRequest, HttpResponse, HttpTransport } from '../http'
import { createCloroAccountClient, interpretCloroCredits } from './account'

const KEY = 'cloro-test-key-0000'
const REF = 'citefox.cloro.key-1'

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const write = (message: string, extra?: unknown): void => {
    lines.push(extra === undefined ? message : `${message} ${JSON.stringify(extra)}`)
  }
  return { lines, logger: { debug: write, info: write, warn: write, error: write } }
}

function scripted(
  respond: (request: HttpRequest, attempt: number) => HttpResponse | Promise<HttpResponse>
): HttpTransport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = []
  return {
    calls,
    async request(request) {
      calls.push(request)
      return respond(request, calls.length)
    }
  }
}

function storeWithKey(): MemorySecretStore {
  const store = new MemorySecretStore()
  store.set(REF, KEY)
  return store
}

function credits(body: unknown, status = 200): () => HttpResponse {
  return () => ({ status, body: JSON.stringify(body) })
}

async function runTest(
  transport: HttpTransport,
  store: SecretStore = storeWithKey()
): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof createCloroAccountClient>['testKey']>>
  lines: string[]
}> {
  const { logger, lines } = captureLogger()
  const result = await createCloroAccountClient({
    transport,
    logger,
    sleep: async () => undefined
  }).testKey(store, REF)
  return { result, lines }
}

function expectNoKey(text: string): void {
  expect(text).not.toContain(KEY)
}

describe('cloro key test', () => {
  test('sends GET /v1/credits with the key as a Bearer header', async () => {
    const transport = scripted(credits({ remaining: 37_000, perCycle: 37_500 }))
    await runTest(transport)
    expect(transport.calls).toHaveLength(1)
    const [call] = transport.calls
    expect(call?.method).toBe('GET')
    expect(call?.url).toBe('https://api.cloro.dev/v1/credits')
    expect(call?.headers?.authorization).toBe(`Bearer ${KEY}`)
    expect(call?.url).not.toContain(KEY)
  })

  test('shows remaining of per-cycle credits when the key works', async () => {
    const transport = scripted(
      credits({ remaining: 36_993, perCycle: 37_500, cycleResetsAt: '2026-11-01T00:00:00Z' })
    )
    const { result, lines } = await runTest(transport)
    expect(result).toEqual({
      state: 'ok',
      message: 'Key works. 36,993 of 37,500 credits left this cycle.',
      nextStep: null,
      credits: { remaining: 36_993, perCycle: 37_500, resetsAt: '2026-11-01T00:00:00.000Z' },
      reason: null
    })
    expectNoKey(result.message)
    expectNoKey(lines.join('\n'))
    expect(lines.join('\n')).toContain('cloro key test finished')
  })

  test('shows only the remaining credits when there is no per-cycle figure', async () => {
    const transport = scripted(credits({ remaining: 1_250, perCycle: null, cycleResetsAt: 'soon' }))
    const { result } = await runTest(transport)
    expect(result.state).toBe('ok')
    expect(result.message).toBe('Key works. 1,250 credits left.')
    expect(result.credits).toEqual({ remaining: 1_250, perCycle: null, resetsAt: null })
  })

  test('remaining 0 is a warning: out of credits, balance still returned', async () => {
    const transport = scripted(credits({ remaining: 0, perCycle: 37_500 }))
    const { result } = await runTest(transport)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('out_of_searches')
    expect(result.message).toBe('This cloro key is out of credits.')
    expect(result.nextStep).toMatch(/top up/)
    expect(result.credits).toEqual({ remaining: 0, perCycle: 37_500, resetsAt: null })
  })

  test('401 is rejected and not retried', async () => {
    const transport = scripted(
      credits({ success: false, error: { code: 'INVALID_API_KEY', message: `bad ${KEY}` } }, 401)
    )
    const { result, lines } = await runTest(transport)
    expect(transport.calls).toHaveLength(1)
    expect(result).toMatchObject({ state: 'warning', reason: 'rejected', credits: null })
    expect(result.message).toBe('cloro rejected this key.')
    expectNoKey(result.message)
    expectNoKey(`${result.nextStep ?? ''}`)
    expectNoKey(lines.join('\n'))
  })

  test('429 is rate limited after the shared retries', async () => {
    const transport = scripted(credits({ success: false }, 429))
    const { result, lines } = await runTest(transport)
    expect(transport.calls).toHaveLength(3)
    expect(result).toMatchObject({ state: 'warning', reason: 'rate_limited', credits: null })
    expect(result.message).toBe('cloro is limiting this key.')
    expectNoKey(lines.join('\n'))
  })

  test('an unreadable 200 body is a warning with reason other', async () => {
    const transport = scripted(() => ({ status: 200, body: '<html>oops</html>' }))
    const { result } = await runTest(transport)
    expect(result).toMatchObject({ state: 'warning', reason: 'other', credits: null })
    expect(result.message).toBe('cloro returned a response CiteFox could not read.')
  })

  test('a 200 without a numeric remaining is unreadable', async () => {
    const transport = scripted(credits({ remaining: '100', perCycle: 200 }))
    const { result } = await runTest(transport)
    expect(result).toMatchObject({ state: 'warning', reason: 'other', credits: null })
  })

  test('a key missing from the keychain never calls cloro', async () => {
    const transport = scripted(credits({ remaining: 1 }))
    const { result } = await runTest(transport, new MemorySecretStore())
    expect(transport.calls).toHaveLength(0)
    expect(result).toEqual({
      state: 'warning',
      message: 'The cloro key is missing from the keychain.',
      nextStep: 'Add the key again. CiteFox reads it from the keychain.',
      credits: null,
      reason: 'other'
    })
  })

  test('a keychain read error is a warning, not a throw', async () => {
    const transport = scripted(credits({ remaining: 1 }))
    const broken: SecretStore = {
      get: () => {
        throw new Error('keychain locked')
      },
      set: () => undefined,
      delete: () => undefined
    }
    const { result } = await runTest(transport, broken)
    expect(transport.calls).toHaveLength(0)
    expect(result).toMatchObject({ state: 'warning', reason: 'other', credits: null })
  })

  test('a network error carrying the key is redacted in the message and the log', async () => {
    const transport = scripted(() => {
      throw new Error(`connect ECONNRESET Bearer ${KEY}`)
    })
    const { result, lines } = await runTest(transport)
    expect(result).toMatchObject({ state: 'warning', reason: 'other', credits: null })
    expectNoKey(result.message)
    expectNoKey(lines.join('\n'))
    expect(lines.join('\n')).toContain('cloro key test failed')
  })

  test('a timeout is a warning with reason timeout', async () => {
    const transport = scripted(() => {
      throw new ProviderTimeoutError('cloro credits', 15_000, [KEY])
    })
    const { result, lines } = await runTest(transport)
    expect(result).toMatchObject({ state: 'warning', reason: 'timeout', credits: null })
    expectNoKey(result.message)
    expectNoKey(lines.join('\n'))
  })
})

describe('interpretCloroCredits', () => {
  test('403 is rejected too', () => {
    expect(interpretCloroCredits(403, '{}')).toMatchObject({ state: 'warning', reason: 'rejected' })
  })

  test('a non-200 status without a known meaning says cloro did not answer', () => {
    expect(interpretCloroCredits(503, '')).toMatchObject({
      state: 'warning',
      reason: 'other',
      message: 'cloro did not answer the key test.'
    })
  })

  test('negative and fractional figures are clamped to whole numbers', () => {
    const result = interpretCloroCredits(200, JSON.stringify({ remaining: 12.7, perCycle: -5 }))
    expect(result.credits).toEqual({ remaining: 12, perCycle: 0, resetsAt: null })
  })
})
