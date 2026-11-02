import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Logger } from '../../logging/logger'
import { MemorySecretStore } from '../../secrets/secret-store'
import { ProviderTimeoutError } from '../errors'
import { ClaudeCallError } from './call-error'
import { createFileFixtureSource, createFixtureHttpTransport } from '../fixtures'
import type { HttpRequest, HttpResponse, HttpTransport } from '../http'
import {
  ANTHROPIC_COMPLETION_TIMEOUT_MS,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_WEB_SEARCH_TOOL,
  createAnthropicApiProvider,
  DEFAULT_ANTHROPIC_MODEL
} from './anthropic-api'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
const REF = 'citefox.anthropic.key-1'
const KEY = 'sk-ant-api03-FAKE000000000000000000'

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

function fromFixture(name: string): HttpResponse {
  const parsed = JSON.parse(createFileFixtureSource(FIXTURES).read(name)) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
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

describe('Anthropic API provider', () => {
  test('sends the key from the keychain and parses the recorded ok fixture', async () => {
    const { logger, lines } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => fromFixture('anthropic/messages-ok.json'))
    const provider = createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport,
      logger,
      model: null,
      clock: () => 50
    })
    const tested = await provider.testKey()
    expect(tested).toEqual({ state: 'ok', message: 'Key works.', nextStep: null, reason: null })
    const call = transport.calls[0]
    if (call === undefined) throw new Error('missing request')
    expect(call.url).toBe(ANTHROPIC_MESSAGES_URL)
    expect(call.headers?.['x-api-key']).toBe(KEY)
    const body = JSON.parse(call.body ?? '{}') as {
      model?: string
      max_tokens?: number
      messages?: Array<{ content?: string }>
    }
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(body.max_tokens).toBe(16)
    expect(body.messages?.[0]?.content).toBe('Reply with the single word ok.')
    expect(lines.join('\n')).not.toContain(KEY)
  })

  test('web search (batch 2 row 5) adds only the server web_search tool, for that call', async () => {
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => fromFixture('anthropic/messages-ok.json'))
    const provider = createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport,
      logger: captureLogger().logger
    })
    await provider.complete({ prompt: 'Who competes?', webSearch: true })
    await provider.complete({ prompt: 'Plain call' })
    const bodies = transport.calls.map(
      (call) => JSON.parse(call.body ?? '{}') as { tools?: unknown[] }
    )
    expect(bodies[0]?.tools).toEqual([ANTHROPIC_WEB_SEARCH_TOOL])
    expect(bodies[1]?.tools).toBeUndefined()
  })

  test('maps a recorded 401 to warning on the first attempt', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const transport = scripted(() => fromFixture('anthropic/messages-401.json'))
    const provider = createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport,
      logger,
      sleep: async () => {
        throw new Error('401 must not retry')
      }
    })
    await expect(provider.testKey()).resolves.toMatchObject({
      state: 'warning',
      reason: 'rejected',
      message: expect.stringMatching(/^Anthropic rejected this API key/) as unknown as string
    })
    expect(transport.calls).toHaveLength(1)
  })

  test('retries 429 and 529, then reports a rate limit without dropping earlier results', async () => {
    const { logger, lines } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const limited = scripted(() => fromFixture('anthropic/messages-429.json'))
    const provider = createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport: limited,
      logger,
      sleep: async () => undefined
    })
    const tested = await provider.testKey()
    expect(limited.calls).toHaveLength(2)
    expect(tested.state).toBe('warning')
    expect(tested.reason).toBe('rate_limited')
    expect(tested.message).toMatch(/Work already done is kept/)
    expect(tested.message).not.toContain(KEY)
    await expect(
      createAnthropicApiProvider({
        secretStore: store,
        keychainRef: REF,
        transport: createFixtureHttpTransport(
          createFileFixtureSource(FIXTURES),
          () => 'anthropic/messages-overloaded.json'
        ),
        logger,
        sleep: async () => undefined
      }).complete({ prompt: 'ping' })
    ).rejects.toMatchObject({ code: 'overloaded' })
    expect(lines.join('\n')).not.toContain(KEY)
  })

  test('retries once when the reply fails the schema', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    }
    const transport = scripted((_request, attempt) => ({
      status: 200,
      body: JSON.stringify({
        model: DEFAULT_ANTHROPIC_MODEL,
        content: [{ type: 'text', text: attempt === 1 ? 'nope' : '{"ok":true}' }],
        usage: { input_tokens: 3, output_tokens: 2 }
      })
    }))
    const completion = await createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport,
      logger
    }).complete({ prompt: 'Reply with JSON', schema })
    expect(transport.calls).toHaveLength(2)
    expect(transport.calls[1]?.body).toContain('failed validation')
    expect(completion.json).toEqual({ ok: true })
  })

  test('maps a timeout and a malformed body to warning', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    let attempts = 0
    const timingOut: HttpTransport = {
      async request() {
        attempts += 1
        throw new ProviderTimeoutError('Anthropic messages', 1_000, [KEY])
      }
    }
    const timed = await createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport: timingOut,
      logger,
      sleep: async () => undefined
    }).testKey()
    expect(attempts).toBe(1)
    expect(timed.state).toBe('warning')
    expect(timed.reason).toBe('timeout')
    expect(timed.message).not.toContain(KEY)

    const malformed = scripted(() => ({ status: 200, body: '{"content":[]}' }))
    const bad = await createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport: malformed,
      logger
    }).testKey()
    expect(malformed.calls).toHaveLength(1)
    expect(bad.state).toBe('warning')
    expect(bad.reason).toBe('other')
  })

  test('maps 403 and a network error', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const forbidden = scripted(() => ({
      status: 403,
      body: JSON.stringify({
        type: 'error',
        error: { type: 'permission_error', message: 'forbidden' }
      })
    }))
    const rejected = await createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport: forbidden,
      logger,
      sleep: async () => {
        throw new Error('403 must not retry')
      }
    }).testKey()
    expect(forbidden.calls).toHaveLength(1)
    expect(rejected.reason).toBe('rejected')

    const offline = scripted(() => {
      throw new Error('ECONNRESET')
    })
    const network = await createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport: offline,
      logger
    }).testKey()
    expect(offline.calls).toHaveLength(1)
    expect(network.reason).toBe('other')
  })

  test('maps a missing keychain secret to warning', async () => {
    const { logger } = captureLogger()
    const transport = scripted(() => {
      throw new Error('should not request')
    })
    const provider = createAnthropicApiProvider({
      secretStore: new MemorySecretStore(),
      keychainRef: REF,
      transport,
      logger
    })
    await expect(provider.testKey()).resolves.toMatchObject({
      state: 'warning',
      reason: 'other'
    })
    await expect(provider.complete({ prompt: 'ping' })).rejects.toMatchObject({
      code: 'missing_secret',
      state: 'warning'
    })
    expect(transport.calls).toHaveLength(0)
  })

  test('holds the third call until a slot frees', async () => {
    const { logger } = captureLogger()
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    const release: Array<() => void> = []
    let active = 0
    let max = 0
    const transport: HttpTransport = {
      request() {
        active += 1
        max = Math.max(max, active)
        return new Promise((resolve) => {
          release.push(() => {
            active -= 1
            resolve({
              status: 200,
              body: JSON.stringify({
                content: [{ type: 'text', text: 'ok' }],
                model: DEFAULT_ANTHROPIC_MODEL
              })
            })
          })
        })
      }
    }
    const provider = createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport,
      logger,
      timeoutMs: 5_000
    })
    const tasks = [0, 1, 2].map(() => provider.complete({ prompt: 'ping' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(2)
    const first = release[0]
    if (first === undefined) throw new Error('missing waiter')
    first()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(3)
    release[1]?.()
    release[2]?.()
    await Promise.all(tasks)
    expect(max).toBe(2)
  })
})

