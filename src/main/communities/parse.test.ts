import { describe, expect, test } from 'vitest'
import {
  parseCheckThreads,
  parseCommunitiesRequest,
  parseExportVideo,
  parseSetSettings,
  parseTrackVideo,
  parseUpdateIdea,
  parseVideoScreen
} from './parse'

describe('Communities request parsing', () => {
  test('accepts the documented shapes', () => {
    expect(
      parseCommunitiesRequest({ projectId: 'p1', scope: 'project', pageId: null, marketId: 'm1' })
    ).toEqual({ projectId: 'p1', scope: 'project', pageId: null, marketId: 'm1' })
    expect(parseCheckThreads({ projectId: 'p1', urls: null, force: false }).urls).toBeNull()
    expect(parseVideoScreen({ projectId: 'p1', pageId: 'pg', marketId: null }).pageId).toBe('pg')
    expect(parseExportVideo({ projectId: 'p1', ideaId: 'vi-1', file: 'captions' }).file).toBe(
      'captions'
    )
  })

  test.each([
    [
      () =>
        parseCommunitiesRequest({ projectId: 'p1', scope: 'page', pageId: null, marketId: null })
    ],
    [
      () =>
        parseCommunitiesRequest({ projectId: 'p1', scope: 'site', pageId: null, marketId: null })
    ],
    [() => parseCommunitiesRequest({ projectId: 'p1', scope: 'project', pageId: null })],
    [() => parseCheckThreads({ projectId: 'p1', urls: ['http://reddit.com/r/a'], force: false })],
    [() => parseCheckThreads({ projectId: 'p1', urls: null, force: 'yes' })],
    [() => parseExportVideo({ projectId: 'p1', ideaId: 'vi-1', file: 'mp4' })],
    [() => parseUpdateIdea({ projectId: 'p1', ideaId: 'vi-1', patch: { step: 'done' } })],
    [() => parseUpdateIdea({ projectId: 'p1', ideaId: 'vi-1', patch: { deadline: '2027-02-30' } })],
    [() => parseUpdateIdea({ projectId: 'p1', ideaId: 'vi-1', patch: { checklist: ['nope'] } })],
    [() => parseUpdateIdea({ projectId: 'p1', ideaId: 'vi-1', patch: { other: 1 } })],
    [() => parseTrackVideo({ projectId: 'p1', ideaId: 'vi-1', videoUrl: '' })],
    [() => parseSetSettings({ projectId: 'p1', youtubeChannel: 'has spaces in it' })]
  ])('rejects a bad request %#', (parse) => {
    expect(parse).toThrow()
  })

  test('a patch keeps only the fields sent, and a channel becomes a handle', () => {
    expect(
      parseUpdateIdea({
        projectId: 'p1',
        ideaId: 'vi-1',
        patch: { deadline: null, checklist: ['captions', 'captions', 'chapters'] }
      }).patch
    ).toEqual({ deadline: null, checklist: ['captions', 'chapters'] })
    expect(parseSetSettings({ projectId: 'p1', youtubeChannel: ' textbolt ' }).youtubeChannel).toBe(
      '@textbolt'
    )
    expect(
      parseSetSettings({ projectId: 'p1', youtubeChannel: 'UCtextBoltOwnChannel0001' })
        .youtubeChannel
    ).toBe('UCtextBoltOwnChannel0001')
    expect(parseSetSettings({ projectId: 'p1', youtubeChannel: '' }).youtubeChannel).toBeNull()
  })
})
