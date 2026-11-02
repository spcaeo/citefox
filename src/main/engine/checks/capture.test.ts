import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { HttpRequest, HttpResponse, HttpTransport } from '../../providers/http'
import { ProviderError, ProviderTimeoutError } from '../../providers/errors'
import { captureSerpApi, SERP_SEARCH_ATTEMPTS, SERP_TIMEOUT_MS } from './capture'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const SECRET = 'sk-test-secret-value'

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function json(status: number, body: unknown): HttpResponse {
  return { status, body: JSON.stringify(body) }
}

function scripted(respond: (request: HttpRequest) => HttpResponse | never): HttpTransport & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    async request(request) {
      calls.push(request.url)
      return respond(request)
    }
  }
}

const query = {
  q: 'How do I alert the crew?',
  gl: 'us',
  hl: 'en',
  location: null,
  device: 'desktop' as const
}

describe('captureSerpApi', () => {
  test('follows an AI Overview page token on the same key and stores redacted JSON', async () => {
    const http = scripted((request) => {
      const url = new URL(request.url)
      expect(url.searchParams.get('api_key')).toBe(SECRET)
      return url.searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    })
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      secrets: [SECRET],
      sleep: async () => undefined
    })
    expect(http.calls).toHaveLength(2)
    expect(new URL(http.calls[0] ?? '').searchParams.get('api_key')).toBe(
      new URL(http.calls[1] ?? '').searchParams.get('api_key')
    )
    expect(captured.neededFollowup).toBe(true)
    expect(captured.hasAio).toBe(true)
    expect(captured.searches).toBe(2)
    const raw = `${captured.rawSearchJson ?? ''}${captured.rawAioJson ?? ''}`
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('fixture-page-token')
    expect(raw).not.toContain('page_token')
  })

  test('drops api_key, key, and token from a body that already has overview content', async () => {
    const http = scripted(() => envelope('google-with-secret.json'))
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      secrets: [SECRET],
      sleep: async () => undefined
    })
    expect(http.calls).toHaveLength(1)
    expect(captured.neededFollowup).toBe(false)
    expect(captured.hasAio).toBe(true)
    const raw = captured.rawSearchJson ?? ''
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('super-secret-token')
    expect(raw).not.toContain('page_token')
    expect(raw).not.toContain('"api_key"')
  })

  test('treats a missing overview as no AI Overview and an empty body as an error', async () => {
    const quiet = scripted(() => envelope('google-no-aio.json'))
    const none = await captureSerpApi({
      transport: quiet,
      secret: SECRET,
      query,
      sleep: async () => undefined
    })
    expect(none.hasAio).toBe(false)
    expect(none.errorCode).toBeNull()
    const emptyHttp = scripted(() => envelope('google-empty.json'))
    const empty = await captureSerpApi({
      transport: emptyHttp,
      secret: SECRET,
      query,
      sleep: async () => undefined
    })
    expect(empty.errorCode).toBe('empty')
    expect(emptyHttp.calls).toHaveLength(2)
    expect(empty.searches).toBe(2)
    expect(empty.hasAio).toBe(false)
  })

  test('does not start a follow-up or a first search after the caller stops', async () => {
    let opens = 0
    const http = scripted((request) => {
      const url = new URL(request.url)
      return url.searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    })
    const stopped = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async () => undefined,
      beforeRequest: async () => {
        opens += 1
        return opens === 1
      }
    })
    expect(http.calls).toHaveLength(1)
    expect(new URL(http.calls[0] ?? '').searchParams.get('engine')).toBe('google')
    expect(stopped.halted).toBe(true)
    expect(stopped.searches).toBe(1)
    expect(stopped.neededFollowup).toBe(true)
    expect(stopped.rawAioJson).toBeNull()
    const blocked = scripted(() => envelope('google-no-aio.json'))
    const none = await captureSerpApi({
      transport: blocked,
      secret: SECRET,
      query,
      sleep: async () => undefined,
      beforeRequest: async () => false
    })
    expect(blocked.calls).toEqual([])
    expect(none.halted).toBe(true)
    expect(none.searches).toBe(0)
  })

  test('counts timeout attempts and does not call the network itself', async () => {
    const http = scripted(() => {
      throw new ProviderTimeoutError('SerpApi search', 5)
    })
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async () => undefined,
      timeoutMs: 20
    })
    expect(captured.errorCode).toBe('timeout')
    expect(captured.message).toBe('The SerpApi search timed out.')
    // Paid-call rule: a timeout after sending may already be billed (no_cache), so no retry.
    expect(http.calls).toHaveLength(1)
    expect(captured.searches).toBe(1)
  })

  test('a search waits 60 s before it times out; a request that never left is tried once more', async () => {
    expect(SERP_TIMEOUT_MS).toBe(60_000)
    expect(SERP_SEARCH_ATTEMPTS).toBe(2)
    const timeouts: (number | undefined)[] = []
    let calls = 0
    const http: HttpTransport & { calls: string[] } = {
      calls: [],
      async request(request) {
        http.calls.push(request.url)
        timeouts.push(request.timeoutMs)
        calls += 1
        if (calls === 1) {
          throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
        }
        return envelope('google-ai-overview.json')
      }
    }
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async () => undefined
    })
    expect(timeouts).toEqual([60_000, 60_000])
    expect(new URL(http.calls[0] ?? '').searchParams.get('no_cache')).toBe('true')
    expect(captured).toMatchObject({ errorCode: null, hasAio: true, searches: 2 })
  })

  test('a refused connection is retried; a reset or unknown network error is not', async () => {
    const refused = new ProviderError('Network request failed', {
      code: 'network',
      state: 'warning',
      nextStep: null,
      notSent: true
    })
    let calls = 0
    const first = scripted(() => {
      calls += 1
      if (calls === 1) throw refused
      return envelope('google-ai-overview.json')
    })
    const ok = await captureSerpApi({
      transport: first,
      secret: SECRET,
      query,
      sleep: async () => undefined
    })
    expect(ok).toMatchObject({ errorCode: null, hasAio: true, searches: 2 })
    for (const error of [
      new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
      new Error('socket hang up')
    ]) {
      const http = scripted(() => {
        throw error
      })
      const captured = await captureSerpApi({
        transport: http,
        secret: SECRET,
        query,
        sleep: async () => undefined
      })
      expect(http.calls).toHaveLength(1)
      expect(captured).toMatchObject({ errorCode: 'other', searches: 1 })
    }
  })

  test('a 5xx or 408 after SerpApi accepted the search is never retried (it may be billed)', async () => {
    for (const status of [500, 502, 503, 504, 529, 408]) {
      const waits: number[] = []
      const http = scripted(() => json(status, { error: 'bad gateway' }))
      const captured = await captureSerpApi({
        transport: http,
        secret: SECRET,
        query,
        sleep: async (ms) => {
          waits.push(ms)
        }
      })
      expect(http.calls).toHaveLength(1)
      expect(waits).toEqual([])
      expect(captured).toMatchObject({ errorCode: 'other', searches: 1 })
    }
  })

  test('a page-token follow-up that times out costs 2 searches: no retry', async () => {
    const http = scripted((request) => {
      if (new URL(request.url).searchParams.get('engine') === 'google_ai_overview') {
        throw new ProviderTimeoutError('SerpApi search', 60_000)
      }
      return envelope('google-page-token.json')
    })
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async () => undefined
    })
    expect(captured).toMatchObject({ errorCode: 'timeout', neededFollowup: true, searches: 2 })
    expect(http.calls).toHaveLength(2)
  })

  test('an overview error from SerpApi is an error, never no AI Overview (FR-5.5)', async () => {
    const http = scripted(() =>
      json(200, {
        search_metadata: { status: 'Success' },
        ai_overview: { error: 'Google did not return an AI Overview for this search.' }
      })
    )
    const captured = await captureSerpApi({ transport: http, secret: SECRET, query })
    expect(captured.hasAio).toBe(false)
    expect(captured.errorCode).toBe('other')
    expect(captured.message).toBe('SerpApi could not load the AI Overview for this search.')
    expect(http.calls).toHaveLength(1)
  })

  test('an empty overview object is an error, not a cited-nothing overview', async () => {
    const http = scripted(() => json(200, { search_metadata: {}, ai_overview: {} }))
    const captured = await captureSerpApi({ transport: http, secret: SECRET, query })
    expect(captured.errorCode).toBe('empty')
    expect(captured.hasAio).toBe(false)
    expect(http.calls).toHaveLength(2)
    expect(captured.searches).toBe(2)
  })

  test('a page-token follow-up that returns no overview is an error, not no AIO', async () => {
    const http = scripted((request) =>
      new URL(request.url).searchParams.get('engine') === 'google_ai_overview'
        ? json(200, { search_metadata: { status: 'Success' } })
        : envelope('google-page-token.json')
    )
    const captured = await captureSerpApi({ transport: http, secret: SECRET, query })
    expect(captured.neededFollowup).toBe(true)
    expect(captured.searches).toBe(3)
    expect(http.calls.map((url) => new URL(url).searchParams.get('engine'))).toEqual([
      'google',
      'google_ai_overview',
      'google_ai_overview'
    ])
    expect(captured.hasAio).toBe(false)
    expect(captured.errorCode).toBe('empty')
    expect(captured.message).toBe('The AI Overview follow-up came back empty.')
  })

  test('list item titles and tables are part of the overview text', async () => {
    const http = scripted(() =>
      json(200, {
        search_metadata: {},
        ai_overview: {
          text_blocks: [
            { type: 'list', list: [{ title: 'TextBolt', snippet: 'sends alerts.' }] },
            { type: 'table', table: [['Plan', 'Price']] }
          ],
          references: [{ link: 'https://textbolt.com/', title: 'Home' }]
        }
      })
    )
    const captured = await captureSerpApi({ transport: http, secret: SECRET, query })
    expect(captured.hasAio).toBe(true)
    expect(captured.aioText).toBe('TextBolt sends alerts. Plan | Price')
  })

  test('a cancel between retries is halted, not an error sample', async () => {
    let opens = 0
    const http = scripted(() => envelope('google-rate-limited.json'))
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async () => undefined,
      beforeRequest: async () => {
        opens += 1
        return opens === 1
      }
    })
    expect(http.calls).toHaveLength(1)
    expect(captured.halted).toBe(true)
    expect(captured.errorCode).toBeNull()
    expect(captured.searches).toBe(1)
    let stop = false
    const second = scripted(() => {
      stop = true
      return envelope('google-rate-limited.json')
    })
    const stopped = await captureSerpApi({
      transport: second,
      secret: SECRET,
      query,
      sleep: async () => undefined,
      stopRequested: () => stop
    })
    expect(second.calls).toHaveLength(1)
    expect(stopped).toMatchObject({ halted: true, errorCode: null, searches: 1 })
  })

  test('a 429 that says the account ran out of searches is not retried', async () => {
    const waits: number[] = []
    const http = scripted(() => envelope('google-out-of-searches-429.json'))
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async (ms) => {
        waits.push(ms)
      }
    })
    expect(http.calls).toHaveLength(1)
    expect(waits).toEqual([])
    expect(captured).toMatchObject({ errorCode: 'out_of_searches', searches: 1 })
  })

  test('a rate limit waits at least Retry-After before the next attempt', async () => {
    const waits: number[] = []
    let calls = 0
    const http = scripted(() => {
      calls += 1
      if (calls === 1) {
        return { ...envelope('google-rate-limited.json'), headers: { 'Retry-After': '2' } }
      }
      return envelope('google-ai-overview.json')
    })
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async (ms) => {
        waits.push(ms)
      }
    })
    expect(waits).toEqual([2000])
    expect(captured).toMatchObject({ errorCode: null, hasAio: true, searches: 2 })
  })

  test('a Retry-After longer than the retry cap stops retrying this key at once', async () => {
    const waits: number[] = []
    const http = scripted(() => ({
      ...envelope('google-rate-limited.json'),
      headers: { 'retry-after': '120' }
    }))
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async (ms) => {
        waits.push(ms)
      }
    })
    expect(http.calls).toHaveLength(1)
    expect(waits).toEqual([])
    expect(captured).toMatchObject({
      errorCode: 'rate_limited',
      searches: 1,
      retryAfterMs: 120_000
    })
  })

  test('a rate limit without Retry-After backs off exponentially', async () => {
    const waits: number[] = []
    const http = scripted(() => envelope('google-rate-limited.json'))
    const captured = await captureSerpApi({
      transport: http,
      secret: SECRET,
      query,
      sleep: async (ms) => {
        waits.push(ms)
      }
    })
    expect(waits).toEqual([200])
    expect(captured).toMatchObject({ errorCode: 'rate_limited', searches: 2, retryAfterMs: null })
  })
})
