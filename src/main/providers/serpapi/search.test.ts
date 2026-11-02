import { describe, expect, test } from 'vitest'
import { interpretSearch } from './search'

const SECRET = 'sk-test-secret-value'

function body(value: unknown): string {
  return JSON.stringify(value)
}

describe('interpretSearch', () => {
  test('reports out of searches whatever the HTTP status, including 429', () => {
    for (const status of [400, 429, 200]) {
      const read = interpretSearch(
        status,
        body({ error: 'Your account has run out of searches.' }),
        []
      )
      expect(read.failure).toEqual({
        code: 'out_of_searches',
        message: 'This key is out of searches for the month.'
      })
    }
    expect(interpretSearch(429, body({ error: 'Too Many Requests' }), []).failure?.code).toBe(
      'rate_limited'
    )
  })

  test('rejects an invalid key and keeps the key out of the message', () => {
    const read = interpretSearch(401, body({ error: `Invalid API key: ${SECRET}` }), [SECRET])
    expect(read.failure?.code).toBe('rejected')
    expect(JSON.stringify(read)).not.toContain(SECRET)
  })

  test('flags an expired page token for one fresh search pair (SERP-3)', () => {
    const read = interpretSearch(200, body({ error: 'The page token has expired.' }), [])
    expect(read).toMatchObject({ expired: true, failure: null })
  })

  test('separates no overview, a page token, content, an overview error, and an empty overview', () => {
    expect(interpretSearch(200, body({ search_metadata: {} }), [])).toMatchObject({
      failure: null,
      overview: null,
      pageToken: null
    })
    expect(interpretSearch(200, body({ ai_overview: { page_token: 'tok' } }), []).pageToken).toBe(
      'tok'
    )
    expect(
      interpretSearch(200, body({ ai_overview: { text_blocks: [{ snippet: 'Hi.' }] } }), [])
        .overview?.text
    ).toBe('Hi.')
    expect(
      interpretSearch(200, body({ ai_overview: { error: 'Could not load.' } }), []).failure?.code
    ).toBe('other')
    expect(interpretSearch(200, body({ ai_overview: {} }), []).failure?.code).toBe('empty')
  })

  test('a follow-up without an overview, or with another token, is an empty call', () => {
    expect(interpretSearch(200, body({ search_metadata: {} }), [], true).failure).toEqual({
      code: 'empty',
      message: 'The AI Overview follow-up came back empty.'
    })
    expect(
      interpretSearch(200, body({ ai_overview: { page_token: 'again' } }), [], true).failure?.code
    ).toBe('empty')
  })

  test('an unreadable body is a failure, not no AIO', () => {
    expect(interpretSearch(200, 'not json', []).failure?.code).toBe('other')
    expect(interpretSearch(502, body({ error: 'bad gateway' }), []).failure?.code).toBe('other')
  })
})
