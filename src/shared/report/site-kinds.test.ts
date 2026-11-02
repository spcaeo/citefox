import { describe, expect, test } from 'vitest'
import { builtInSiteKind, kindTable, siteKindOf } from './site-kinds'

describe('builtInSiteKind', () => {
  test('well-known hosts and their subdomains', () => {
    expect(builtInSiteKind('youtube.com')).toBe('video_social')
    expect(builtInSiteKind('https://www.reddit.com/r/smallbusiness')).toBe('video_social')
    expect(builtInSiteKind('uk.linkedin.com')).toBe('video_social')
    expect(builtInSiteKind('g2.com')).toBe('analysts_media')
    expect(builtInSiteKind('www.gartner.com')).toBe('analysts_media')
    expect(builtInSiteKind('learn.microsoft.com')).toBe('big_tech')
    expect(builtInSiteKind('cloud.google.com')).toBe('big_tech')
  })

  test('a host that only looks similar is not matched', () => {
    expect(builtInSiteKind('notyoutube.com')).toBeNull()
    expect(builtInSiteKind('simpletexting.com')).toBeNull()
    expect(builtInSiteKind('')).toBeNull()
  })
})

describe('siteKindOf', () => {
  test('a saved competitor wins, then the built-in list, then the stored answer, else other', () => {
    expect(siteKindOf({ host: 'reddit.com', competitor: true })).toBe('competitors')
    expect(siteKindOf({ host: 'reddit.com', competitor: false, sorted: 'services' })).toBe(
      'video_social'
    )
    expect(siteKindOf({ host: 'acme-agency.com', competitor: false, sorted: 'services' })).toBe(
      'services'
    )
    expect(siteKindOf({ host: 'acme.com', competitor: false })).toBe('other')
  })
})

describe('kindTable', () => {
  test('sums sites and citations by kind, most cited now first, with the change', () => {
    const rows = kindTable([
      { kind: 'video_social', before: 10, now: 14 },
      { kind: 'video_social', before: 3, now: 0 },
      { kind: 'competitors', before: 6, now: 4 },
      { kind: 'other', before: 0, now: 2 },
      { kind: 'big_tech', before: 0, now: 0 }
    ])
    expect(rows).toEqual([
      {
        kind: 'video_social',
        label: 'Video, social & forums',
        sites: 2,
        before: 13,
        now: 14,
        change: 1
      },
      { kind: 'competitors', label: 'Competitors', sites: 1, before: 6, now: 4, change: -2 },
      { kind: 'other', label: 'Neutral', sites: 1, before: 0, now: 2, change: 2 }
    ])
  })

  test('without an earlier check, before and change are null', () => {
    expect(kindTable([{ kind: 'services', before: null, now: 3 }])).toEqual([
      {
        kind: 'services',
        label: 'Services & agencies',
        sites: 1,
        before: null,
        now: 3,
        change: null
      }
    ])
  })
})
