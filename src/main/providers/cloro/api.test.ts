import { describe, expect, test } from 'vitest'
import { ANSWER_ENGINE_IDS } from '@shared/domain'
import {
  CLORO_CREDITS_URL,
  cloroCountry,
  cloroEngineUrl,
  cloroRequestBody,
  creditsCharged,
  readCloroFailure,
  readCloroSources,
  type CloroQuery
} from './api'

const QUERY: CloroQuery = {
  q: 'Does AT&T still support email to text?',
  gl: 'us',
  hl: 'EN',
  location: 'Austin,Texas,United States',
  device: 'desktop'
}

function errorBody(code: string, message = 'Something went wrong.'): string {
  return JSON.stringify({ success: false, error: { code, message } })
}

const OK_BODY = JSON.stringify({ success: true, result: { text: 'An answer.' } })

describe('cloro endpoints', () => {
  test('each engine has its own sync monitor URL and credits is not billed', () => {
    expect(cloroEngineUrl('google_aio')).toBe('https://api.cloro.dev/v1/monitor/google')
    expect(cloroEngineUrl('chatgpt')).toBe('https://api.cloro.dev/v1/monitor/chatgpt')
    expect(cloroEngineUrl('perplexity')).toBe('https://api.cloro.dev/v1/monitor/perplexity')
    expect(cloroEngineUrl('google_ai_mode')).toBe('https://api.cloro.dev/v1/monitor/aimode')
    expect(cloroEngineUrl('gemini')).toBe('https://api.cloro.dev/v1/monitor/gemini')
    expect(cloroEngineUrl('copilot')).toBe('https://api.cloro.dev/v1/monitor/copilot')
    expect(CLORO_CREDITS_URL).toBe('https://api.cloro.dev/v1/credits')
  })
})

describe('cloroCountry', () => {
  test('uppercases and maps SerpApi UK to GB', () => {
    expect(cloroCountry('uk')).toBe('GB')
    expect(cloroCountry(' UK ')).toBe('GB')
    expect(cloroCountry('us')).toBe('US')
    expect(cloroCountry('gb')).toBe('GB')
    expect(cloroCountry('In')).toBe('IN')
  })
})

describe('cloroRequestBody', () => {
  test('Google sends query, country, hl, device, location and the AI Overview add-on', () => {
    expect(cloroRequestBody('google_aio', QUERY)).toEqual({
      query: QUERY.q,
      country: 'US',
      hl: 'en',
      device: 'desktop',
      location: 'Austin,Texas,United States',
      include: { aioverview: { markdown: true } }
    })
  })

  test('Google leaves location out when it is null or blank', () => {
    const none = cloroRequestBody('google_aio', { ...QUERY, location: null })
    const blank = cloroRequestBody('google_aio', { ...QUERY, location: '   ' })
    expect(none).not.toHaveProperty('location')
    expect(blank).not.toHaveProperty('location')
    expect(none).toMatchObject({ query: QUERY.q, country: 'US' })
  })

  test('Google maps UK to GB', () => {
    expect(cloroRequestBody('google_aio', { ...QUERY, gl: 'uk' })).toMatchObject({
      country: 'GB'
    })
  })

  test.each(ANSWER_ENGINE_IDS)('%s sends prompt, country and markdown only', (engine) => {
    const body = cloroRequestBody(engine, { ...QUERY, gl: 'uk' })
    expect(body).toEqual({ prompt: QUERY.q, country: 'GB', include: { markdown: true } })
    expect(body).not.toHaveProperty('query')
    expect(body).not.toHaveProperty('location')
    expect(body).not.toHaveProperty('device')
    expect(body).not.toHaveProperty('hl')
  })
})

