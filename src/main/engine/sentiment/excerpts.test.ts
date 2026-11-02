import { describe, expect, test } from 'vitest'
import { ownExcerpts, type ExcerptPage } from './excerpts'

const BLOG: ExcerptPage = {
  url: 'https://textbolt.com/blog/text-alerts/',
  title: 'Text alerts for business',
  text: 'Carrier gateways are shutting down. Send alerts from Outlook or Gmail with no code. Your team gets texts in seconds. TextBolt works with Datadog and alarm panels.'
}

const PRICING: ExcerptPage = {
  url: 'https://textbolt.com/pricing/',
  title: 'Pricing',
  text: 'Choose a plan. The Basic plan is $29 a month with 500 credits. The Standard plan is $49 a month with 1,000 credits and up to 10 users. All plans include a free test alert.'
}

const PRICE_CLAIM = {
  theme: 'Pricing',
  attribute: 'starts at $19 a month',
  sentence: 'TextBolt pricing starts at $19 a month for 500 texts.'
}

describe('own-page excerpts for the fact check', () => {
  test('a price claim quotes the pricing page passage, not the whole site', () => {
    const excerpts = ownExcerpts([BLOG, PRICING], [PRICE_CLAIM], ['TextBolt'])
    expect(excerpts.urls).toEqual(['https://textbolt.com/pricing/'])
    expect(excerpts.text).toContain('[https://textbolt.com/pricing/] Pricing')
    expect(excerpts.text).toContain('$29 a month with 500 credits')
    expect(excerpts.text).not.toContain('Carrier gateways')
    expect(excerpts.text.startsWith('<page_text>\n')).toBe(true)
  })

  test('the brand name alone never makes a passage relevant', () => {
    const excerpts = ownExcerpts(
      [BLOG],
      [
        { theme: 'Support', attribute: 'slow email replies', sentence: 'TextBolt support is slow.' }
      ],
      ['TextBolt']
    )
    expect(excerpts.passages).toBe(0)
    expect(excerpts.urls).toEqual([])
    expect(excerpts.text).toContain('No own page text speaks to these claims.')
  })

  test('word forms meet ("starts" and "start", "plans" and "plan")', () => {
    const page: ExcerptPage = {
      url: 'https://textbolt.com/',
      title: null,
      text: 'TextBolt sends text alerts from email. Plans start at $29 a month. No developer required.'
    }
    expect(ownExcerpts([page], [PRICE_CLAIM], ['TextBolt']).passages).toBe(1)
  })

  test('at most eight passages in all, each short', () => {
    const long: ExcerptPage = {
      url: 'https://textbolt.com/pricing/',
      title: 'Pricing',
      text: Array.from(
        { length: 40 },
        (_, i) => `Plan ${i} costs $${i} a month for 500 texts.`
      ).join(' ')
    }
    const claims = Array.from({ length: 6 }, () => PRICE_CLAIM)
    const excerpts = ownExcerpts([long], claims, ['TextBolt'])
    expect(excerpts.passages).toBeLessThanOrEqual(8)
    expect(excerpts.text.length).toBeLessThan(8 * 380 + 200)
  })
})
