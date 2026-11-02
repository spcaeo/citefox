import { describe, expect, test } from 'vitest'
import { normaliseQuestion, questionMergeKey } from './question-text'

describe('questionMergeKey', () => {
  test('drops years, articles and "any", makes simple plurals singular, folds case and accents', () => {
    expect(questionMergeKey('The best SMS gateways for alarm panels in 2026?')).toBe(
      'best sms gateway for alarm panel in'
    )
    expect(questionMergeKey('best sms gateway for an alarm panel in')).toBe(
      questionMergeKey('Best SMS gateways for alarm panels in 2025')
    )
    expect(questionMergeKey('Are there any companies that text?')).toBe(
      questionMergeKey('are there companies that text')
    )
    expect(questionMergeKey('Café   alerts — 1999 edition')).toBe('cafe alert edition')
  })

  test('keeps word order and words that change the meaning', () => {
    expect(questionMergeKey('email to sms')).not.toBe(questionMergeKey('sms to email'))
    expect(questionMergeKey('send texts to my staff')).not.toBe(
      questionMergeKey('send texts to staff')
    )
    // "ss", "us" and "is" endings are not plurals.
    expect(questionMergeKey('business status analysis')).toBe('business status analysis')
    // Numbers that are not years stay.
    expect(questionMergeKey('top 10 tools')).toBe('top 10 tool')
  })

  test('is never looser than the exact match', () => {
    const pairs = [
      ['What replaced vtext?', 'what replaced  VTEXT'],
      ['How do I alert the crew?', 'how do i ALERT the crew']
    ] as const
    for (const [left, right] of pairs) {
      expect(normaliseQuestion(left)).toBe(normaliseQuestion(right))
      expect(questionMergeKey(left)).toBe(questionMergeKey(right))
    }
    expect(questionMergeKey('   ')).toBe('')
  })
})
