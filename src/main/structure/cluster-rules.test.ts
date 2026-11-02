import { describe, expect, test } from 'vitest'
import {
  assignToCluster,
  clusterBySharedQueries,
  clusterByTopic,
  mergeWithExisting,
  pageTokens,
  termLabel,
  type ClusterInputPage,
  type ExistingCluster,
  type ProposedCluster
} from './cluster-rules'

const SITE = 'https://textbolt.com'

function page(
  id: string,
  path: string,
  title: string | null = null,
  prompts: string[] = []
): ClusterInputPage {
  return { id, url: `${SITE}${path}`, title, promptTexts: prompts, tracked: prompts.length > 0 }
}

function blogPages(): ClusterInputPage[] {
  const pages: ClusterInputPage[] = []
  const topics: Array<[string, string[]]> = [
    [
      '10dlc',
      [
        'registration-guide',
        'campaign-rejected',
        'fees',
        'vetting-score',
        'brand-approval',
        'for-churches'
      ]
    ],
    [
      'email-to-sms',
      ['how-it-works', 'gateway-list', 'for-outlook', 'for-gmail', 'carrier-limits']
    ],
    ['schedule-text', ['from-gmail', 'from-outlook', 'on-iphone', 'for-weekends', 'reminders']]
  ]
  let n = 0
  for (const [topic, slugs] of topics) {
    for (const slug of slugs) {
      n += 1
      pages.push(page(`p${n}`, `/blog/${topic}-${slug}/`))
    }
  }
  for (const slug of ['company-news', 'office-party', 'hiring-update', 'year-in-review']) {
    n += 1
    pages.push(page(`p${n}`, `/blog/${slug}/`))
  }
  return pages
}

describe('pageTokens', () => {
  test('uses slug and title words, drops stopwords and numbers, stems plurals', () => {
    expect(
      pageTokens(`${SITE}/blog/how-to-send-texts-in-2024/`, 'Sending Texts to Businesses')
    ).toEqual(['send', 'text', 'sending', 'business'])
    expect(pageTokens(`${SITE}/blog/10dlc-registration/`, null)).toEqual(['10dlc', 'registration'])
  })

  test('labels keep acronyms upper-case', () => {
    expect(termLabel('10dlc')).toBe('10DLC')
    expect(termLabel('email sms')).toBe('Email SMS')
    expect(termLabel('scheduling')).toBe('Scheduling')
  })
})

describe('clusterByTopic', () => {
  test('splits a flat folder by topic words and puts the rest in a catch-all', () => {
    const pages = blogPages()
    const clusters = clusterByTopic(pages)
    const ids = clusters.flatMap((cluster) => cluster.pageIds)
    expect(ids.sort()).toEqual(pages.map((item) => item.id).sort())
    const tenDlc = clusters.find((cluster) => cluster.key === 'blog|10dlc')
    expect(tenDlc?.name).toBe('10DLC')
    expect(tenDlc?.pageIds).toHaveLength(6)
    expect(tenDlc?.pillarPageId).toBe('p1')
    const other = clusters.find((cluster) => cluster.key === 'blog|_other')
    expect(other?.name).toBe('Blog · other topics')
    expect(other?.orphanPageIds.sort()).toEqual(other?.pageIds.sort())
    expect(other?.pillarPageId).toBeNull()
  })

  test('a small folder is one cluster named after it, with its landing page as pillar', () => {
    const clusters = clusterByTopic([
      page('f0', '/features/', 'Features'),
      page('f1', '/features/bulk-sms/'),
      page('f2', '/features/two-way-texting/'),
      page('r1', '/pricing/', 'Pricing')
    ])
    const features = clusters.find((cluster) => cluster.key === 'features|*')
    expect(features?.name).toBe('Features')
    expect(features?.pageIds).toEqual(['f0', 'f1', 'f2'])
    expect(features?.pillarPageId).toBe('f0')
    expect(clusters.find((cluster) => cluster.key === 'root|*')?.name).toBe('Other pages')
  })

  test('themes come from prompt texts when pages have them', () => {
    const pages = blogPages().map((item, index) =>
      index < 3
        ? { ...item, promptTexts: ['10DLC for alerts to staff', 'toll-free vs 10DLC'] }
        : item
    )
    const tenDlc = clusterByTopic(pages).find((cluster) => cluster.key === 'blog|10dlc')
    expect(tenDlc?.themes).toEqual(['10DLC for alerts to staff', 'toll-free vs 10DLC'])
  })

  test('names stay unique across folders', () => {
    const pages = [
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s, i) =>
        page(`b${i}`, `/blog/sms-pricing-${s}/`)
      ),
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s, i) =>
        page(`h${i}`, `/help/sms-pricing-${s}/`)
      )
    ]
    const names = clusterByTopic(pages).map((cluster) => cluster.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('clusters 2,000 synthetic pages quickly', () => {
    const words = [
      'alerts',
      'reminders',
      '10dlc',
      'gateway',
      'schedule',
      'crew',
      'school',
      'clinic',
      'church',
      'retail'
    ]
    const pages: ClusterInputPage[] = []
    for (let index = 0; index < 2000; index += 1) {
      const a = words[index % words.length] ?? 'x'
      const b = words[(index * 7) % words.length] ?? 'y'
      const folder = index % 5 === 0 ? 'features' : 'blog'
      pages.push(
        page(`s${index}`, `/${folder}/${a}-${b}-post-${index}/`, `${a} and ${b} guide ${index}`)
      )
    }
    const started = performance.now()
    const clusters = clusterByTopic(pages)
    expect(performance.now() - started).toBeLessThan(300)
    expect(clusters.reduce((sum, cluster) => sum + cluster.pageIds.length, 0)).toBe(2000)
  })
})

