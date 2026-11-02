import { describe, expect, test } from 'vitest'
import { findInsights, type InsightPage } from './insights'

const SITE = 'https://textbolt.com'

function page(id: string, path: string, extra: Partial<InsightPage> = {}): InsightPage {
  return {
    id,
    url: `${SITE}${path}`,
    title: null,
    tracked: false,
    clusterId: null,
    role: null,
    wordCount: null,
    promptCount: 0,
    ...extra
  }
}

describe('findInsights', () => {
  test('flags an own-page citation as cannibalization with merge or differentiate copy', () => {
    const pages = [
      page('a', '/blog/text-alerts/', { title: 'Text alerts', tracked: true, clusterId: 'c1' }),
      page('b', '/features/alerts/', { title: 'Alerts feature' })
    ]
    const insights = findInsights({
      pages,
      clusters: [],
      ownCitations: [
        { pageId: 'a', citedPageId: 'b', promptLabel: 'send alerts by text' },
        { pageId: 'a', citedPageId: 'b', promptLabel: 'alerts without a developer' },
        { pageId: 'a', citedPageId: 'a', promptLabel: 'ignored' },
        { pageId: 'a', citedPageId: 'missing', promptLabel: 'ignored' }
      ]
    })
    expect(insights).toHaveLength(1)
    const first = insights[0]
    expect(first?.kind).toBe('cannibalization')
    expect(first?.pageIds).toEqual(['a', 'b'])
    expect(first?.clusterId).toBe('c1')
    expect(first?.body).toContain('"send alerts by text" and 1 more prompts')
    expect(first?.body).toMatch(/Merge the two pages, or differentiate them/)
    expect(first?.id).toMatch(/^cannibalization:[0-9a-f]{12}$/)
  })

  test('finds near-duplicate pages in the same folder only', () => {
    const insights = findInsights({
      pages: [
        page('a', '/blog/how-to-set-up-text-alerts-for-business/'),
        page('b', '/blog/how-to-set-up-text-alerts-for-businesses/'),
        page('c', '/features/how-to-set-up-text-alerts-for-business/'),
        page('d', '/blog/office-party-photos/')
      ],
      clusters: [],
      ownCitations: []
    })
    const dup = insights.filter((item) => item.kind === 'cannibalization')
    expect(dup).toHaveLength(1)
    expect([...(dup[0]?.pageIds ?? [])].sort()).toEqual(['a', 'b'])
  })

  test('flags thin clusters and short tracked pages', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `p${index}`)
    const pages = ids.map((id, index) =>
      page(id, `/industries/${id}-topic-${index}/`, {
        clusterId: 'ind',
        tracked: index === 0,
        wordCount: index === 0 ? 120 : null
      })
    )
    const insights = findInsights({
      pages,
      clusters: [{ id: 'ind', name: 'Industries', pageIds: ids }],
      ownCitations: []
    })
    const thin = insights.filter((item) => item.kind === 'thin_coverage')
    expect(thin.map((item) => item.title)).toEqual([
      'Thin coverage in "Industries"',
      '1 tracked page is short'
    ])
    expect(thin[0]?.body).toBe(
      '12 pages, 1 tracked. Track the pillar and a few supporting pages to see whether AI Overviews cite this topic.'
    )
    expect(thin[0]?.clusterId).toBe('ind')
  })

  test('finds template pages that differ by one word', () => {
    const names = ['churches', 'schools', 'dentists', 'gyms', 'salons', 'plumbers']
    const pages = names.map((name) =>
      page(name, `/use-cases/${name}/`, { title: `Text messaging for ${name}` })
    )
    const insights = findInsights({ pages, clusters: [], ownCitations: [] })
    const template = insights.find((item) => item.kind === 'template_pages')
    expect(template?.title).toBe('6 template pages differ only by one word')
    expect(template?.body).toContain('("text messaging for …")')
    expect(template?.pageIds).toHaveLength(6)
    expect(template?.pageCount).toBe(6)
  })

  test('a flag about more pages than it lists keeps the full count', () => {
    // Live textbolt.com had 25 integration pages on one pattern; the flag listed 20.
    const pages = Array.from({ length: 25 }, (_, index) =>
      page(`i${index}`, `/integration/tool-${index}-email-to-text-alerts/`, {
        title: `Tool${index} email to text alerts`
      })
    )
    const insights = findInsights({ pages, clusters: [], ownCitations: [] })
    const template = insights.find((item) => item.kind === 'template_pages')
    expect(template?.title).toBe('25 template pages differ only by one word')
    expect(template?.pageIds).toHaveLength(20)
    expect(template?.pageCount).toBe(25)
  })

  test('counts orphans and names their clusters', () => {
    const insights = findInsights({
      pages: [
        page('a', '/blog/a/', { role: 'orphan', clusterId: 'c1' }),
        page('b', '/blog/b/', { role: 'orphan', clusterId: 'c1' }),
        page('c', '/blog/c/', { role: 'supporting', clusterId: 'c1' })
      ],
      clusters: [{ id: 'c1', name: 'Blog · other topics', pageIds: ['a', 'b', 'c'] }],
      ownCitations: []
    })
    const orphan = insights.find((item) => item.kind === 'orphan')
    expect(orphan?.title).toBe('2 orphan pages')
    expect(orphan?.body).toContain('Most are in "Blog · other topics".')
    expect(orphan?.clusterId).toBe('c1')
  })

  test('is deterministic, capped at 8, never uses gating words, and stays fast on 2,000 pages', () => {
    const pages: InsightPage[] = []
    for (let index = 0; index < 2000; index += 1) {
      pages.push(
        page(`p${index}`, `/blog/topic-${index % 40}-post-number-${index}/`, {
          title: `Post ${index} about topic ${index % 40}`,
          role: index % 9 === 0 ? 'orphan' : 'supporting',
          clusterId: `c${index % 40}`
        })
      )
    }
    const clusters = Array.from({ length: 40 }, (_, index) => ({
      id: `c${index}`,
      name: `Topic ${index}`,
      pageIds: pages.filter((item) => item.clusterId === `c${index}`).map((item) => item.id)
    }))
    const started = performance.now()
    const first = findInsights({ pages, clusters, ownCitations: [] })
    expect(performance.now() - started).toBeLessThan(1500)
    expect(first.length).toBeLessThanOrEqual(8)
    expect(findInsights({ pages, clusters, ownCitations: [] })).toEqual(first)
    for (const item of first) {
      expect(`${item.title} ${item.body}`).not.toMatch(/\block|unlock|upgrade\b/i)
      expect(item.pageIds.length).toBeLessThanOrEqual(20)
    }
  })
})
