import { describe, expect, test } from 'vitest'
import { createLogger } from '../../logging/logger'
import { MemorySecretStore } from '../../secrets/secret-store'
import type { HttpRequest, HttpResponse } from '../http'
import { interpretYouTube, testYouTubeKey, YOUTUBE_PROBE_VIDEO } from './data-api'

const SECRET = 'AIzaSyFixtureYouTubeKey0123456789abcdef'

function run(response: HttpResponse): {
  result: ReturnType<typeof testYouTubeKey>
  requests: HttpRequest[]
  logs: string[]
} {
  const requests: HttpRequest[] = []
  const logs: string[] = []
  const secrets = new MemorySecretStore()
  secrets.set('citefox.youtube.key-1', SECRET)
  const result = testYouTubeKey({
    transport: {
      async request(request) {
        requests.push(request)
        return response
      }
    },
    logger: createLogger({ write: (line) => logs.push(line), secrets: () => [SECRET] }),
    secretStore: secrets,
    keychainRef: 'citefox.youtube.key-1',
    sleep: async () => undefined
  })
  return { result, requests, logs }
}

describe('YouTube Data API key test (FR-11.9)', () => {
  test('one read-only videos.list call; a 200 is ok and the key never reaches the log', async () => {
    const { result, requests, logs } = run({ status: 200, body: '{"items":[{"id":"x"}]}' })
    expect(await result).toMatchObject({ state: 'ok', reason: null })
    expect(requests).toHaveLength(1)
    const url = new URL(requests[0]?.url ?? '')
    expect(url.pathname).toBe('/youtube/v3/videos')
    expect(url.searchParams.get('part')).toBe('id')
    expect(url.searchParams.get('id')).toBe(YOUTUBE_PROBE_VIDEO)
    expect(requests[0]?.method).toBe('GET')
    expect(logs.join('\n')).not.toContain(SECRET)
  })

  test('maps Google error reasons to plain words', () => {
    const body = (reason: string): string =>
      JSON.stringify({ error: { code: 400, errors: [{ reason }] } })
    expect(interpretYouTube(400, body('keyInvalid'))).toMatchObject({ reason: 'rejected' })
    expect(interpretYouTube(403, body('quotaExceeded'))).toMatchObject({
      reason: 'rate_limited',
      message: "The key works, but today's YouTube quota is used up."
    })
    expect(interpretYouTube(403, body('accessNotConfigured')).message).toContain('not turned on')
    expect(interpretYouTube(502, 'oops')).toMatchObject({ state: 'warning', reason: 'other' })
  })

  test('a missing keychain item is a warning with a next step', async () => {
    const result = await testYouTubeKey({
      transport: {
        async request() {
          throw new Error('should not be called')
        }
      },
      logger: createLogger({ write: () => undefined }),
      secretStore: new MemorySecretStore(),
      keychainRef: 'citefox.youtube.missing'
    })
    expect(result).toMatchObject({ state: 'warning', reason: 'other' })
    expect(result.nextStep).not.toBeNull()
  })
})
