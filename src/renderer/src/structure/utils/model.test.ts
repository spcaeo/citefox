import { describe, expect, it } from 'vitest'
import type { ClusterPageRow, ClusterSummary, SiloSummary, SitemapRecord } from '@shared/domain'
import {
  clusterTracking,
  filterClusters,
  lastmodDay,
  marketsLabel,
  orderSitemaps,
  pagePath,
  parseSiloMarketValue,
  roleCounts,
  scoreChangeLabel,
  siloMarketValue,
  sitemapFile,
  sitemapStatus,
  sitemapTotal,
  sortClusterPages,
  sortClusters
} from './model'
import { siloMarketItems, siloMarketsText } from './siloMenu'

function sitemap(patch: Partial<SitemapRecord>): SitemapRecord {
  return {
    id: 'sm',
    url: 'https://textbolt.com/post-sitemap.xml',
    parentId: null,
    kind: 'urlset',
    source: 'index',
    included: true,
    state: 'read',
    lastReadAt: '2026-10-19T09:00:00.000Z',
    lastChangedAt: '2026-10-19',
    pageCount: 10,
    error: null,
    lowValue: false,
    ...patch
  }
}

function cluster(patch: Partial<ClusterSummary>): ClusterSummary {
  return {
    id: 'c',
    name: 'Cluster',
    madeBy: 'rules',
    editedByUser: false,
    pillarPageId: null,
    pillarTitle: null,
    pillarUrl: null,
    pageCount: 1,
    trackedCount: 0,
    averageScore: null,
    scoreChange: null,
    weakestMarket: null,
    themes: [],
    trackWhole: false,
    ...patch
  }
}

function silo(path: string, parentPath: string | null, depth: number): SiloSummary {
  return {
    path,
    parentPath,
    depth,
    pageCount: 1,
    trackedCount: 0,
    trackAll: false,
    marketIds: null,
    effectiveMarketIds: ['us']
  }
}

describe('sitemap helpers', () => {
  it('names the file and the status', () => {
    expect(sitemapFile('https://textbolt.com/sitemaps/post-sitemap.xml')).toBe('post-sitemap.xml')
    expect(sitemapStatus(sitemap({ included: false, lowValue: true }))).toBe('Usually low-value')
    expect(sitemapStatus(sitemap({ included: false }))).toBe('Left out by you')
    expect(sitemapStatus(sitemap({ state: 'pending' }))).toBe('Read on the next sync')
    expect(sitemapStatus(sitemap({ state: 'error', error: 'Returned 404' }))).toBe('Returned 404')
    expect(sitemapStatus(sitemap({ kind: 'index', pageCount: 6 }))).toBe('Lists 6 sitemaps')
  })

  it('keeps the index first with its children below, sorted', () => {
    const rows = orderSitemaps(
      [
        sitemap({ id: 'b', url: 'https://t.com/b.xml', parentId: 'i', pageCount: 5 }),
        sitemap({ id: 'user', url: 'https://t.com/user.xml', source: 'user' }),
        sitemap({ id: 'i', url: 'https://t.com/index.xml', kind: 'index' }),
        sitemap({ id: 'a', url: 'https://t.com/a.xml', parentId: 'i', pageCount: 9 })
      ],
      [{ key: 'urls', dir: 'desc' }]
    )
    expect(rows.map((row) => [row.record.id, row.depth])).toEqual([
      ['i', 0],
      ['a', 1],
      ['b', 1],
      ['user', 0]
    ])
  })

  it('totals included page sitemaps that were read', () => {
    expect(
      sitemapTotal([
        sitemap({ id: 'a', pageCount: 1420 }),
        sitemap({ id: 'b', pageCount: 594 }),
        sitemap({ id: 'c', pageCount: 312, included: false }),
        sitemap({ id: 'i', kind: 'index', pageCount: 3 })
      ])
    ).toBe('2,014 pages from 2 sitemaps')
  })

  it('reads a bare lastmod date in the local calendar', () => {
    expect(lastmodDay('2026-10-19')).toBe('Oct 19, 2026')
    expect(lastmodDay(null)).toBe('—')
  })
})

