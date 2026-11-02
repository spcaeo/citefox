import { describe, expect, test } from 'vitest'
import { textboltSitemapFixture } from '../structure/fixtures/textbolt-sitemaps'
import {
  buildSections,
  matchUrls,
  pageKind,
  rulePicks,
  sectionLabel,
  shortlist,
  type StartPageRow
} from './candidates'

function rows(urls: readonly string[], tracked: ReadonlySet<string> = new Set()): StartPageRow[] {
  return urls.map((url, index) => ({
    id: `page-${index}`,
    url,
    title: null,
    tracked: tracked.has(url)
  }))
}

const TEXTBOLT = rows(textboltSitemapFixture('base').pageUrls)

describe('pageKind', () => {
  test.each([
    ['https://textbolt.com/pricing/', 'pricing'],
    ['https://textbolt.com/compare/textbolt-vs-twilio/', 'compare'],
    ['https://textbolt.com/blog/bulk-sms-vs-email/', 'guide'],
    ['https://textbolt.com/textbolt-vs-twilio/', 'compare'],
    ['https://textbolt.com/alternatives/twilio-alternatives/', 'alternatives'],
    ['https://textbolt.com/use-cases/healthcare/staff-alerts/', 'use_case'],
    ['https://textbolt.com/features/email-to-sms/', 'feature'],
    ['https://textbolt.com/integrations/zapier/', 'integration'],
    ['https://textbolt.com/blog/email-to-sms-guide/', 'guide'],
    ['https://textbolt.com/about/', 'other']
  ])('%s is %s', (url, kind) => {
    expect(pageKind(url)).toBe(kind)
  })
})

describe('buildSections', () => {
  test('groups the TextBolt sitemap by top folder, biggest first, with samples', () => {
    const sections = buildSections(TEXTBOLT)
    expect(sections[0]).toMatchObject({ key: '/blog/', label: 'Blog' })
    expect(sections.reduce((sum, section) => sum + section.pageCount, 0)).toBe(TEXTBOLT.length)
    const compare = sections.find((section) => section.key === '/compare/')
    expect(compare?.pageCount).toBe(24)
    expect(compare?.samples).toHaveLength(3)
    expect(sections.find((section) => section.key === '/')?.label).toBe('Top-level pages')
  })

  test("a folder's landing page joins its folder", () => {
    const sections = buildSections(
      rows(['https://x.com/features/', 'https://x.com/features/a/', 'https://x.com/about/'])
    )
    expect(sections.find((section) => section.key === '/features/')?.pageCount).toBe(2)
    expect(sections.find((section) => section.key === '/')?.pageCount).toBe(1)
  })

  test('counts tracked pages', () => {
    const tracked = new Set(['https://x.com/a/b/'])
    const [section] = buildSections(rows(['https://x.com/a/b/', 'https://x.com/a/c/'], tracked))
    expect(section).toMatchObject({ pageCount: 2, trackedCount: 1 })
  })

  test('labels', () => {
    expect(sectionLabel('/use-cases/')).toBe('Use cases')
    expect(sectionLabel('/')).toBe('Top-level pages')
  })
})

describe('shortlist', () => {
  test('best kinds first and capped, so Claude never sees 1,400 blog posts', () => {
    const list = shortlist(TEXTBOLT)
    expect(list.length).toBeLessThanOrEqual(200)
    expect(list[0]?.url).toBe('https://textbolt.com/pricing/')
    expect(list.filter((page) => pageKind(page.url) === 'guide').length).toBeLessThanOrEqual(20)
    expect(list.some((page) => pageKind(page.url) === 'compare')).toBe(true)
  })
})

describe('rulePicks', () => {
  test('pricing, a comparison with a named competitor, alternatives, use case, feature', () => {
    const picks = rulePicks(TEXTBOLT, buildSections(TEXTBOLT), ['simpletexting.com'])
    expect(picks.map((page) => page.kind)).toEqual([
      'pricing',
      'compare',
      'alternatives',
      'use_case',
      'feature'
    ])
    expect(picks[1]?.url).toBe('https://textbolt.com/compare/textbolt-vs-simpletexting/')
    expect(picks[1]?.evidence).toBe('Sitemap: Compare section, 24 pages.')
    expect(picks.every((page) => page.reason.length > 0 && !page.alreadyTracked)).toBe(true)
  })

  test('tops up to three from the shortlist on a small site, skipping tracked pages', () => {
    const tracked = new Set(['https://x.com/pricing/'])
    const pages = rows(
      ['https://x.com/', 'https://x.com/pricing/', 'https://x.com/about/', 'https://x.com/team/'],
      tracked
    )
    const picks = rulePicks(pages, buildSections(pages), [])
    expect(picks).toHaveLength(3)
    expect(picks.map((page) => page.url)).not.toContain('https://x.com/pricing/')
  })

  test('an empty sitemap gives no picks', () => {
    expect(rulePicks([], [], [])).toEqual([])
  })
})

describe('matchUrls', () => {
  test('path words match, shortest first, with the section', () => {
    const result = matchUrls(TEXTBOLT, 'pricing', 5)
    expect(result.suggestions[0]).toMatchObject({
      url: 'https://textbolt.com/pricing/',
      path: '/pricing/',
      section: 'Top-level pages'
    })
  })

  test('a full URL or a path prefix matches', () => {
    const byUrl = matchUrls(TEXTBOLT, 'https://textbolt.com/compare/textbolt-vs-tw', 3)
    expect(byUrl.suggestions[0]?.url).toBe('https://textbolt.com/compare/textbolt-vs-twilio/')
    const byPath = matchUrls(TEXTBOLT, '/features/email', 50)
    expect(byPath.total).toBeGreaterThan(0)
    expect(byPath.suggestions.every((row) => row.path.startsWith('/features/email'))).toBe(true)
  })

  test('empty query lists the best pages; the limit caps the list but not the total', () => {
    const result = matchUrls(TEXTBOLT, '', 4)
    expect(result.suggestions).toHaveLength(4)
    expect(result.total).toBe(TEXTBOLT.length)
    expect(result.suggestions[0]?.path).toBe('/pricing/')
  })

  test('no match', () => {
    expect(matchUrls(TEXTBOLT, 'zzz-nothing', 5)).toEqual({ suggestions: [], total: 0 })
  })
})
