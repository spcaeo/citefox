import { describe, expect, test } from 'vitest'
import type { OutlineEntry } from './domain'
import { diffOutline, headingSimilarity, normaliseHeading } from './outline-diff'

function h2(text: string): OutlineEntry {
  return { level: 'h2', text, table: false }
}

describe('normaliseHeading', () => {
  test('drops numbering, punctuation, case and accents', () => {
    expect(normaliseHeading('3. Low-code vs No-code!')).toBe('low code vs no code')
    expect(normaliseHeading('Step 2: Résumé  tips')).toBe('resume tips')
  })
})

describe('headingSimilarity', () => {
  test('same text after normalising is 1, a reworded heading stays high', () => {
    expect(headingSimilarity('Pricing', 'pricing.')).toBe(1)
    expect(
      headingSimilarity('How to choose the right platform', 'How to choose the right AI platform')
    ).toBeGreaterThanOrEqual(0.5)
    expect(headingSimilarity('Frequently asked questions', 'Deployment models')).toBe(0)
  })

  test('plurals match', () => {
    expect(headingSimilarity('Top platforms', 'Top platform')).toBe(1)
  })
})

describe('diffOutline', () => {
  test('matches one to one and marks sections with no match on either side', () => {
    const before = [
      h2('Why the way we build apps is changing'),
      h2('Low code vs no code vs AI app builder'),
      h2('How to choose the right platform'),
      h2('Frequently asked questions'),
      { level: 'p', text: 'Intro paragraph', table: false } as OutlineEntry
    ]
    const now = [
      h2('TL;DR'),
      h2('How to choose the right AI low-code platform'),
      h2('Frequently Asked Questions')
    ]
    const diff = diffOutline(before, now)
    expect(diff.before.map((row) => row.match)).toEqual([null, null, 1, 2])
    expect(diff.now.map((row) => row.match)).toEqual([null, 2, 3])
    expect(diff.removed).toBe(2)
    expect(diff.added).toBe(1)
    expect(diff.now[2]?.similarity).toBe(1)
  })

  test('a heading is matched once, to its best pair', () => {
    const diff = diffOutline([h2('Pricing'), h2('Pricing plans')], [h2('Pricing')])
    expect(diff.before.map((row) => row.match)).toEqual([0, null])
    expect(diff.removed).toBe(1)
  })

  test('empty outlines diff to nothing', () => {
    expect(diffOutline([], [])).toEqual({ before: [], now: [], removed: 0, added: 0 })
  })
})
