import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProviderError, ProviderTimeoutError } from './errors'
import {
  createFetchHttpTransport,
  endpointLabel,
  isTransientHttpStatus,
  requestWithRetry,
  type HttpTransport
} from './http'
import { parseRetryAfter, RETRY_DELAY_CAP_MS } from './retry'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('http transport', () => {
  test('drops the query string from endpoint labels', () => {
    expect(endpointLabel('https://serpapi.com/account.json?api_key=secret')).toBe(
      'https://serpapi.com/account.json'
    )
  })

  test('treats 408, 429, 5xx, and 529 as transient and leaves 401 alone', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      expect(isTransientHttpStatus(status)).toBe(true)
    }
    expect(isTransientHttpStatus(401)).toBe(false)
    expect(isTransientHttpStatus(400)).toBe(false)
    expect(isTransientHttpStatus(403)).toBe(false)
  })

  test('does not follow redirects and redacts keys in fetch errors', async () => {
    const seen: Array<{ redirect?: RequestRedirect }> = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seen.push({ redirect: init.redirect })
      return Promise.reject(new Error(`boom ${url}`))
    })
    const transport = createFetchHttpTransport()
    const error = await transport
      .request({
        method: 'GET',
        url: 'https://serpapi.com/account.json?api_key=secret-value',
        headers: { authorization: 'Bearer secret-value' },
        timeoutMs: 1_000
      })
      .then(() => {
        throw new Error('expected a failure')
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderError)
    const message = error instanceof ProviderError ? error.message : ''
    expect(message).toContain('https://serpapi.com/account.json')
    expect(message).toContain('api_key=[REDACTED]')
    expect(message).not.toContain('secret-value')
    expect(seen[0]?.redirect).toBe('manual')
  })

  test('turns an aborted fetch into a timeout without the query string', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(new Error('The operation was aborted'))
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('The operation was aborted'))
        })
      })
    })
    const transport = createFetchHttpTransport()
    const controller = new AbortController()
    controller.abort()
    const error = await transport
      .request({
        method: 'GET',
        url: 'https://r.jina.ai/https://example.com?key=secret-value',
        timeoutMs: 25,
        signal: controller.signal
      })
      .then(() => {
        throw new Error('expected a timeout')
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderTimeoutError)
    expect(error instanceof Error ? error.message : '').not.toContain('secret-value')
    expect(error instanceof Error ? error.message : '').not.toContain('?')
  })

  test('retries transient statuses and a timeout, then returns the last response', async () => {
    const delays: number[] = []
    const statuses = [503, 503, 200]
    const transport: HttpTransport = {
      async request() {
        const status = statuses.shift() ?? 200
        return { status, body: status === 200 ? '{"ok":true}' : '' }
      }
    }
    const response = await requestWithRetry(
      transport,
      { method: 'GET', url: 'https://example.test/status' },
      {
        timeoutMs: 1_000,
        label: 'Example',
        sleep: async (ms) => {
          delays.push(ms)
        }
      }
    )
    expect(response.status).toBe(200)
    expect(delays).toEqual([200, 400])

    let attempts = 0
    const timingOut: HttpTransport = {
      async request() {
        attempts += 1
        throw new ProviderTimeoutError('Example', 1_000)
      }
    }
    await expect(
      requestWithRetry(
        timingOut,
        { method: 'GET', url: 'https://example.test/slow' },
        {
          timeoutMs: 1_000,
          label: 'Example',
          sleep: async () => undefined
        }
      )
    ).rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(attempts).toBe(3)
  })

  test('honours Retry-After seconds and an HTTP-date, and caps a long wait', async () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')
    const delays: number[] = []
    const headers = ['2', 'Wed, 21 Oct 2015 07:28:05 GMT', '120']
    const transport: HttpTransport = {
      async request() {
        const retryAfter = headers.shift()
        const responseHeaders: Record<string, string> = {}
        if (retryAfter !== undefined) responseHeaders['Retry-After'] = retryAfter
        return { status: 429, body: '', headers: responseHeaders }
      }
    }
    const response = await requestWithRetry(
      transport,
      { method: 'GET', url: 'https://example.test/limited' },
      {
        timeoutMs: 1_000,
        label: 'Example',
        now: () => now,
        sleep: async (ms) => {
          delays.push(ms)
        }
      }
    )
    expect(response.status).toBe(429)
    expect(delays).toEqual([2_000, 5_000])
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(Math.min(parseRetryAfter('120', now) ?? 0, RETRY_DELAY_CAP_MS)).toBe(RETRY_DELAY_CAP_MS)

    const capped: number[] = []
    const longWait: HttpTransport = {
      async request() {
        return { status: 429, body: '', headers: { 'retry-after': '120' } }
      }
    }
    await requestWithRetry(
      longWait,
      { method: 'GET', url: 'https://example.test/limited' },
      {
        timeoutMs: 1_000,
        label: 'Example',
        sleep: async (ms) => {
          capped.push(ms)
        }
      }
    )
    expect(capped).toEqual([RETRY_DELAY_CAP_MS, RETRY_DELAY_CAP_MS])

    const fallback: number[] = []
    const invalid: HttpTransport = {
      async request() {
        return { status: 429, body: '', headers: { 'Retry-After': 'soon' } }
      }
    }
    await requestWithRetry(
      invalid,
      { method: 'GET', url: 'https://example.test/limited' },
      {
        timeoutMs: 1_000,
        label: 'Example',
        sleep: async (ms) => {
          fallback.push(ms)
        }
      }
    )
    expect(fallback).toEqual([200, 400])
    expect(parseRetryAfter('1.5', now)).toBe(1_500)
    expect(parseRetryAfter(undefined, now)).toBeNull()
  })

  test('reads Retry-After from a fetch response', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('limited', { status: 429, headers: { 'Retry-After': '2' } }))
    )
    const delays: number[] = []
    const response = await requestWithRetry(
      createFetchHttpTransport(),
      { method: 'GET', url: 'https://example.test/limited' },
      {
        timeoutMs: 1_000,
        label: 'Example',
        sleep: async (ms) => {
          delays.push(ms)
        }
      }
    )
    expect(response.status).toBe(429)
    expect(response.headers?.['retry-after']).toBe('2')
    expect(delays).toEqual([2_000, 2_000])
  })
})

describe('requestWithRetry limits', () => {
  test('attempts caps transient retries and retryTimeouts false fails a timeout at once', async () => {
    let busy = 0
    const unavailable: HttpTransport = {
      async request() {
        busy += 1
        return { status: 503, body: '' }
      }
    }
    const response = await requestWithRetry(
      unavailable,
      { method: 'POST', url: 'https://api.example/v1' },
      { timeoutMs: 1_000, label: 'post', attempts: 2, sleep: async () => undefined }
    )
    expect(response.status).toBe(503)
    expect(busy).toBe(2)

    let slow = 0
    const timingOut: HttpTransport = {
      async request() {
        slow += 1
        throw new ProviderTimeoutError('post', 1_000)
      }
    }
    await expect(
      requestWithRetry(
        timingOut,
        { method: 'POST', url: 'https://api.example/v1' },
        { timeoutMs: 1_000, label: 'post', retryTimeouts: false, sleep: async () => undefined }
      )
    ).rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(slow).toBe(1)
  })
})
