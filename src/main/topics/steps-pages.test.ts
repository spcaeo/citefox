import { describe, expect, test } from 'vitest'
import { briefProblem, candidatesText, matchProblem, stageLine } from './steps-pages'

const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ')

describe('page match', () => {
  test('the candidate list is fenced and shows headings and the opening text', () => {
    const text = candidatesText(
      [
        {
          pageId: 'page-1',
          url: 'https://textbolt.com/faq',
          title: 'FAQ',
          outline: ['Is it HIPAA compliant?', 'Can we track who sent what message?'],
          source: 'tracked'
        },
        {
          pageId: null,
          url: 'https://textbolt.com/pricing',
          title: null,
          outline: [],
          source: 'sitemap'
        }
      ],
      new Map([['https://textbolt.com/faq', 'Answers   to common questions.']])
    )
    expect(text.startsWith('<pages>\n')).toBe(true)
    expect(text).toContain(
      'https://textbolt.com/faq · FAQ · Is it HIPAA compliant? | Can we track who sent what message? · Answers to common questions.'
    )
    expect(text).toContain('https://textbolt.com/pricing ·  · no headings read · text not read')
  })

  test('every id answered once, urls only from the list', () => {
    const urls = new Set(['https://textbolt.com/faq'])
    const ok = { id: 'p1', url: 'https://textbolt.com/faq', confidence: 80, reason: 'FAQ' }
    expect(matchProblem({ matches: [ok] }, ['p1'], urls)).toBeNull()
    expect(matchProblem({ matches: [ok, ok] }, ['p1'], urls)).toMatch(/answered twice/u)
    expect(matchProblem({ matches: [{ ...ok, id: 'p9' }] }, ['p1'], urls)).toMatch(/not one of/u)
    expect(
      matchProblem({ matches: [{ ...ok, url: 'https://textbolt.com/blog' }] }, ['p1'], urls)
    ).toMatch(/not in the candidate list/u)
    expect(matchProblem({ matches: [{ ...ok, url: null }] }, ['p1', 'p2'], urls)).toMatch(
      /missing: p2/u
    )
  })
})

describe('page brief', () => {
  const outline = ['Who texted whom', 'Set up from Gmail', 'Privacy', 'FAQ']

  test('checks the outline, the FAQ heading and the word range', () => {
    expect(briefProblem({ summary: 'S', outline, text: words(150) })).toBeNull()
    expect(briefProblem({ summary: 'S', outline: outline.slice(0, 3), text: words(150) })).toMatch(
      /4 to 7 outline headings/u
    )
    expect(briefProblem({ summary: 'S', outline: ['A', 'B', 'C', 'D'], text: words(150) })).toMatch(
      /FAQ heading/u
    )
    expect(briefProblem({ summary: 'S', outline, text: words(60) })).toMatch(/has 60 words/u)
  })

  test('the stage line carries its definition', () => {
    expect(stageLine(null)).toBe('No stage')
    expect(stageLine('doubts')).toMatch(/^.+: they worry about cost/u)
  })
})