describe('clusterBySharedQueries', () => {
  test('groups pages whose prompts overlap and falls back to topics for the rest', () => {
    const pages = [
      page('a', '/blog/alerts-one/', null, [
        'send datadog alerts as sms',
        'datadog sms alerts setup'
      ]),
      page('b', '/blog/alerts-two/', null, ['datadog alerts sms without code']),
      page('c', '/blog/church/', null, ['church text reminders sunday']),
      page('d', '/pricing/')
    ]
    const clusters = clusterBySharedQueries(pages)
    const shared = clusters.find((cluster) => cluster.key.startsWith('queries|'))
    expect(shared?.pageIds.sort()).toEqual(['a', 'b'])
    expect(shared?.pillarPageId).not.toBeNull()
    expect(clusters.flatMap((cluster) => cluster.pageIds).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

function existing(
  partial: Partial<ExistingCluster> & Pick<ExistingCluster, 'id' | 'name' | 'pages'>
): ExistingCluster {
  return {
    madeBy: 'rules',
    renamedByUser: false,
    editedByUser: false,
    trackWhole: false,
    topicKey: null,
    pillarPageId: null,
    ...partial
  }
}

function proposal(
  key: string,
  name: string,
  pageIds: string[],
  pillar: string | null = null
): ProposedCluster {
  return { key, name, pillarPageId: pillar, pageIds, orphanPageIds: [], themes: [] }
}

const sup = (
  pageId: string,
  movedByUser = false
): { pageId: string; role: 'supporting'; movedByUser: boolean } => ({
  pageId,
  role: 'supporting',
  movedByUser
})

describe('mergeWithExisting', () => {
  test('keeps renamed names, tracking, moved pages and user clusters; reports changes', () => {
    const old: ExistingCluster[] = [
      existing({
        id: 'c1',
        name: 'Carrier stuff',
        renamedByUser: true,
        editedByUser: true,
        trackWhole: true,
        pages: [sup('a'), sup('b'), sup('c'), sup('x', true)]
      }),
      existing({ id: 'c2', name: 'Old topic', pages: [sup('d'), sup('e')] }),
      existing({ id: 'u1', name: 'Mine', madeBy: 'user', pages: [sup('f')] })
    ]
    const plan = mergeWithExisting(
      old,
      [
        proposal('blog|carrier', 'Carrier', ['a', 'b', 'c', 'x', 'f'], 'a'),
        proposal('blog|new', 'New', ['d', 'e', 'g'])
      ],
      'claude'
    )
    const c1 = plan.clusters.find((cluster) => cluster.id === 'c1')
    expect(c1?.name).toBe('Carrier stuff')
    expect(c1?.trackWhole).toBe(true)
    expect(c1?.madeBy).toBe('claude')
    expect(c1?.pages.map((item) => item.pageId).sort()).toEqual(['a', 'b', 'c', 'x'])
    expect(c1?.pages.find((item) => item.pageId === 'a')?.role).toBe('pillar')
    expect(c1?.pages.find((item) => item.pageId === 'x')?.movedByUser).toBe(true)
    expect(plan.clusters.find((cluster) => cluster.id === 'u1')?.pages).toEqual([sup('f')])
    const reused = plan.clusters.find((cluster) => cluster.topicKey === 'blog|new')
    expect(reused?.id).toBe('c2')
    expect(reused?.name).toBe('New')
    expect(plan.changes.at(-1)).toBe(
      'Your manual edits are kept: 1 renamed cluster, 1 cluster you made and 1 page you moved.'
    )
  })

  test('unmatched proposals are new, empty old clusters are removed', () => {
    const plan = mergeWithExisting(
      [existing({ id: 'c1', name: 'Old', pages: [sup('a'), sup('b')] })],
      [proposal('blog|fresh', 'Fresh', ['a', 'z', 'y', 'w'])],
      'rules'
    )
    expect(plan.clusters).toHaveLength(1)
    expect(plan.clusters[0]?.id).toBeNull()
    expect(plan.changes).toEqual(['New cluster "Fresh" (4 pages).', 'Removed cluster "Old".'])
  })

  test('an old cluster keeps a page the user moved into it even when nothing else matches', () => {
    const plan = mergeWithExisting(
      [
        existing({
          id: 'c1',
          name: 'Old',
          pillarPageId: 'm',
          pages: [sup('a'), { pageId: 'm', role: 'pillar', movedByUser: true }]
        })
      ],
      [proposal('blog|other', 'Other', ['a', 'b', 'c'])],
      'rules'
    )
    const kept = plan.clusters.find((cluster) => cluster.id === 'c1')
    expect(kept?.pages).toEqual([{ pageId: 'm', role: 'pillar', movedByUser: true }])
    expect(kept?.pillarPageId).toBe('m')
  })

  test('reports moves between matched clusters', () => {
    const plan = mergeWithExisting(
      [
        existing({ id: 'c1', name: 'A', pages: ['a', 'b', 'c', 'd'].map((id) => sup(id)) }),
        existing({ id: 'c2', name: 'B', pages: ['e', 'f', 'g'].map((id) => sup(id)) })
      ],
      [proposal('k|a', 'A', ['a', 'b', 'c']), proposal('k|b', 'B', ['d', 'e', 'f', 'g'])],
      'rules'
    )
    expect(plan.changes).toEqual(['1 page moves from "A" to "B".'])
  })
})

describe('assignToCluster', () => {
  const clusters = [
    { id: 'other', topicKey: 'blog|_other' },
    { id: 'feat', topicKey: 'features|*' },
    { id: 'dlc', topicKey: 'blog|10dlc' },
    { id: 'gw', topicKey: 'blog|email gateway' },
    { id: 'none', topicKey: null }
  ]

  test('matches a topic word, a bigram, or a whole small folder', () => {
    expect(assignToCluster({ url: `${SITE}/blog/10dlc-for-schools/`, title: null }, clusters)).toBe(
      'dlc'
    )
    expect(
      assignToCluster({ url: `${SITE}/blog/free-email-gateway/`, title: null }, clusters)
    ).toBe('gw')
    expect(assignToCluster({ url: `${SITE}/features/new-thing/`, title: null }, clusters)).toBe(
      'feat'
    )
    expect(assignToCluster({ url: `${SITE}/blog/office-party/`, title: null }, clusters)).toBeNull()
  })
})

describe('topic choice on the TextBolt sitemap', () => {
  test('format words and the core vocabulary do not become topics', async () => {
    const { textboltSitemapFixture } = await import('./fixtures/textbolt-sitemaps')
    const urls = textboltSitemapFixture('base').pageUrls
    const clusters = clusterByTopic(
      urls.map((url, index) => ({
        id: `p${index}`,
        url,
        title: null,
        promptTexts: [],
        tracked: false
      }))
    )
    const blogTopics = clusters
      .filter((cluster) => cluster.key.startsWith('blog|') && !cluster.key.endsWith('_other'))
      .map((cluster) => cluster.key.slice('blog|'.length))
    for (const word of ['guide', 'faq', 'explained', 'checklist', 'text', 'tip']) {
      expect(blogTopics).not.toContain(word)
    }
    expect(blogTopics).toContain('10dlc')
    const other = clusters.find((cluster) => cluster.key === 'blog|_other')
    expect(other?.pageIds.length ?? 0).toBeLessThan(urls.length * 0.15)
  })
})
