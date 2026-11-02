import { describe, expect, test } from 'vitest'
import { ENGINE_ANSWER_STATUSES, type EngineAnswerStatus } from '@shared/domain'
import { rollUpStatus } from './views'

describe('rollUpStatus', () => {
  test('no samples: no status', () => {
    expect(rollUpStatus([])).toBeNull()
  })

  test('one sample is its own status', () => {
    for (const status of ENGINE_ANSWER_STATUSES) expect(rollUpStatus([status])).toBe(status)
  })

  test('the best outcome wins: cited, named, not cited, no answer, unavailable, error', () => {
    const order: EngineAnswerStatus[] = [
      'cited',
      'named',
      'not_cited',
      'no_answer',
      'unavailable',
      'error'
    ]
    order.forEach((better, index) => {
      for (const worse of order.slice(index + 1)) {
        expect(rollUpStatus([worse, better])).toBe(better)
        expect(rollUpStatus([better, worse])).toBe(better)
      }
    })
  })

  test('one citing sample among many makes the question cited, whatever the order', () => {
    expect(rollUpStatus(['error', 'not_cited', 'cited', 'named', 'no_answer'])).toBe('cited')
    expect(rollUpStatus(['unavailable', 'error', 'unavailable'])).toBe('unavailable')
    expect(rollUpStatus(['no_answer', 'error', 'not_cited'])).toBe('not_cited')
    expect(rollUpStatus(['named', 'named'])).toBe('named')
  })
})
