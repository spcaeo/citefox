import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Logger } from '../../logging/logger'
import { MemorySecretStore } from '../../secrets/secret-store'
import { ProviderTimeoutError } from '../errors'
import { createFileFixtureSource, createFixtureHttpTransport } from '../fixtures'
import type { HttpRequest, HttpResponse, HttpTransport } from '../http'
import {
  classifySerpApiAccount,
  createSerpApiAccountClient,
  interpretSerpApiAccount
} from './account'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
const KEY = 'b'.repeat(64)
const REF = 'citefox.serpapi.key-1'

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const write = (message: string, extra?: unknown): void => {
    lines.push(extra === undefined ? message : `${message} ${JSON.stringify(extra)}`)
  }
  return {
    lines,
    logger: { debug: write, info: write, warn: write, error: write }
  }
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

describe('SerpApi account', () => {
  test('reads plan and usage from the recorded ok fixture', async () => {
    const { logger, lines } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = createFixtureHttpTransport(
      createFileFixtureSource(FIXTURES),
      () => 'serpapi/account-ok.json'
    )
    const result = await createSerpApiAccountClient({ transport, logger, secrets: [KEY] }).testKey(
      store,
      REF
    )
    expect(result.state).toBe('ok')
    expect(result.reason).toBeNull()
    expect(result.usage).toEqual({ used: 38, planLimit: 250, plan: 'Developer' })
    expect(result.message).toContain('38 of 250')
    expect(lines.join('\n')).not.toContain(KEY)
    expect(lines.join('\n')).not.toContain('a'.repeat(64))
  })

  test('maps an invalid key to warning on the first attempt', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => {
      const source = createFileFixtureSource(FIXTURES)
      const body = source.read('serpapi/account-invalid-key.json')
      const parsed = JSON.parse(body) as { status: number; body: unknown }
      return { status: parsed.status, body: JSON.stringify(parsed.body) }
    })
    const result = await createSerpApiAccountClient({
      transport,
      logger,
      sleep: async () => {
        throw new Error('invalid key must not retry')
      }
    }).testKey(store, REF)
    expect(result).toMatchObject({ state: 'warning', usage: null, reason: 'rejected' })
    expect(result.message).toContain('rejected')
    expect(transport.calls).toHaveLength(1)
  })

  test('maps an exhausted plan to warning and still returns usage', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = createFixtureHttpTransport(
      createFileFixtureSource(FIXTURES),
      () => 'serpapi/account-out-of-searches.json'
    )
    const result = await createSerpApiAccountClient({ transport, logger }).testKey(store, REF)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('out_of_searches')
    expect(result.usage).toEqual({ used: 250, planLimit: 250, plan: 'Free' })
    expect(result.message).toContain('out of searches')
    expect(result.nextStep).not.toMatch(/free account/i)
  })

  test('retries 503 and then accepts 200', async () => {
    const delays: number[] = []
    const statuses = [503, 503, 200]
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => {
      const status = statuses.shift() ?? 200
      const body =
        status === 200
          ? JSON.stringify({
              this_month_usage: 1,
              searches_per_month: 100,
              plan_name: 'Developer',
              plan_searches_left: 99,
              total_searches_left: 99
            })
          : ''
      return { status, body }
    })
    const result = await createSerpApiAccountClient({
      transport,
      logger,
      sleep: async (ms) => {
        delays.push(ms)
      }
    }).testKey(store, REF)
    expect(delays).toEqual([200, 400])
    expect(transport.calls).toHaveLength(3)
    expect(result.state).toBe('ok')
    expect(result.reason).toBeNull()
    expect(result.usage?.used).toBe(1)
  })

  test('does not retry 401', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => ({ status: 401, body: JSON.stringify({ error: 'nope' }) }))
    const result = await createSerpApiAccountClient({
      transport,
      logger,
      sleep: async () => {
        throw new Error('401 must not retry')
      }
    }).testKey(store, REF)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('rejected')
    expect(transport.calls).toHaveLength(1)
  })

  test('maps 403, 429 after retries, a network error, and other failures', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const forbidden = scripted(() => ({
      status: 403,
      body: JSON.stringify({ error: 'Forbidden' })
    }))
    const rejected = await createSerpApiAccountClient({
      transport: forbidden,
      logger,
      sleep: async () => {
        throw new Error('403 must not retry')
      }
    }).testKey(store, REF)
    expect(forbidden.calls).toHaveLength(1)
    expect(rejected.reason).toBe('rejected')

    const limited = scripted(() => ({
      status: 429,
      body: JSON.stringify({ error: 'Too Many Requests' })
    }))
    const rateLimited = await createSerpApiAccountClient({
      transport: limited,
      logger,
      sleep: async () => undefined
    }).testKey(store, REF)
    expect(limited.calls).toHaveLength(3)
    expect(rateLimited.reason).toBe('rate_limited')

    const offline = scripted(() => {
      throw new Error('ECONNRESET')
    })
    const network = await createSerpApiAccountClient({ transport: offline, logger }).testKey(
      store,
      REF
    )
    expect(offline.calls).toHaveLength(1)
    expect(network.reason).toBe('other')
  })

  test('maps a timeout to warning after three attempts', async () => {
    const { logger, lines } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => {
      throw new ProviderTimeoutError('SerpApi account', 15_000, [KEY])
    })
    const result = await createSerpApiAccountClient({
      transport,
      logger,
      secrets: [KEY],
      sleep: async () => undefined
    }).testKey(store, REF)
    expect(transport.calls).toHaveLength(3)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('timeout')
    expect(result.message).toMatch(/timed out/)
    expect(result.message).not.toContain(KEY)
    expect(lines.join('\n')).not.toContain(KEY)
    const sent = transport.calls[0]
    expect(sent?.url).toContain(`api_key=${KEY}`)
  })

  test('maps a malformed body to warning', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => ({ status: 200, body: 'not-json' }))
    const result = await createSerpApiAccountClient({ transport, logger }).testKey(store, REF)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('other')
    expect(result.usage).toBeNull()
  })

  test('maps a missing keychain secret to warning without a request', async () => {
    const { logger } = captureLogger()
    const transport = scripted(() => {
      throw new Error('should not request')
    })
    const result = await createSerpApiAccountClient({ transport, logger }).testKey(
      new MemorySecretStore(),
      REF
    )
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('other')
    expect(result.message).toMatch(/keychain/)
    expect(transport.calls).toHaveLength(0)
  })

  test('leaves an untested key unchecked', () => {
    expect(
      classifySerpApiAccount({
        attempted: false,
        invalidKey: false,
        outOfSearches: false,
        httpStatus: null
      })
    ).toBe('unchecked')
    expect(
      classifySerpApiAccount({
        attempted: true,
        invalidKey: true,
        outOfSearches: false,
        httpStatus: 401
      })
    ).toBe('warning')
    expect(
      classifySerpApiAccount({
        attempted: true,
        invalidKey: false,
        outOfSearches: false,
        httpStatus: 403
      })
    ).toBe('warning')
    expect(
      interpretSerpApiAccount(429, JSON.stringify({ error: 'Too Many Requests' }), [])
    ).toMatchObject({ state: 'warning', reason: 'rate_limited' })
    expect(interpretSerpApiAccount(302, '{}', []).message).toMatch(/redirect/)
  })

  test('redacts a key echoed in the account body', async () => {
    const { logger, lines } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted((request) => ({
      status: 200,
      body: JSON.stringify({
        api_key: new URL(request.url).searchParams.get('api_key'),
        this_month_usage: 2,
        searches_per_month: 10,
        plan_name: 'Developer',
        plan_searches_left: 8,
        total_searches_left: 8
      })
    }))
    await createSerpApiAccountClient({ transport, logger, secrets: [KEY] }).testKey(store, REF)
    expect(lines.join('\n')).not.toContain(KEY)
    expect(lines.join('\n')).toContain('[REDACTED]')
  })
})
