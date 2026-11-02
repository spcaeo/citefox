import { createServer, type AddressInfo } from 'node:net'
import { describe, expect, test } from 'vitest'
import { ProviderError, ProviderTimeoutError, wrapProviderError } from './errors'
import { createFetchHttpTransport } from './http'
import { mayRetryPaidCall, requestNotSent } from './retry'

describe('paid-call rule', () => {
  test('only a request that never left, or a 429, may be tried again', () => {
    expect(mayRetryPaidCall({ kind: 'not_sent' })).toBe(true)
    expect(mayRetryPaidCall({ kind: 'status', status: 429 })).toBe(true)
    expect(mayRetryPaidCall({ kind: 'sent' })).toBe(false)
    for (const status of [408, 500, 502, 503, 504, 529, 400, 401, 403, 404, 200]) {
      expect(mayRetryPaidCall({ kind: 'status', status })).toBe(false)
    }
  })

  test('DNS and refused connections are not sent; resets, timeouts and unknowns are', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']) {
      expect(requestNotSent(new TypeError('fetch failed', { cause: { code } }))).toBe(true)
    }
    expect(requestNotSent({ code: 'ECONNREFUSED' })).toBe(true)
    expect(requestNotSent(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))).toBe(
      false
    )
    expect(requestNotSent(new TypeError('fetch failed', { cause: { code: 'EPIPE' } }))).toBe(false)
    expect(requestNotSent(new Error('socket hang up'))).toBe(false)
    expect(requestNotSent(new ProviderTimeoutError('SerpApi search', 60_000))).toBe(false)
    expect(requestNotSent(null)).toBe(false)
    expect(requestNotSent('ECONNREFUSED')).toBe(false)
  })

  test('several addresses count as not sent only when every one failed to connect', () => {
    const all = new TypeError('fetch failed', {
      cause: new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }])
    })
    const mixed = new TypeError('fetch failed', {
      cause: new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ECONNRESET' }])
    })
    expect(requestNotSent(all)).toBe(true)
    expect(requestNotSent(mixed)).toBe(false)
  })

  test('a ProviderError carries notSent through wrapping', () => {
    const error = new ProviderError('Network request failed', {
      code: 'network',
      state: 'warning',
      nextStep: null,
      notSent: true
    })
    expect(requestNotSent(error)).toBe(true)
    expect(wrapProviderError(error, []).notSent).toBe(true)
    expect(
      new ProviderError('x', { code: 'network', state: 'warning', nextStep: null }).notSent
    ).toBe(false)
  })

  test('the fetch transport marks a refused connection as not sent', async () => {
    // A loopback port that was just free: nothing listens there now. No outside network.
    const server = createServer()
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    await new Promise<void>((done) => server.close(() => done()))
    const transport = createFetchHttpTransport()
    const failure = await transport
      .request({ method: 'GET', url: `http://127.0.0.1:${port}/`, timeoutMs: 2000 })
      .then(
        () => null,
        (error: unknown) => error
      )
    expect(failure).toBeInstanceOf(ProviderError)
    expect((failure as ProviderError).notSent).toBe(true)
  })
})
