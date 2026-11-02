import { describe, expect, test } from 'vitest'
import { sitemapsFromRobots } from '../robots'
import { parseSitemapXml, type SitemapUrlEntry } from '../sitemap-parse'
import { isOwnDomainUrl } from '../url-rules'
import { TEXTBOLT_FIXTURE_NOW, textboltSitemapFixture } from './textbolt-sitemaps'

function urlsOf(files: ReadonlyMap<string, string>, name: string): SitemapUrlEntry[] {
  const body = files.get(`https://textbolt.com/${name}`)
  if (body === undefined) throw new Error(`missing ${name}`)
  const parsed = parseSitemapXml(body)
  if (parsed.kind !== 'urlset') throw new Error(`${name} is not a urlset`)
  return parsed.urls
}

const INCLUDED = [
  'post-sitemap.xml',
  'page-sitemap.xml',
  'feature-sitemap.xml',
  'use-case-sitemap.xml',
  'integration-sitemap.xml',
  'compare-sitemap.xml'
]

describe('textboltSitemapFixture', () => {
  test('base: robots → index → 2,014 unique own-domain pages plus a tag sitemap', () => {
    const started = Date.now()
    const { files, pageUrls } = textboltSitemapFixture()
    expect(Date.now() - started).toBeLessThan(500)
    const robots = files.get('https://textbolt.com/robots.txt') ?? ''
    expect(sitemapsFromRobots(robots, 'https://textbolt.com/robots.txt')).toEqual([
      'https://textbolt.com/sitemap_index.xml'
    ])
    const index = parseSitemapXml(files.get('https://textbolt.com/sitemap_index.xml') ?? '')
    if (index.kind !== 'index') throw new Error('expected an index')
    expect(index.sitemaps.map((entry) => entry.loc)).toEqual(
      [...INCLUDED, 'tag-sitemap.xml'].map((name) => `https://textbolt.com/${name}`)
    )
    expect(index.sitemaps.every((entry) => entry.lastmod !== null)).toBe(true)

    const included = INCLUDED.flatMap((name) => urlsOf(files, name))
    expect(included).toHaveLength(2014)
    expect(new Set(included.map((entry) => entry.loc)).size).toBe(2014)
    expect(pageUrls).toEqual(included.map((entry) => entry.loc))
    expect(pageUrls.every((url) => isOwnDomainUrl(url, 'textbolt.com', false))).toBe(true)
    expect(urlsOf(files, 'post-sitemap.xml')).toHaveLength(1420)
    expect(urlsOf(files, 'feature-sitemap.xml')).toHaveLength(96)
    expect(urlsOf(files, 'compare-sitemap.xml')).toHaveLength(48)
    expect(urlsOf(files, 'tag-sitemap.xml')).toHaveLength(312)

    expect(pageUrls).toContain('https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/')
    expect(pageUrls).toContain(
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-businesses/'
    )
    expect(pageUrls).toContain('https://textbolt.com/blog/carrier-email-to-text-list-2024/')
    expect(pageUrls).toContain('https://textbolt.com/pricing/')
    expect(pageUrls).toContain('https://textbolt.com/features/bulk-sms/')
    expect(
      pageUrls.some((url) => url.startsWith('https://textbolt.com/use-cases/healthcare/'))
    ).toBe(true)
    const templates = pageUrls.filter((url) => url.includes('/use-cases/text-messaging-for-'))
    expect(templates.length).toBeGreaterThanOrEqual(8)
  })

  test('base: about 200 pages changed in the last 90 days', () => {
    const { files } = textboltSitemapFixture()
    const cutoff = Date.parse(TEXTBOLT_FIXTURE_NOW) - 90 * 86_400_000
    const recent = INCLUDED.flatMap((name) => urlsOf(files, name)).filter(
      (entry) => entry.lastmod !== null && Date.parse(entry.lastmod) >= cutoff
    )
    expect(recent.length).toBeGreaterThan(150)
    expect(recent.length).toBeLessThan(260)
  })

  test('next: 6 new, 1 removed, 14 changed', () => {
    const base = textboltSitemapFixture('base')
    const next = textboltSitemapFixture('next')
    expect(next.pageUrls).toHaveLength(2019)
    const before = new Map(
      INCLUDED.flatMap((name) => urlsOf(base.files, name)).map((entry) => [
        entry.loc,
        entry.lastmod
      ])
    )
    const after = new Map(
      INCLUDED.flatMap((name) => urlsOf(next.files, name)).map((entry) => [
        entry.loc,
        entry.lastmod
      ])
    )
    const added = [...after.keys()].filter((url) => !before.has(url))
    const removed = [...before.keys()].filter((url) => !after.has(url))
    const changed = [...after.entries()].filter(
      ([url, lastmod]) => before.has(url) && before.get(url) !== lastmod
    )
    expect(added.sort()).toEqual(
      [
        'https://textbolt.com/blog/verizon-vtext-com-shutdown/',
        'https://textbolt.com/blog/schedule-text-from-outlook/',
        'https://textbolt.com/blog/grafana-sms-alerts/',
        'https://textbolt.com/blog/sms-alerts-for-hvac-teams/',
        'https://textbolt.com/use-cases/property-management/',
        'https://textbolt.com/compare/textbolt-vs-pagerduty/'
      ].sort()
    )
    expect(removed).toEqual(['https://textbolt.com/blog/carrier-email-to-text-list-2024/'])
    expect(changed).toHaveLength(14)
    expect(changed.map(([url]) => url)).toContain(
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
    )
  })

  test('is deterministic', () => {
    const first = textboltSitemapFixture('next')
    const second = textboltSitemapFixture('next')
    expect([...first.files.entries()]).toEqual([...second.files.entries()])
  })
})
