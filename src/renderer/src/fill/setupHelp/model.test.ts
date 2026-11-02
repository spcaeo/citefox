import { describe, expect, it } from 'vitest'
import { SETUP_RESULT } from './fixtures.test-helper'
import { draftFromAnswer, keptQuestions, toggleQuestion, topicsToCreate } from './model'

describe('draftFromAnswer', () => {
  const draft = draftFromAnswer(SETUP_RESULT, 'textbolt.com')

  it('makes a Fill read: products with their buyers, competitors by product, the first market', () => {
    const { fill } = draft
    expect(fill.domain).toBe('textbolt.com')
    expect(fill.products?.map((product) => [product.name, product.buyer])).toEqual([
      ['Email to SMS', 'Office managers'],
      ['Text alerts', 'IT and ops teams']
    ])
    expect(fill.products?.[0]?.evidence?.path).toBe('/email-to-text/')
    expect(fill.products?.[1]?.evidence).toBeNull()
    const [twilio, simple, rival] = fill.competitors
    expect(twilio).toMatchObject({
      domain: 'twilio.com',
      product: 'answer-product-2',
      tier: 'direct'
    })
    expect(simple?.product).toBe('answer-product-1')
    // No domain: the row asks for one; no product named: the first product.
    expect(rival).toMatchObject({ domain: null, domainSource: null, product: 'answer-product-1' })
    expect(fill.suggestedMarket).toMatchObject({ country: 'US', language: 'en', location: null })
    expect(fill.brands).toEqual([])
  })

  it('groups the questions into one topic per product, the rest under General', () => {
    expect(draft.plan.markets.map((market) => market.country)).toEqual(['US', 'CA'])
    expect(
      draft.plan.topics.map((topic) => [topic.name, topic.situation, topic.questions.length])
    ).toEqual([
      ['Email to SMS', 'Staff miss urgent emails', 1],
      ['Text alerts', 'Alerts go unseen at night', 1],
      ['General', '', 1]
    ])
    // An unknown stage starts as Problem.
    expect(draft.plan.topics[2]?.questions[0]?.stage).toBe('problem')
  })

  it('creates only ticked questions, and skips a topic left empty', () => {
    const plan = toggleQuestion(draft.plan, 'row-11')
    expect(keptQuestions(plan)).toBe(2)
    expect(topicsToCreate(plan)).toEqual([
      {
        name: 'Email to SMS',
        situation: 'Staff miss urgent emails',
        questions: [{ text: 'My carrier stopped email to text, what now?', stage: 'problem' }],
        targetUrl: null
      },
      {
        name: 'General',
        situation: '',
        questions: [{ text: 'Which tools send texts without an app?', stage: 'problem' }],
        targetUrl: null
      }
    ])
    expect(topicsToCreate(null)).toEqual([])
  })
})
