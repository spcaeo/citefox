import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CommunitiesReport } from '@shared/domain'
import type { HttpRequest, HttpResponse } from '../providers/http'
import { parseThread, sameOriginRedirect } from './reddit'
import {
  COMMUNITY_SEED,
  fixtureResponse,
  seedCommunitiesProject,
  type SeedOptions,
  type SeededHarness
} from './seed.test-helper'
import { fetchVideoDetails, isoDuration } from './youtube-api'

const opened: Array<{ harness: SeededHarness; dir: string }> = []

afterEach(() => {
  for (const { harness, dir } of opened.splice(0)) {
    harness.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

async function seeded(options: SeedOptions = {}): Promise<SeededHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-extras-'))
  const harness = await seedCommunitiesProject(dir, options)
  opened.push({ harness, dir })
  return harness
}

function redditFake(
  answers: Record<string, string>
): (request: HttpRequest) => HttpResponse | null {
  return (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'www.reddit.com') return null
    const id = /^\/comments\/([a-z0-9]+)\.json$/.exec(url.pathname)?.[1] ?? ''
    const fixture = answers[id]
    return fixture === undefined ? { status: 404, body: '{}' } : fixtureResponse(fixture)
  }
}

function report(harness: SeededHarness): Promise<CommunitiesReport> {
  return Promise.resolve(
    harness.handlers['communities:get']({
      projectId: COMMUNITY_SEED.projectId,
      scope: 'page',
      pageId: COMMUNITY_SEED.pageId,
      marketId: null
    })
  )
}

describe('communities:checkThreads (FR-17.4)', () => {
  test('reads public Reddit data once per thread and says whether you can reply', async () => {
    const harness = await seeded({
      http: redditFake({
        '1abc23x': 'reddit-thread-open.json',
        '1def45y': 'reddit-thread-archived.json'
      })
    })
    const before = harness.requests.length
    const result = await harness.handlers['communities:checkThreads']({
      projectId: COMMUNITY_SEED.projectId,
      urls: null,
      force: false
    })
    expect(result).toEqual({ checked: 2, cached: 0, failed: 0, skipped: 0, message: null })
    const reddit = harness.requests.slice(before)
    expect(reddit.map((request) => request.method)).toEqual(['GET', 'GET'])
    for (const request of reddit) {
      expect(new URL(request.url).origin).toBe('https://www.reddit.com')
      expect(request.headers?.['User-Agent']).toMatch(/^desktop:CiteFox:/)
      expect(request.body).toBeUndefined()
    }
    const after = await report(harness)
    const byId = new Map(after.reddit.map((thread) => [thread.threadId, thread]))
    expect(byId.get('1abc23x')).toMatchObject({
      replyState: 'open',
      comments: 214,
      upvotes: 388,
      brandInThread: true,
      postedAt: new Date(1759600000 * 1000).toISOString(),
      excerpt:
        'vtext.com shutting down — what are you all using for email-to-SMS alerts?\n\nOur alarm panels send to @vtext.com. What now?',
      brandQuote: 'TextBolt worked for us, took 20 minutes.'
    })
    expect(byId.get('1def45y')).toMatchObject({
      replyState: 'archived',
      comments: 132,
      brandInThread: false,
      brandQuote: null
    })
    expect(byId.get('1def45y')?.excerpt).not.toBeNull()
    expect(after.extras.threadsChecked).toBe(2)

    const again = await harness.handlers['communities:checkThreads']({
      projectId: COMMUNITY_SEED.projectId,
      urls: null,
      force: false
    })
    expect(again).toEqual({ checked: 0, cached: 2, failed: 0, skipped: 0, message: null })
    expect(harness.requests.length).toBe(before + 2)
  })

  test('a 429 stops the run and leaves the rest unchecked', async () => {
    const harness = await seeded({
      http: redditFake({
        '1abc23x': 'reddit-rate-limited.json',
        '1def45y': 'reddit-rate-limited.json'
      })
    })
    const result = await harness.handlers['communities:checkThreads']({
      projectId: COMMUNITY_SEED.projectId,
      urls: null,
      force: false
    })
    expect(result.checked).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.message).toMatch(/slow down/)
    const after = await report(harness)
    expect(after.reddit.every((thread) => thread.replyState === 'unchecked')).toBe(true)
  })

  test('a removed thread is stored as failed and stays unchecked; uncited URLs are ignored', async () => {
    const harness = await seeded({ http: redditFake({}) })
    const result = await harness.handlers['communities:checkThreads']({
      projectId: COMMUNITY_SEED.projectId,
      urls: [COMMUNITY_SEED.redditOpen, 'https://www.reddit.com/r/other/comments/zzz999/x'],
      force: true
    })
    expect(result).toEqual({ checked: 0, cached: 0, failed: 1, skipped: 0, message: null })
    const after = await report(harness)
    expect(after.reddit.find((thread) => thread.threadId === '1abc23x')?.replyState).toBe(
      'unchecked'
    )
  })

  test('follows one redirect, and only on Reddit itself', () => {
    expect(sameOriginRedirect(301, '/r/a/comments/x1/t/.json')).toBe(
      'https://www.reddit.com/r/a/comments/x1/t/.json'
    )
    expect(sameOriginRedirect(302, 'https://evil.example/x.json')).toBeNull()
    expect(sameOriginRedirect(200, '/x')).toBeNull()
  })

  test('a locked thread cannot be replied to', () => {
    const body = JSON.stringify([
      {
        data: {
          children: [
            { data: { id: 'x1', title: 'T', locked: true, archived: false, num_comments: 3 } }
          ]
        }
      },
      { data: { children: [] } }
    ])
    const row = parseThread(
      'https://reddit.com/r/a/comments/x1',
      body,
      ['TextBolt'],
      new Date(0),
      'r/a'
    )
    expect(row).toMatchObject({ locked: true, archived: false, comments: 3, brandNamed: false })
    expect(row.brandQuote).toBeNull()
  })

  test('keeps a trimmed excerpt of the title and top post, and the sentence naming the brand', () => {
    const body = JSON.stringify([
      {
        data: {
          children: [
            {
              data: {
                id: 'x2',
                title: 'Which SMS gateway?',
                selftext: `${'Long context here. '.repeat(60)}Has anyone tried TextBolt? Thanks.`,
                num_comments: 1
              }
            }
          ]
        }
      },
      { data: { children: [{ data: { body: 'TextBolt is fine.' } }] } }
    ])
    const row = parseThread(
      'https://reddit.com/r/a/comments/x2',
      body,
      ['TextBolt'],
      new Date(0),
      null
    )
    expect(row.excerpt?.startsWith('Which SMS gateway?\n\nLong context here.')).toBe(true)
    expect(row.excerpt?.length).toBeLessThanOrEqual(600)
    expect(row.excerpt?.endsWith('…')).toBe(true)
    // The post comes before the comments, even when the excerpt cut it off.
    expect(row.brandQuote).toBe('Has anyone tried TextBolt?')
  })

  test('a failed read keeps no excerpt', () => {
    const row = parseThread('https://reddit.com/r/a/comments/x3', 'not json', [], new Date(0), null)
    expect(row).toMatchObject({ error: expect.any(String), excerpt: null, brandQuote: null })
  })
})