describe('Anthropic attempt budget', () => {
  const schema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
    required: ['ok']
  }

  function provider(transport: HttpTransport): ReturnType<typeof createAnthropicApiProvider> {
    const store = new MemorySecretStore()
    store.set(REF, KEY)
    return createAnthropicApiProvider({
      secretStore: store,
      keychainRef: REF,
      transport,
      logger: captureLogger().logger,
      sleep: async () => undefined
    })
  }

  test('waits a realistic time for a long structured reply', async () => {
    const transport = scripted(() => ({
      status: 200,
      body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })
    }))
    await provider(transport).complete({ prompt: 'ping' })
    expect(ANTHROPIC_COMPLETION_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000)
    expect(transport.calls[0]?.timeoutMs).toBe(ANTHROPIC_COMPLETION_TIMEOUT_MS)
  })

  test('does not resend a POST after a timeout, since it may have completed', async () => {
    let attempts = 0
    const timingOut: HttpTransport = {
      async request() {
        attempts += 1
        throw new ProviderTimeoutError('Anthropic messages', 1_000, [KEY])
      }
    }
    await expect(provider(timingOut).complete({ prompt: 'ping' })).rejects.toBeInstanceOf(
      ProviderTimeoutError
    )
    expect(attempts).toBe(1)
  })

  test('reports max_tokens as a cut-off reply and does not retry the same limit', async () => {
    const transport = scripted(() => ({
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: '{"ok":' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 8000 }
      })
    }))
    const error = await provider(transport)
      .complete({ prompt: 'ping', schema, maxTokens: 8000 })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect((error as Error).message).toMatch(/cut off/i)
    expect((error as Error).message).toContain('8000')
    expect(transport.calls).toHaveLength(1)
  })

  test('sums token usage across the schema retry', async () => {
    const transport = scripted((_request, attempt) => ({
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: attempt === 1 ? 'nope' : '{"ok":true}' }],
        usage:
          attempt === 1
            ? { input_tokens: 3, output_tokens: 2 }
            : { input_tokens: 4, output_tokens: 5 }
      })
    }))
    const completion = await provider(transport).complete({ prompt: 'ping', schema })
    expect(transport.calls).toHaveLength(2)
    expect(completion.inputTokens).toBe(7)
    expect(completion.outputTokens).toBe(7)
    expect(completion.usage.inputTokens).toBe(7)
  })

  test('a schema miss on the last attempt throws with the summed usage', async () => {
    const transport = scripted((_request, attempt) => ({
      status: 200,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'nope' }],
        usage: { input_tokens: attempt, output_tokens: 10 * attempt }
      })
    }))
    const error = await provider(transport)
      .complete({ prompt: 'ping', schema })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect(transport.calls).toHaveLength(2)
    expect(error).toBeInstanceOf(ClaudeCallError)
    expect(error).toMatchObject({ code: 'validation', resolvedModel: 'claude-sonnet-4-5' })
    expect((error as ClaudeCallError).usage).toMatchObject({ inputTokens: 3, outputTokens: 30 })
  })

  test('schemaAttempts 1 sends one request and reports attempts on success', async () => {
    const bad = scripted(() => ({
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'nope' }],
        usage: { input_tokens: 5, output_tokens: 1 }
      })
    }))
    await expect(
      provider(bad).complete({ prompt: 'ping', schema, schemaAttempts: 1 })
    ).rejects.toMatchObject({ code: 'validation', usage: { inputTokens: 5 } })
    expect(bad.calls).toHaveLength(1)

    const fixed = scripted((_request, attempt) => ({
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: attempt === 1 ? 'nope' : '{"ok":true}' }]
      })
    }))
    const completion = await provider(fixed).complete({ prompt: 'ping', schema })
    expect(completion.attempts).toBe(2)
  })

  test('a limit on the schema retry keeps the first reply usage and the limit code', async () => {
    const transport = scripted((_request, attempt) =>
      attempt === 1
        ? {
            status: 200,
            body: JSON.stringify({
              content: [{ type: 'text', text: 'nope' }],
              usage: { input_tokens: 9, output_tokens: 4 }
            })
          }
        : { status: 429, body: JSON.stringify({ error: { type: 'rate_limit_error' } }) }
    )
    const error = await provider(transport)
      .complete({ prompt: 'ping', schema })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect(error).toBeInstanceOf(ClaudeCallError)
    expect(error).toMatchObject({
      code: 'rate_limited',
      usage: { inputTokens: 9, outputTokens: 4 }
    })
  })

  test('a reply cut off at max_tokens carries its usage', async () => {
    const transport = scripted(() => ({
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: '{"ok":' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 8000 }
      })
    }))
    await expect(
      provider(transport).complete({ prompt: 'ping', schema, maxTokens: 8000 })
    ).rejects.toMatchObject({ code: 'malformed', usage: { inputTokens: 10, outputTokens: 8000 } })
  })

  test('two providers built for separate actions share one calls-at-once gate', async () => {
    const release: Array<() => void> = []
    let active = 0
    let max = 0
    const transport: HttpTransport = {
      request() {
        active += 1
        max = Math.max(max, active)
        return new Promise((resolve) => {
          release.push(() => {
            active -= 1
            resolve({
              status: 200,
              body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })
            })
          })
        })
      }
    }
    const first = provider(transport)
    const second = provider(transport)
    const tasks = [first, second, first, second].map((entry) => entry.complete({ prompt: 'ping' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(2)
    release[0]?.()
    release[1]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(4)
    release[2]?.()
    release[3]?.()
    await Promise.all(tasks)
    expect(max).toBe(2)
  })
})
