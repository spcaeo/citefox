import { describe, expect, it } from 'vitest'
import {
  leaderLines,
  siteBrand,
  siteGroup,
  siteLines,
  siteTypeHint,
  siteTypeName,
  siteUrl
} from './siteRows'

describe('site rows', () => {
  it('names a site by its brand, a known platform by its name, else not at all', () => {
    expect(siteBrand('clicksend.com', 'ClickSend')).toBe('ClickSend')
    expect(siteBrand('reddit.com', 'reddit.com')).toBe('Reddit')
    expect(siteBrand('www.youtube.com', null)).toBe('YouTube')
    expect(siteBrand('att.com', 'att.com')).toBeNull()
    expect(siteBrand('att.com', 'ATT.com')).toBeNull()
    expect(siteBrand(null, 'Simplified Alerts')).toBe('Simplified Alerts')
    expect(siteBrand(null, null)).toBeNull()
    expect(siteUrl('www.att.com')).toBe('https://att.com/')
  })

  it('types each site in the Sources tab’s words: never Other or Site', () => {
    const lines = siteLines(
      [
        { key: 'a', domain: 'textbolt.com', classification: 'target' },
        { key: 'b', domain: 'textbolt.com', classification: 'own' },
        { key: 'c', domain: 'clicksend.com', classification: 'competitor' },
        { key: 'd', domain: 'reddit.com', classification: 'other' },
        { key: 'e', domain: 'g2.com', classification: 'other' },
        { key: 'f', domain: 'att.com', classification: 'other' }
      ],
      [],
      {
        overrides: [{ domain: 'g2.com', type: 'custom:t1', role: null }],
        customTypes: [{ id: 't1', name: 'Partner', tone: 'ok' }]
      }
    )
    expect(lines.map((line) => siteTypeName(line))).toEqual([
      'This page',
      'Your site',
      'Competitor',
      'Community',
      'Partner',
      'Neutral'
    ])
    expect(lines.map(siteGroup)).toEqual([
      'yours',
      'yours',
      'competitor',
      'platform',
      'platform',
      'neutral'
    ])
    expect(siteTypeName(lines[0]!, true)).toBe('Your target page')
    expect(siteTypeHint(lines[3]!)).toContain('Reddit')
  })

  it('a saved competitor stays one, whatever the address or a choice says', () => {
    const [line] = siteLines(
      [
        {
          key: 'r',
          domain: 'reddit.com',
          classification: 'competitor',
          competitorId: 'c1',
          competitorName: 'Reddit Ads'
        }
      ],
      [],
      { overrides: [{ domain: 'reddit.com', type: 'news', role: 'video' }], customTypes: [] }
    )
    expect(line?.relation).toEqual({ kind: 'competitor', name: 'Reddit Ads', id: 'c1' })
    expect(line?.roleEdited).toBe(false)
    expect(line?.typeEdited).toBe(false)
  })

  it('reads a Results leaderboard’s badges as types', () => {
    const lines = leaderLines([
      { domain: 'textbolt.com', badge: 'you' },
      { domain: 'twilio.com', badge: 'tracked' },
      { domain: 'youtube.com', badge: 'observed' },
      { domain: 'zapier.com', badge: 'observed' }
    ])
    expect([...lines.values()].map((line) => siteTypeName(line))).toEqual([
      'Your site',
      'Competitor',
      'Video',
      'Neutral'
    ])
  })

  it('leaderboard types follow the project: a saved competitor and a hand-picked role', () => {
    const rows = [
      { domain: 'acme.io', badge: 'observed' as const },
      { domain: 'smallblog.net', badge: 'observed' as const }
    ]
    const lines = leaderLines(rows, [{ id: 'c1', name: 'Acme', domain: 'acme.io', aliases: [] }], {
      overrides: [{ domain: 'smallblog.net', type: null, role: 'community' }],
      customTypes: []
    })
    expect(siteGroup(lines.get('acme.io') ?? { relation: { kind: 'neutral' } })).toBe('competitor')
    expect(lines.get('smallblog.net')?.relation.kind).toBe('platform')
  })
})
