import { describe, expect, test } from 'vitest'
import { agreementLine, checkAgreement, type AgreementItem } from './method'

describe('checkAgreement', () => {
  test('null when no question was searched by both a page check and a topic check', () => {
    expect(
      checkAgreement([
        { id: 'p1', text: 'How do I text my crew?', marketId: 'us', source: 'page', cited: true },
        { id: 't1', text: 'Best SMS app?', marketId: 'us', source: 'topic', cited: false }
      ])
    ).toBeNull()
  })

  test('matches the same wording in the same market, ignoring case and punctuation', () => {
    const items: AgreementItem[] = [
      { id: 'p1', text: 'How do I text my crew?', marketId: 'us', source: 'page', cited: true },
      { id: 't1', text: 'how do I text my crew', marketId: 'us', source: 'topic', cited: true },
      {
        id: 'p2',
        text: 'Which plan has scheduling?',
        marketId: 'us',
        source: 'page',
        cited: false
      },
      {
        id: 't2',
        text: 'Which plan has scheduling?',
        marketId: 'us',
        source: 'topic',
        cited: true
      },
      {
        id: 'p3',
        text: 'Which plan has scheduling?',
        marketId: 'uk',
        source: 'page',
        cited: false
      },
      { id: 'p4', text: 'Is email to SMS free?', marketId: 'us', source: 'page', cited: false },
      { id: 't4', text: 'Is email to SMS free?', marketId: 'us', source: 'topic', cited: false }
    ]
    const agreement = checkAgreement(items)
    expect(agreement).toEqual({
      total: 3,
      agree: 2,
      percent: 67,
      totalIds: ['p1', 'p2', 'p4'],
      agreeIds: ['p1', 'p4']
    })
    expect(agreementLine(agreement!)).toMatch(/^Both checks agree on 2 of 3 questions \(67%\): /)
  })
})