describe('cluster helpers', () => {
  const clusters = [
    cluster({ id: 'a', name: 'Email to SMS', pageCount: 34, trackedCount: 12, averageScore: 46 }),
    cluster({ id: 'b', name: '10DLC', pageCount: 22, themes: ['opt-in rules'], madeBy: 'claude' }),
    cluster({ id: 'c', name: 'Industries', pageCount: 210, trackWhole: true, trackedCount: 210 })
  ]

  it('derives tracking and filters by search and facets', () => {
    expect(clusters.map(clusterTracking)).toEqual(['some', 'none', 'whole'])
    expect(filterClusters(clusters, 'opt-in', { tracking: [], madeBy: [] })).toHaveLength(1)
    expect(
      filterClusters(clusters, '', { tracking: ['whole', 'some'], madeBy: ['rules'] }).map(
        (item) => item.id
      )
    ).toEqual(['a', 'c'])
  })

  it('sorts with empty scores last', () => {
    expect(sortClusters(clusters, [{ key: 'score', dir: 'desc' }]).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c'
    ])
    expect(sortClusters(clusters, [{ key: 'pages', dir: 'desc' }]).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b'
    ])
  })

  it('counts roles and sorts pages by role', () => {
    const pages: ClusterPageRow[] = [
      {
        pageId: 'p2',
        url: 'https://t.com/b/',
        title: 'B',
        role: 'orphan',
        movedByUser: false,
        status: 'not_tracked',
        score: null
      },
      {
        pageId: 'p1',
        url: 'https://t.com/a/',
        title: 'A',
        role: 'pillar',
        movedByUser: false,
        status: 'tracked',
        score: 40
      }
    ]
    expect(roleCounts(pages)).toEqual({ pillar: 1, supporting: 0, orphan: 1 })
    expect(sortClusterPages(pages, 'all', [{ key: 'role', dir: 'asc' }])[0]?.pageId).toBe('p1')
    expect(sortClusterPages(pages, 'orphan', [])).toHaveLength(1)
  })

  it('labels score changes', () => {
    expect(scoreChangeLabel(null)).toBeNull()
    expect(scoreChangeLabel(4)).toBe('+4')
    expect(scoreChangeLabel(-3)).toBe('-3')
    expect(scoreChangeLabel(0)).toBe('No change')
  })
})

describe('silo helpers', () => {
  const choices = [
    { id: 'us', label: '🇺🇸 US · EN', market: null },
    { id: 'uk', label: '🇬🇧 UK · EN', market: null }
  ]

  it("a folder's markets read as inherited or its own, and the menu ticks the current one", () => {
    const root = { ...silo('/', null, 0), effectiveMarketIds: ['us'] }
    const blog = { ...silo('/blog/', '/', 1), effectiveMarketIds: ['us'] }
    expect(siloMarketsText(root, choices)).toBe('Project default (🇺🇸 US · EN)')
    expect(siloMarketsText(blog, choices)).toBe('Same as parent folder (🇺🇸 US · EN)')
    expect(siloMarketsText({ ...blog, marketIds: ['uk'] }, choices)).toBe('🇬🇧 UK · EN')
    const picked: (string[] | null)[] = []
    const items = siloMarketItems(blog, choices, false, (ids) => picked.push(ids))
    expect(items.map((item) => item.label)).toEqual([
      'New pages use the parent folder’s markets',
      'New pages use 🇺🇸 US · EN',
      'New pages use 🇬🇧 UK · EN',
      'New pages use all 2 markets'
    ])
    expect(items[0]).toMatchObject({ icon: 'check', disabled: true })
    items[3]?.onSelect?.()
    expect(picked).toEqual([['us', 'uk']])
  })

  it('round-trips silo market values and labels markets', () => {
    expect(siloMarketValue(null)).toBe('inherit')
    expect(parseSiloMarketValue('inherit')).toBeNull()
    expect(parseSiloMarketValue(siloMarketValue(['us', 'uk']))).toEqual(['us', 'uk'])
    expect(marketsLabel(['us', 'uk'], choices)).toBe('🇺🇸 US · EN + 🇬🇧 UK · EN')
    expect(marketsLabel(['us', 'mx'], choices)).toBe('2 markets')
  })
})

describe('pagePath', () => {
  it('keeps the path and query', () => {
    expect(pagePath('https://textbolt.com/blog/a/?x=1')).toBe('/blog/a/?x=1')
    expect(pagePath('not a url')).toBe('not a url')
  })
})
