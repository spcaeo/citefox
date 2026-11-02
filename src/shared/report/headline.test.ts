import { describe, expect, test } from 'vitest'
import { oneLineHeadline, type HeadlineInput } from './headline'
import { sampleWarning } from './method'

const base: HeadlineInput = {
  tracked: 10,
  measured: 10,
  aio: 8,
  cited: 3,
  noun: 'buyer prompts',
  topSite: null,
  change: null
}

describe('one-sentence headline', () => {
  test('nothing measured, and no AI Overview yet', () => {
    expect(oneLineHeadline({ ...base, measured: 0, aio: 0, cited: 0 })).toBe(
      'None of your buyer prompts have been measured yet.'
    )
    expect(oneLineHeadline({ ...base, aio: 0, cited: 0 })).toBe(
      'Google shows no AI Overview for any of your 10 buyer prompts yet.'
    )
  })

  test('cited, with the most cited other site ahead, level or behind', () => {
    expect(oneLineHeadline(base)).toBe(
      "Google's AI Overviews cite you in 3 of 8 answers to your buyer prompts."
    )
    expect(oneLineHeadline({ ...base, topSite: { name: 'twilio.com', count: 5 } })).toBe(
      "Google's AI Overviews cite you in 3 of 8 answers to your buyer prompts; twilio.com is cited in 5."
    )
    expect(oneLineHeadline({ ...base, topSite: { name: 'twilio.com', count: 3 } })).toBe(
      "Google's AI Overviews cite you in 3 of 8 answers to your buyer prompts, level with twilio.com."
    )
    expect(oneLineHeadline({ ...base, topSite: { name: 'twilio.com', count: 2 } })).toBe(
      "Google's AI Overviews cite you in 3 of 8 answers to your buyer prompts, more than any other site."
    )
  })

  test('not cited at all names the site that is', () => {
    expect(oneLineHeadline({ ...base, cited: 0, topSite: { name: 'reddit.com', count: 4 } })).toBe(
      'Google shows an AI Overview for 8 of your 10 buyer prompts and cites you in none of them; reddit.com is cited in 4.'
    )
  })

  test('the change since the earlier check: up, down, unchanged, or both ways', () => {
    const since = (gained: number, lost: number): string =>
      oneLineHeadline({ ...base, change: { gained, lost, label: 'the 5 Oct 2026 check' } })
    expect(since(2, 0)).toContain(
      '3 of 8 answers to your buyer prompts, up 2 since the 5 Oct 2026 check.'
    )
    expect(since(1, 3)).toContain(', down 2 since the 5 Oct 2026 check.')
    expect(since(0, 0)).toContain(', unchanged since the 5 Oct 2026 check.')
    expect(since(2, 2)).toContain(', with 2 gained and 2 lost since the 5 Oct 2026 check.')
  })

  test('every number in the sentence is one of the inputs or their difference', () => {
    const text = oneLineHeadline({
      ...base,
      topSite: { name: 'twilio.com', count: 5 },
      change: { gained: 3, lost: 1, label: 'the previous full check' }
    })
    const numbers = (text.match(/\d+/g) ?? []).map(Number)
    expect(numbers).toEqual([3, 8, 2, 5])
  })
})

describe('sample-size warning', () => {
  test('below 10 measured questions only, and not for none', () => {
    expect(sampleWarning(0)).toBeNull()
    expect(sampleWarning(10)).toBeNull()
    expect(sampleWarning(1)).toContain('only 1 question was measured')
    expect(sampleWarning(9)).toBe(
      'Small sample: only 9 questions were measured, so one question moves every rate a lot. Read the rates as early signs, not trends.'
    )
  })
})