describe('readCloroFailure', () => {
  test('a 200 with a result is not a failure', () => {
    expect(readCloroFailure('chatgpt', 200, OK_BODY)).toBeNull()
  })

  test('401 is a rejected key, never retried', () => {
    expect(readCloroFailure('chatgpt', 401, errorBody('INVALID_API_KEY'))).toEqual({
      code: 'rejected',
      message: 'Your CiteFox credits key was not accepted.',
      retryable: false
    })
    expect(readCloroFailure('chatgpt', 401, '')).toMatchObject({ code: 'rejected' })
  })

  test('an API_KEY error code is rejected whatever the status', () => {
    expect(readCloroFailure('google_aio', 400, errorBody('MISSING_API_KEY'))).toMatchObject({
      code: 'rejected',
      retryable: false
    })
  })

  test('403 and INSUFFICIENT_CREDITS are out of credits, never retried', () => {
    expect(readCloroFailure('chatgpt', 403, '')).toEqual({
      code: 'out_of_searches',
      message: 'Your CiteFox credits are used up.',
      retryable: false
    })
    expect(readCloroFailure('chatgpt', 402, errorBody('INSUFFICIENT_CREDITS'))).toMatchObject({
      code: 'out_of_searches',
      retryable: false
    })
  })

  test('429 is rate limited and may be retried', () => {
    expect(readCloroFailure('chatgpt', 429, errorBody('RATE_LIMITED'))).toEqual({
      code: 'rate_limited',
      message: 'Your CiteFox credits key is being limited right now.',
      retryable: true
    })
  })

  test.each([500, 502, 503, 504])('%i is not billed and may be retried', (status) => {
    expect(readCloroFailure('perplexity', status, '<html>bad gateway</html>')).toEqual({
      code: 'other',
      message: 'The search service could not answer this call.',
      retryable: true
    })
  })

  test('MODEL_UNAVAILABLE is unavailable and names the engine, even on a 5xx', () => {
    const failure = readCloroFailure('perplexity', 503, errorBody('MODEL_UNAVAILABLE'))
    expect(failure).toEqual({
      code: 'unavailable',
      message: 'Perplexity is not available right now. CiteFox tries again at the next check.',
      retryable: false
    })
  })

  test('"not available in this country" is unavailable too', () => {
    const failure = readCloroFailure(
      'copilot',
      400,
      errorBody('BAD_REQUEST', 'Copilot is Not Available In This Country.')
    )
    expect(failure).toMatchObject({ code: 'unavailable', retryable: false })
    expect(failure?.message).toContain('Copilot')
  })

  test('400 and other statuses are not retried', () => {
    expect(readCloroFailure('chatgpt', 400, errorBody('VALIDATION'))).toEqual({
      code: 'other',
      message: 'The search service did not accept this request.',
      retryable: false
    })
    expect(readCloroFailure('chatgpt', 418, '')).toEqual({
      code: 'other',
      message: 'The search service did not answer this call.',
      retryable: false
    })
  })

  test('a 200 that cannot be read or holds no result is a failure', () => {
    expect(readCloroFailure('chatgpt', 200, 'not json')).toMatchObject({
      code: 'empty',
      retryable: false
    })
    expect(readCloroFailure('chatgpt', 200, '')).toMatchObject({ code: 'empty' })
    expect(readCloroFailure('chatgpt', 200, JSON.stringify({ success: true }))).toMatchObject({
      code: 'other',
      retryable: false
    })
    expect(
      readCloroFailure('chatgpt', 200, JSON.stringify({ success: false, result: {} }))
    ).toMatchObject({ code: 'other' })
  })

  test('messages never echo the body', () => {
    const body = errorBody('INVALID_API_KEY', 'Key cloro-test-key-0000 is not valid')
    for (const status of [400, 401, 403, 429, 503]) {
      const failure = readCloroFailure('chatgpt', status, body)
      expect(failure?.message).not.toContain('cloro-test-key-0000')
    }
  })
})

