import { describe, expect, test } from 'vitest'
import {
  parseDiscover,
  parseEstimate,
  parseImportUrlsRequest,
  parseRecluster,
  parseSetRules,
  parseSetSilo,
  parseTrack
} from './parse'

describe('structure request parsing', () => {
  test('rejects unknown keys, bad enums, and oversized lists with the channel name only', () => {
    expect(() => parseDiscover({ projectId: 'p1', url: null, extra: 1 })).toThrow(
      'sitemaps:discover'
    )
    expect(() =>
      parseSetRules({
        projectId: 'p1',
        rules: { frequency: 'hourly', onNew: 'ask', onRemoved: 'pause', onChanged: 'reread' }
      })
    ).toThrow('sitemaps:setRules')
    expect(() =>
      parseRecluster({ projectId: 'p1', method: 'magic', useClaude: false, instruction: null })
    ).toThrow('structure:recluster')
    expect(() =>
      parseImportUrlsRequest({
        projectId: 'p1',
        text: 'x'.repeat(5 * 1024 * 1024),
        format: 'lines'
      })
    ).toThrow('Import up to 10,000 URLs')
    expect(() =>
      parseEstimate({
        projectId: 'p1',
        pageCount: -1,
        setupPageCount: 0,
        marketCount: 1,
        promptCount: 5,
        samples: 1,
        intervalDays: 30,
        stagger: true
      })
    ).toThrow('import:estimate')
  })

  test('accepts a track request and a silo patch with optional fields', () => {
    const track = parseTrack({
      projectId: 'p1',
      pageIds: ['a', 'a', 'b'],
      urls: [' https://textbolt.com/x/ '],
      markets: [
        { country: 'US', language: 'en', location: null, device: 'desktop', localWording: false }
      ],
      intervalDays: 30,
      samples: 2,
      promptCount: 5,
      stagger: true
    })
    expect(track.pageIds).toEqual(['a', 'b'])
    expect(track.urls).toEqual(['https://textbolt.com/x/'])
    expect(parseSetSilo({ projectId: 'p1', path: '/blog/', trackAll: true })).toEqual({
      projectId: 'p1',
      path: '/blog/',
      trackAll: true
    })
    expect(parseSetSilo({ projectId: 'p1', path: '/blog/', marketIds: null }).marketIds).toBeNull()
    expect(() => parseSetSilo({ projectId: 'p1', path: 'blog' })).toThrow('structure:setSilo')
    expect(() => parseSetSilo({ projectId: 'p1', path: '/blog/', marketIds: [] })).toThrow()
  })
})
