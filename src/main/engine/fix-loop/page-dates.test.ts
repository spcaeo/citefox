import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { extractHtml, extractMarkdown } from '../../pipeline/extract'
import { parseVisibleDate, visibleDates } from './page-dates'

const FIXTURES = join(process.cwd(), 'src/main/engine/fix-loop/fixtures')

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

describe('parseVisibleDate', () => {
  test.each([
    ['Oct 15, 2026', '2026-10-15'],
    ['Oct. 15, 2026', '2026-10-15'],
    ['October 15, 2026', '2026-10-15'],
    ['october 5 2026', '2026-10-05'],
    ['Sept 3, 2026', '2026-09-03'],
    ['15 October 2026', '2026-10-15'],
    ['15 Oct 2026', '2026-10-15'],
    ['2026-10-15', '2026-10-15'],
    ['2026-10-15T09:00:00Z', '2026-10-15']
  ])('reads %s', (raw, expected) => {
    expect(parseVisibleDate(raw)).toBe(expected)
  })

  test.each([
    'Feb 30, 2026',
    '2026-02-30',
    '31 April 2026',
    '2026-13-01',
    'Foo 15, 2026',
    '20261015',
    'yesterday'
  ])('rejects %s', (raw) => {
    expect(parseVisibleDate(raw)).toBeNull()
  })

  test('accepts Feb 29 only in a leap year', () => {
    expect(parseVisibleDate('Feb 29, 2028')).toBe('2028-02-29')
    expect(parseVisibleDate('Feb 29, 2026')).toBeNull()
  })
})

describe('visibleDates', () => {
  test.each([
    ['Updated on Oct 15, 2026'],
    ['Last updated: Oct 15, 2026'],
    ['Last updated on October 15, 2026'],
    ['Updated: 15 Oct 2026'],
    ['Modified on 2026-10-15'],
    ['LAST UPDATED: oct. 15, 2026']
  ])('reads the updated date from "%s"', (text) => {
    expect(visibleDates(`Intro text. ${text}. More text.`)).toEqual({
      publishedAt: null,
      modifiedAt: '2026-10-15'
    })
  })

  test.each([
    ['Published on October 1, 2026'],
    ['Published: 1 October 2026'],
    ['Posted on Oct 1, 2026'],
    ['published on 2026-10-01']
  ])('reads the published date from "%s"', (text) => {
    expect(visibleDates(text)).toEqual({ publishedAt: '2026-10-01', modifiedAt: null })
  })

  test('reads both kinds from one byline', () => {
    expect(visibleDates('Published on October 1, 2026 · Last updated: Oct 15, 2026')).toEqual({
      publishedAt: '2026-10-01',
      modifiedAt: '2026-10-15'
    })
  })

  test('the first date of each kind wins', () => {
    const text =
      'Updated on Oct 15, 2026. Posted on Sep 1, 2026. Updated on Oct 20, 2026. Published on Aug 1, 2026.'
    expect(visibleDates(text)).toEqual({ publishedAt: '2026-09-01', modifiedAt: '2026-10-15' })
  })

  test('skips a label with an impossible date and keeps looking', () => {
    expect(visibleDates('Updated on Feb 30, 2026. Updated on Mar 2, 2026.').modifiedAt).toBe(
      '2026-03-02'
    )
  })

  test('finds nothing when no label is followed by a date', () => {
    expect(
      visibleDates('We updated our pricing. Posted by Sam. Republished 2026-10-01. Outdated: 2026.')
    ).toEqual({ publishedAt: null, modifiedAt: null })
  })

  test('ignores a date that does not follow the label closely', () => {
    expect(visibleDates(`Updated ${'x'.repeat(80)} Oct 15, 2026`).modifiedAt).toBeNull()
  })

  test('stays fast on long hostile text', () => {
    const text = `${'updated   '.repeat(20000)}${' '.repeat(50000)}last${' '.repeat(50000)}`
    const started = performance.now()
    expect(visibleDates(text)).toEqual({ publishedAt: null, modifiedAt: null })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('extractHtml page dates', () => {
  test('article meta tags', () => {
    const page = extractHtml(fixture('page-dates-article-meta.html'))
    expect(page.publishedAt).toBe('2026-09-01T08:00:00Z')
    expect(page.modifiedAt).toBe('2026-10-15T09:30:00Z')
  })

  test('JSON-LD datePublished and dateModified', () => {
    const page = extractHtml(fixture('page-dates-json-ld.html'))
    expect(page.publishedAt).toBe('2026-08-20')
    expect(page.modifiedAt).toBe('2026-10-02')
  })

  test('dates stated in the visible text', () => {
    const page = extractHtml(fixture('page-dates-visible.html'))
    expect(page.publishedAt).toBe('2026-10-01')
    expect(page.modifiedAt).toBe('2026-10-15')
  })

  test('no dates anywhere', () => {
    const page = extractHtml(fixture('page-dates-none.html'))
    expect(page.publishedAt).toBeNull()
    expect(page.modifiedAt).toBeNull()
  })
})

describe('extractMarkdown page dates', () => {
  const markdown = '# Clinic reminders\n\nUpdated on 2026-10-15\n\nReminders cut no-shows.'

  test('falls back to the visible text when the reader gives no dates', () => {
    const page = extractMarkdown(markdown)
    expect(page.modifiedAt).toBe('2026-10-15')
    expect(page.publishedAt).toBeNull()
  })

  test('an empty date from the reader still falls back', () => {
    expect(extractMarkdown(markdown, { modified: '  ' }).modifiedAt).toBe('2026-10-15')
  })

  test('a date the reader gives wins over the visible text', () => {
    const page = extractMarkdown(markdown, {
      published: '2026-09-01T00:00:00Z',
      modified: '2026-10-20T00:00:00Z'
    })
    expect(page.publishedAt).toBe('2026-09-01T00:00:00Z')
    expect(page.modifiedAt).toBe('2026-10-20T00:00:00Z')
  })
})