describe('communities:refreshVideos (FR-11.9)', () => {
  test('without a key it says where to add one and calls nothing', async () => {
    const harness = await seeded()
    const before = harness.requests.length
    const result = await harness.handlers['communities:refreshVideos']({
      projectId: COMMUNITY_SEED.projectId
    })
    expect(result.missingKey).toBe(true)
    expect(result.message).toMatch(/Connections/)
    expect(harness.requests.length).toBe(before)
  })

  test('with a key it fetches views, dates and channels, and recognises your channel', async () => {
    const harness = await seeded({
      youtubeKey: true,
      http: (request) => {
        const url = new URL(request.url)
        if (url.hostname !== 'www.googleapis.com') return null
        if (url.pathname.endsWith('/channels'))
          return fixtureResponse('youtube-channel-handle.json')
        return fixtureResponse('youtube-videos.json')
      }
    })
    await harness.handlers['communities:setSettings']({
      projectId: COMMUNITY_SEED.projectId,
      youtubeChannel: 'UCsmallBizTechHelp000001'
    })
    const result = await harness.handlers['communities:refreshVideos']({
      projectId: COMMUNITY_SEED.projectId
    })
    expect(result).toEqual({ fetched: 2, missingKey: false, message: null })
    const api = harness.requests.filter((request) => request.url.includes('googleapis.com'))
    expect(api).toHaveLength(1)
    const url = new URL(api[0]?.url ?? '')
    expect(url.pathname).toBe('/youtube/v3/videos')
    expect(url.searchParams.get('id')?.split(',').sort()).toEqual(['Emai1ToSMS2', 'Gr4fanaSMS1'])
    const after = await report(harness)
    expect(after.extras.youtubeKey).toBe(true)
    expect(after.youtube.find((video) => video.videoId === 'Emai1ToSMS2')).toMatchObject({
      views: 112400,
      channelTitle: 'SmallBiz Tech Help',
      yours: true,
      durationSeconds: 700
    })
    expect(JSON.stringify(after)).not.toContain(COMMUNITY_SEED.youtubeSecret)
    const screen = await harness.handlers['videos:get']({
      projectId: COMMUNITY_SEED.projectId,
      pageId: null,
      marketId: null
    })
    expect(screen.stats.citingYours).toBe(2)
    expect(screen.stats.competitorChannels).toBe(1)
    expect(screen.stats.competitorChannelNames).toEqual(['Ops Shortcuts'])
  })

  test('a handle resolves to its channel id once', async () => {
    const harness = await seeded({
      youtubeKey: true,
      http: (request) =>
        new URL(request.url).pathname.endsWith('/channels')
          ? fixtureResponse('youtube-channel-handle.json')
          : null
    })
    const saved = await harness.handlers['communities:setSettings']({
      projectId: COMMUNITY_SEED.projectId,
      youtubeChannel: 'textbolt'
    })
    expect(saved.youtubeChannel).toBe('@textbolt')
    const call = harness.requests.find((request) => request.url.includes('/channels'))
    expect(new URL(call?.url ?? '').searchParams.get('forHandle')).toBe('@textbolt')
    expect(
      await harness.handlers['communities:getSettings']({ projectId: COMMUNITY_SEED.projectId })
    ).toEqual({ youtubeChannel: '@textbolt' })
  })

  test('a spent quota is a plain message and the key never appears', async () => {
    const harness = await seeded({
      youtubeKey: true,
      http: (request) =>
        request.url.includes('googleapis.com') ? fixtureResponse('youtube-quota.json') : null
    })
    const result = await harness.handlers['communities:refreshVideos']({
      projectId: COMMUNITY_SEED.projectId
    })
    expect(result.fetched).toBe(0)
    expect(result.message).toMatch(/quota/)
    expect(JSON.stringify(result)).not.toContain(COMMUNITY_SEED.youtubeSecret)
  })
})

describe('fetchVideoDetails', () => {
  test('batches at most 50 ids per call and marks ids the API did not return', async () => {
    const calls: string[] = []
    const ids = Array.from({ length: 120 }, (_, index) => `vid${String(index).padStart(8, '0')}`)
    const rows = await fetchVideoDetails(
      {
        http: {
          async request(request) {
            calls.push(request.url)
            return { status: 200, body: '{"items":[]}' }
          }
        },
        sleep: async () => undefined,
        now: () => new Date('2026-10-20T00:00:00Z'),
        secrets: []
      },
      'key-123',
      ids
    )
    expect(calls).toHaveLength(3)
    expect(calls.map((url) => new URL(url).searchParams.get('id')?.split(',').length)).toEqual([
      50, 50, 20
    ])
    expect(rows).toHaveLength(120)
    expect(rows.every((row) => row.missing)).toBe(true)
  })

  test('parses ISO 8601 durations', () => {
    expect(isoDuration('PT5M12S')).toBe(312)
    expect(isoDuration('PT1H2M3S')).toBe(3723)
    expect(isoDuration('P1D')).toBe(86400)
    expect(isoDuration('soon')).toBeNull()
  })
})
