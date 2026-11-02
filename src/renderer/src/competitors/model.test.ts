import { describe, expect, it } from 'vitest'
import type { CitedSiteRow } from '@shared/ipc'
import {
  barScale,
  countChange,
  filterByKind,
  kindFrom,
  kindRows,
  percent,
  periodFrom,
  pointsText,
  shareTrend,
  kindCounts,
  newSites,
  onlyNewFrom,
  sortFrom,
  sortParam,
  topCompetitor
} from './model'

function row(over: Partial<CitedSiteRow>): CitedSiteRow {
  return {
    id: 's1',
    name: 'Site',
    domain: 'site.com',
    kind: 'other',
    siteKind: 'other',
    tier: null,
    citations: 0,
    questions: 0,
    share: null,
    named: null,
    startCitations: null,
    shareChange: null,
    firstSeenAt: null,
    isNew: false,
    byProduct: [],
    gaps: [],
    links: [],
    citedQuestions: [],
    namedQuestions: [],
    ...over
  }
}

describe('competitors model', () => {
  it('reads the period from the route, falling back to 30 days', () => {
    expect(periodFrom('7')).toBe(7)
    expect(periodFrom('90')).toBe(90)
    expect(periodFrom('14')).toBe(30)
    expect(periodFrom(null)).toBe(30)
    expect(periodFrom('x')).toBe(30)
  })

  it('formats shares and point changes', () => {
    expect(percent(null)).toBe('—')
    expect(percent(0)).toBe('0%')
    expect(percent(0.001)).toBe('<1%')
    expect(percent(0.375)).toBe('38%')
    expect(pointsText(0.03)).toBe('+3 pts')
    expect(pointsText(-0.005)).toBe('−0.5 pts')
    expect(pointsText(0.125)).toBe('+13 pts')
    expect(pointsText(0.0001)).toBeNull()
  })

  it('turns a share change into a trend, with the tone flipped for competitors', () => {
    expect(shareTrend(null, 30)).toBeUndefined()
    expect(shareTrend(0, 30)).toEqual({
      direction: 'flat',
      text: 'No change in 30 d',
      tone: 'neutral'
    })
    expect(shareTrend(0.05, 7)).toEqual({ direction: 'up', text: '+5 pts in 7 d', tone: 'ok' })
    expect(shareTrend(0.05, 7, false)).toEqual({
      direction: 'up',
      text: '+5 pts in 7 d',
      tone: 'bad'
    })
    expect(shareTrend(-0.05, 7, false)?.tone).toBe('ok')
  })

  it('filters sites, keeps your row, and counts each view', () => {
    const you = row({ id: 'you', kind: 'you', citations: 3, share: 0.3 })
    const unseen = row({ id: 'b', kind: 'competitor', citations: 0, share: 0 })
    const rows = [
      you,
      row({ id: 'a', kind: 'competitor', citations: 4, share: 0.4 }),
      unseen,
      row({ id: 'c', kind: 'other', citations: 1, share: 0.1, isNew: true })
    ]
    const reddit = row({ id: 'r', kind: 'other', domain: 'reddit.com', citations: 2, share: 0.2 })
    const all = [...rows, reddit]
    // One grouping (audit2 #9): the site types, yours never counted; New keeps your row.
    expect(newSites(all, true).map((item) => item.id)).toEqual(['you', 'c'])
    expect(newSites(all, false)).toHaveLength(all.length)
    expect(onlyNewFrom('new')).toBe(true)
    expect(onlyNewFrom('platforms')).toBe(false)
    const counts = kindCounts([
      ...all,
      row({ id: 'v', kind: 'other', siteKind: 'video_social' }),
      row({ id: 'p', kind: 'other', siteKindPending: true })
    ])
    expect(counts.get('video_social')).toBe(1)
    expect(counts.get('pending')).toBe(1)
    expect([...counts.values()].reduce((sum, n) => sum + n, 0)).toBe(6)
    expect(topCompetitor(rows)?.id).toBe('a')
    expect(topCompetitor([you, unseen])).toBeNull()
    expect(barScale(rows)).toBe(0.4)
  })

  it('keeps the list sort in the route, the default left out', () => {
    expect(sortFrom('share.asc,name.desc')).toEqual([
      { key: 'share', dir: 'asc' },
      { key: 'name', dir: 'desc' }
    ])
    expect(sortFrom('bad,share.up,9.asc')).toEqual([])
    expect(sortFrom(null)).toEqual([])
    expect(sortParam([{ key: 'name', dir: 'asc' }])).toBe('name.asc')
    expect(sortParam([{ key: 'citations', dir: 'desc' }])).toBeNull()
    expect(sortParam([])).toBeNull()
  })

  it('groups the other sites by kind and filters the list to one kind', () => {
    const rows = [
      row({ id: 'you', kind: 'you', siteKind: null, citations: 3, startCitations: 1 }),
      row({
        id: 'a',
        kind: 'competitor',
        siteKind: 'competitors',
        citations: 4,
        startCitations: 5
      }),
      row({ id: 'r', siteKind: 'video_social', citations: 2, startCitations: 0 }),
      row({ id: 'y', siteKind: 'video_social', citations: 1, startCitations: 1 }),
      row({ id: 'g', siteKind: 'big_tech', citations: 0, startCitations: 0 })
    ]
    expect(
      kindRows(rows).map((item) => [item.kind, item.sites, item.before, item.now, item.change])
    ).toEqual([
      ['competitors', 1, 5, 4, -1],
      ['video_social', 2, 1, 3, 2]
    ])
    expect(filterByKind(rows, 'video_social').map((item) => item.id)).toEqual(['you', 'r', 'y'])
    expect(filterByKind(rows, null)).toHaveLength(5)
    expect(kindFrom('big_tech')).toBe('big_tech')
    expect(kindFrom('nope')).toBeNull()
    expect([countChange(2), countChange(-1), countChange(0)]).toEqual(['+2', '−1', '0'])
  })
})
