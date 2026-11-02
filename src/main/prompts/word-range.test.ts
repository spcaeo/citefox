import { describe, expect, test } from 'vitest'
import { briefProblem, BRIEF_WORDS } from '../topics/steps-pages'
import { fixDraftProblem, trimFixDraft } from './citations'
import { tolerantRange, trimToWords, withinTolerance, wordsAskedOnce } from './word-range'

const words = (count: number, word = 'word'): string => Array(count).fill(word).join(' ')
/** `count` sentences of ten words each. */
const sentences = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) => `Sentence ${index + 1} has exactly ten words in it right here.`
  ).join(' ')

describe('word ranges guide, never fail a run over a small miss', () => {
  test('about 10% either side is accepted: a 254-word brief passes, 276 does not', () => {
    expect(tolerantRange(BRIEF_WORDS)).toEqual({ min: 108, max: 275 })
    expect(withinTolerance(254, BRIEF_WORDS)).toBe(true)
    expect(withinTolerance(275, BRIEF_WORDS)).toBe(true)
    expect(withinTolerance(276, BRIEF_WORDS)).toBe(false)
    const outline = ['Answer', 'Setup', 'Costs', 'FAQ']
    expect(briefProblem({ summary: 'S', outline, text: words(254) })).toBeNull()
    expect(briefProblem({ summary: 'S', outline, text: words(300) })).toMatch(/has 300 words/u)
  })

  test('the count is named once; after that only the shape can fail', () => {
    const check = wordsAskedOnce<{ ok: boolean; words: number }>(
      (value) => (value.ok ? null : 'Bad shape.'),
      (value) => (value.words > 10 ? `Has ${value.words} words.` : null)
    )
    expect(check({ ok: true, words: 40 })).toBe('Has 40 words.')
    expect(check({ ok: true, words: 40 })).toBeNull()
    expect(check({ ok: false, words: 5 })).toBe('Bad shape.')
  })

  test('text over the limit is cut at the last sentence that fits', () => {
    const text = sentences(30)
    const trimmed = trimToWords(text, 275)
    expect(trimmed.endsWith('here.')).toBe(true)
    expect(trimmed.split(/\s+/u)).toHaveLength(270)
    expect(trimToWords('Short text.', 10)).toBe('Short text.')
    expect(trimToWords(words(20), 5)).toBe('word word word word word…')
  })

  test('a fix draft keeps its question line and loses only the sentences past the limit', () => {
    const draft = `How do we text staff from Outlook?\n${sentences(12)}`
    expect(fixDraftProblem(draft)).toMatch(/120 words/u)
    const trimmed = trimFixDraft(draft)
    expect(trimmed.split('\n')[0]).toBe('How do we text staff from Outlook?')
    expect(fixDraftProblem(trimmed)).toBeNull()
    expect(trimFixDraft(`How do we text staff from Outlook?\n${sentences(6)}`)).toBe(
      `How do we text staff from Outlook?\n${sentences(6)}`
    )
  })
})
