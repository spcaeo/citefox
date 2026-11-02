import { describe, expect, it } from 'vitest'
import {
  aioSharePct,
  headlineNoun,
  promptsTrackedText,
  reportHeadline,
  shareScopeText
} from './report-copy'

describe('reportHeadline', () => {
  it('counts every tracked prompt and names failed searches on their own', () => {
    // AU in the live baseline: 10 prompts, 2 searches failed, 8 overviews shown.
    const text = reportHeadline({
      measured: 8,
      failed: 2,
      aio: 8,
      cited: 1,
      named: 0,
      notVisible: 7
    })
    expect(text).toContain('an AI Overview for 8 of your 10 buyer questions (2 searches failed).')
    // The tile uses the same denominator, so the headline and the 80% agree.
    expect(aioSharePct(8, 10)).toBe(80)
  })

  it('keeps the plain sentence when no search failed', () => {
    const text = reportHeadline({ measured: 10, aio: 9, cited: 2, named: 3, notVisible: 6 })
    expect(text.startsWith('Google shows an AI Overview for 9 of your 10 buyer questions.')).toBe(
      true
    )
    expect(text).not.toContain('failed')
  })

  it('says one search failed in the singular', () => {
    const text = reportHeadline({
      measured: 9,
      failed: 1,
      aio: 9,
      cited: 0,
      named: 1,
      notVisible: 8
    })
    expect(text).toContain('9 of your 10 buyer questions (1 search failed).')
  })
})

describe('shareScopeText', () => {
  it('names the links, the questions and the check the share comes from', () => {
    expect(shareScopeText(31, 232, 105)).toBe(
      '31 of 232 links across 105 questions with an overview, latest check'
    )
    expect(shareScopeText(1, 1, 1)).toBe(
      '1 of 1 links across 1 question with an overview, latest check'
    )
  })
})

describe('counts across markets', () => {
  it('says buyer questions in one market and prompt checks across several', () => {
    expect(promptsTrackedText(2, 1)).toBe('2 buyer questions')
    expect(promptsTrackedText(1, 1)).toBe('1 buyer question')
    expect(promptsTrackedText(4, 2)).toBe('4 buyer question checks across 2 markets')
    expect(headlineNoun(1, false)).toBe('buyer questions')
    expect(headlineNoun(1, true)).toBe('buyer questions across your pages')
    expect(headlineNoun(2, false)).toBe('buyer question checks across 2 markets')
    expect(headlineNoun(3, true)).toBe('buyer question checks across your pages and 3 markets')
  })
})