describe('creditsCharged', () => {
  test('null when headers or the header are missing', () => {
    expect(creditsCharged(undefined)).toBeNull()
    expect(creditsCharged({})).toBeNull()
    expect(creditsCharged({ 'content-type': 'application/json' })).toBeNull()
  })

  test('reads a numeric string, any header case', () => {
    expect(creditsCharged({ 'x-credits-charged': '7' })).toBe(7)
    expect(creditsCharged({ 'X-Credits-Charged': '6' })).toBe(6)
    expect(creditsCharged({ 'X-CREDITS-CHARGED': ' 5 ' })).toBe(5)
    expect(creditsCharged({ 'x-credits-charged': '0' })).toBe(0)
    expect(creditsCharged({ 'x-credits-charged': '7.9' })).toBe(7)
  })

  test('null for a value that is not a usable count', () => {
    expect(creditsCharged({ 'x-credits-charged': 'seven' })).toBeNull()
    expect(creditsCharged({ 'x-credits-charged': '-1' })).toBeNull()
    expect(creditsCharged({ 'x-credits-charged': 'Infinity' })).toBeNull()
    expect(creditsCharged({ 'x-credits-charged': 'NaN' })).toBeNull()
  })

  test('null for an empty header, so the price table is used instead of 0', () => {
    expect(creditsCharged({ 'x-credits-charged': '' })).toBeNull()
    expect(creditsCharged({ 'x-credits-charged': '   ' })).toBeNull()
  })
})

describe('readCloroSources', () => {
  test('orders by position, renumbers 1..n and keeps labels', () => {
    const sources = [
      { position: 3, url: 'https://c.example/3', label: 'Third' },
      { position: 1, url: 'https://a.example/1', label: ' First ' },
      { position: 2, url: 'https://b.example/2' }
    ]
    expect(readCloroSources(sources, undefined)).toEqual([
      { position: 1, url: 'https://a.example/1', title: 'First' },
      { position: 2, url: 'https://b.example/2', title: null },
      { position: 3, url: 'https://c.example/3', title: 'Third' }
    ])
  })

  test('renumbers gaps and puts sources with no position last, in their order', () => {
    const sources = [
      { url: 'https://no-position.example/a', label: 'A' },
      { position: 10, url: 'https://ten.example/', label: 'Ten' },
      { url: 'https://no-position.example/b', label: 'B' },
      { position: 4, url: 'https://four.example/', label: 'Four' }
    ]
    expect(readCloroSources(sources, []).map((item) => [item.position, item.url])).toEqual([
      [1, 'https://four.example/'],
      [2, 'https://ten.example/'],
      [3, 'https://no-position.example/a'],
      [4, 'https://no-position.example/b']
    ])
  })

  test('adds citation pills whose URL is not already a source, after the sources', () => {
    const sources = [{ position: 1, url: 'https://a.example/1', label: 'A' }]
    const pills = [
      { url: 'https://a.example/1', label: 'A again' },
      { url: 'https://pill.example/x', label: 'Pill', position: 1 },
      { url: 'https://pill.example/x', label: 'Pill twice' }
    ]
    expect(readCloroSources(sources, pills)).toEqual([
      { position: 1, url: 'https://a.example/1', title: 'A' },
      { position: 2, url: 'https://pill.example/x', title: 'Pill' }
    ])
  })

  test('dedupes repeated source URLs and trims them', () => {
    const sources = [
      { position: 1, url: ' https://a.example/1 ', label: 'A' },
      { position: 2, url: 'https://a.example/1', label: 'A dup' },
      { position: 3, url: 'https://b.example/2', label: 'B' }
    ]
    expect(readCloroSources(sources, null).map((item) => [item.position, item.url])).toEqual([
      [1, 'https://a.example/1'],
      [2, 'https://b.example/2']
    ])
  })

  test('drops items that are not http(s) links, too long or not objects', () => {
    const sources = [
      null,
      'https://string.example/',
      { position: 1, url: 'javascript:alert(1)' },
      { position: 2, url: 'ftp://files.example/' },
      { position: 3, url: '' },
      { position: 4, url: `https://long.example/${'a'.repeat(2000)}` },
      { position: 5, url: 42 },
      { position: 6, url: 'HTTPS://ok.example/' }
    ]
    expect(readCloroSources(sources, 'pills')).toEqual([
      { position: 1, url: 'HTTPS://ok.example/', title: null }
    ])
  })

  test('non-array input gives no sources', () => {
    expect(readCloroSources(undefined, undefined)).toEqual([])
    expect(readCloroSources({ url: 'https://a.example/' }, null)).toEqual([])
  })
})
