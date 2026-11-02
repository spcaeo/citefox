import { describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import {
  addedText,
  checkCost,
  checkNowProblem,
  costText,
  marketsText,
  nextCheckLabel,
  questionsHash,
  takesQuestions,
  targetOption
} from './copy'

function market(id: string, country: string, language = 'en'): Market {
  return {
    id,
    country,
    language,
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  }
}

const US = market('us', 'US')
const UK = market('uk', 'GB')
const DE = market('de', 'DE', 'de')

describe('cost', () => {
  it('counts one search per question, market and sample, up to two when the overview loads apart', () => {
    expect(checkCost(6, 1, 1)).toEqual({ min: 6, max: 12 })
    expect(checkCost(3, 2, 3)).toEqual({ min: 18, max: 36 })
    expect(checkCost(0, 2, 1)).toEqual({ min: 0, max: 0 })
  })

  it('writes the footer line', () => {
    expect(costText({ questions: 6, markets: [US], samples: 1, searchesLeft: 412 })).toBe(
      'checking now uses 6 searches, up to 12 · 412 left · market US · EN'
    )
    expect(costText({ questions: 1, markets: [US, UK], samples: 1, searchesLeft: null })).toBe(
      'checking now uses 2 searches, up to 4 · markets US · EN and GB · EN'
    )
    expect(costText({ questions: 0, markets: [US], samples: 1, searchesLeft: 2014 })).toBe(
      'checking now uses 0 searches · 2,014 left · market US · EN'
    )
  })

  it('names the markets', () => {
    expect(marketsText([])).toBe('no market yet')
    expect(marketsText([US, UK, DE])).toBe('markets US · EN, GB · EN and DE · DE')
  })

  it('stops a check that the searches left do not cover', () => {
    expect(checkNowProblem({ questions: 6, markets: 1, samples: 1, searchesLeft: 412 })).toBeNull()
    expect(checkNowProblem({ questions: 6, markets: 1, samples: 1, searchesLeft: null })).toBeNull()
    expect(checkNowProblem({ questions: 6, markets: 1, samples: 1, searchesLeft: 5 })).toBe(
      'Not enough searches left this month to check now: this can use up to 12 and 5 are left. Add them to the next check instead.'
    )
    // The worst case counts: 6 to 12 searches with 10 left can run out part-way.
    expect(checkNowProblem({ questions: 6, markets: 1, samples: 1, searchesLeft: 10 })).toBe(
      'Not enough searches left this month to check now: this can use up to 12 and 10 are left. Add them to the next check instead.'
    )
    expect(checkNowProblem({ questions: 6, markets: 1, samples: 1, searchesLeft: 12 })).toBeNull()
    expect(checkNowProblem({ questions: 1, markets: 0, samples: 1, searchesLeft: 5 })).toMatch(
      /no market/
    )
  })
})

describe('nextCheckLabel', () => {
  const friday = new Date(2026, 9, 23, 22, 30)
  const at = (day: number, hour = 9): string => new Date(2026, 9, day, hour).toISOString()

  it('names the day of the next scheduled check', () => {
    expect(nextCheckLabel(at(23, 23), friday)).toBe('Add to today’s check')
    expect(nextCheckLabel(at(20), friday)).toBe('Add to today’s check')
    expect(nextCheckLabel(at(24, 1), friday)).toBe('Add to tomorrow’s check')
    expect(nextCheckLabel(at(27), friday)).toBe('Add to Tuesday’s check')
    expect(nextCheckLabel(at(29), friday)).toBe('Add to Thursday’s check')
    expect(nextCheckLabel(at(30), friday)).toBe('Add to the Oct 30 check')
    expect(nextCheckLabel(new Date(2026, 10, 12, 9).toISOString(), friday)).toBe(
      'Add to the Nov 12 check'
    )
  })

  it('offers adding without a check when nothing is scheduled', () => {
    expect(nextCheckLabel(null, friday)).toBe('Add without checking')
    expect(nextCheckLabel('not a date', friday)).toBe('Add without checking')
  })
})

describe('labels', () => {
  it('writes the option, the toast and the link', () => {
    expect(targetOption({ name: 'Replacing a gateway', questions: 1, keywords: 0 })).toBe(
      'Replacing a gateway · 1 question'
    )
    expect(targetOption({ name: 'Text alerts for teams', questions: 146, keywords: 118 })).toBe(
      'Text alerts for teams · 28 questions · 118 keywords'
    )
    expect(addedText(6, false)).toBe('6 questions added')
    expect(addedText(1, true)).toBe('1 question added · checking now')
    expect(questionsHash('topic 1')).toBe('#/questions?source=topic%201')
  })

  it('takes questions only on tracked or paused pages and topics', () => {
    expect(takesQuestions({ status: 'tracked' })).toBe(true)
    expect(takesQuestions({ status: 'paused' })).toBe(true)
    expect(takesQuestions({ status: 'not_tracked' })).toBe(false)
    expect(takesQuestions({ status: 'setting_up' })).toBe(false)
    expect(takesQuestions({ status: 'removed' })).toBe(false)
  })
})
