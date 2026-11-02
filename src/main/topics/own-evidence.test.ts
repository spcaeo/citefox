import { describe, expect, test } from 'vitest'
import { isRealRead, ownEvidencePages, relevantExcerpt } from './own-evidence'
import type { SiteRead } from './records'

function read(url: string, title: string, text: string): SiteRead {
  return {
    url,
    role: 'home',
    ok: true,
    title,
    metaDescription: null,
    h1: null,
    outline: [],
    faqCount: 0,
    wordCount: text.split(/\s+/u).length,
    text,
    method: 'jina',
    readAt: '2026-10-22T10:00:00.000Z'
  }
}

describe('own evidence (P4)', () => {
  test('a "page could not be found" read is not evidence', () => {
    const missing = read(
      'https://textbolt.com/features',
      'This page could not be found',
      'Sorry, the page you are looking for is gone. Go back home and try again later please.'
    )
    expect(isRealRead(missing)).toBe(false)
    expect(
      isRealRead(read('https://textbolt.com/', 'TextBolt', 'Send texts from email today.'))
    ).toBe(true)
  })

  test('a long page keeps its opening and the paragraphs about the subject, in page order', () => {
    const text = [
      '# Email to text for teams',
      ...Array.from(
        { length: 30 },
        (_, index) => `Unrelated paragraph number ${index} about the company history.`
      ),
      'Start Free Trial',
      'Alarm panels can email TextBolt and every phone gets a text.'
    ].join('\n')
    const excerpt = relevantExcerpt(text, 'alarm panel text alerts free trial', 200)
    expect(excerpt.startsWith('# Email to text for teams')).toBe(true)
    expect(excerpt).toContain('Alarm panels can email TextBolt')
    expect(excerpt).toContain('Start Free Trial')
    expect(excerpt).not.toContain('Unrelated paragraph number 5')
  })

  test('pages come back as paths with titles', () => {
    const pages = ownEvidencePages(
      [read('https://textbolt.com/pricing', 'Pricing', 'Plans from $29 a month for small teams.')],
      'pricing',
      500
    )
    expect(pages).toEqual([
      { path: '/pricing', title: 'Pricing', text: 'Plans from $29 a month for small teams.' }
    ])
  })
})
