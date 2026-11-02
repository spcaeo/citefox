import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Logger } from '../../logging/logger'
import { MemorySecretStore } from '../../secrets/secret-store'
import { ProviderTimeoutError } from '../errors'
import { createFileFixtureSource, createFixtureHttpTransport } from '../fixtures'
import type { HttpRequest, HttpResponse, HttpTransport } from '../http'
import { createJinaReaderClient, JINA_READER_PROBE_URL } from './reader'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
const REF = 'citefox.jina.key-1'
const SHORT_KEY = 'jina_abc'

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
  respond: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>
): HttpTransport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = []
  return {
    calls,
    async request(request) {
      calls.push(request)
      return respond(request)
    }
  }
}

describe('Jina Reader', () => {
  test('accepts the recorded ok fixture', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, 'jina_fake_key_not_real_0000')
    const transport = createFixtureHttpTransport(
      createFileFixtureSource(FIXTURES),
      () => 'jina/ok.json'
    )
    const result = await createJinaReaderClient({ transport, logger }).testKey(store, REF)
    expect(result).toEqual({
      state: 'ok',
      message: 'Key works. CiteFox will use the higher rate limits.',
      nextStep: null,
      reason: null
    })
  })

  test('maps a recorded 401 to warning', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, 'jina_fake_key_not_real_0000')
    const transport = createFixtureHttpTransport(
      createFileFixtureSource(FIXTURES),
      () => 'jina/401.json'
    )
    const result = await createJinaReaderClient({
      transport,
      logger,
      sleep: async () => {
        throw new Error('401 must not retry')
      }
    }).testKey(store, REF)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('rejected')
    expect(result.message).toContain('rejected')
  })

  test('maps 403, 429 after retries, a malformed body, and a network error', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, 'jina_fake_key_not_real_0000')
    const forbidden = scripted(() => ({ status: 403, body: JSON.stringify({ code: 403 }) }))
    const rejected = await createJinaReaderClient({
      transport: forbidden,
      logger,
      sleep: async () => {
        throw new Error('403 must not retry')
      }
    }).testKey(store, REF)
    expect(forbidden.calls).toHaveLength(1)
    expect(rejected.reason).toBe('rejected')

    const limited = scripted(() => ({ status: 429, body: JSON.stringify({ code: 429 }) }))
    const rateLimited = await createJinaReaderClient({
      transport: limited,
      logger,
      sleep: async () => undefined
    }).testKey(store, REF)
    expect(limited.calls).toHaveLength(3)
    expect(rateLimited.reason).toBe('rate_limited')

    const malformed = scripted(() => ({ status: 200, body: '   ' }))
    const unreadable = await createJinaReaderClient({ transport: malformed, logger }).testKey(
      store,
      REF
    )
    expect(unreadable.reason).toBe('other')

    const offline = scripted(() => {
      throw new Error('ECONNRESET')
    })
    const network = await createJinaReaderClient({ transport: offline, logger }).testKey(store, REF)
    expect(offline.calls).toHaveLength(1)
    expect(network.reason).toBe('other')
  })

  test('maps a timeout to warning', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, 'jina_fake_key_not_real_0000')
    let attempts = 0
    const transport: HttpTransport = {
      async request() {
        attempts += 1
        throw new ProviderTimeoutError('Jina Reader', 20_000)
      }
    }
    const result = await createJinaReaderClient({
      transport,
      logger,
      sleep: async () => undefined
    }).testKey(store, REF)
    expect(attempts).toBe(3)
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('timeout')
    expect(result.message).toMatch(/timed out/)
  })

  test('redacts a short key that matches no pattern', async () => {
    const { logger, lines } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, SHORT_KEY)
    const transport = scripted((request) => {
      expect(request.url).toBe(JINA_READER_PROBE_URL)
      expect(request.headers?.authorization).toBe(`Bearer ${SHORT_KEY}`)
      return { status: 200, body: `token ${SHORT_KEY}` }
    })
    const result = await createJinaReaderClient({ transport, logger }).testKey(store, REF)
    expect(result.state).toBe('ok')
    expect(result.reason).toBeNull()
    expect(lines.join('\n')).not.toContain(SHORT_KEY)
    expect(lines.join('\n')).toContain('[REDACTED]')
  })

  test('maps a missing keychain secret to warning', async () => {
    const { logger } = captureLogger()
    const transport = scripted(() => {
      throw new Error('should not request')
    })
    const result = await createJinaReaderClient({ transport, logger }).testKey(
      new MemorySecretStore(),
      REF
    )
    expect(result.state).toBe('warning')
    expect(result.reason).toBe('other')
    expect(result.message).toMatch(/keychain/)
    expect(transport.calls).toHaveLength(0)
  })
})
