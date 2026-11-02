import { describe, expect, it } from 'vitest'
import {
  allowedNumbers,
  normalizeNumber,
  numbersIn,
  sentences,
  stripUnknownNumbers,
  unknownNumbers
} from './numbers'

describe('the number check', () => {
  it('normalizes commas, trailing zeros and leading zeros', () => {
    expect(normalizeNumber('1,200')).toBe('1200')
    expect(normalizeNumber('70.0')).toBe('70')
    expect(normalizeNumber('07')).toBe('7')
    expect(normalizeNumber('2.50')).toBe('2.5')
  })

  it('reads numbers but not refs, ids or list markers', () => {
    expect(numbersIn('R3 and N12 cite 4 of 10 checks (40%) on 1,200 pages')).toEqual([
      '4',
      '10',
      '40',
      '1200'
    ])
    expect(unknownNumbers('1. First\n2. Second has 9 rows', allowedNumbers(''))).toEqual(['9'])
  })

  it('keeps sentences whose numbers are in the packet and drops the others', () => {
    const allowed = allowedNumbers('N1 Questions: 2', 'N2 Prompt checks: 4')
    const checked = stripUnknownNumbers(
      'You track 2 questions in 4 checks. About 37 of your searches went into these. simpletexting.com is cited instead.',
      allowed
    )
    expect(checked.text).toBe(
      'You track 2 questions in 4 checks. simpletexting.com is cited instead.'
    )
    expect(checked.flagged).toEqual(['37'])
  })

  it('says so instead of guessing when every sentence had an invented number', () => {
    const checked = stripUnknownNumbers('You are cited 12 times.', allowedNumbers('N1 Cited: 3'))
    expect(checked.text).toBe(
      'CiteFox could not answer this from your saved checks without guessing a number.'
    )
    expect(checked.flagged).toEqual(['12'])
  })

  it('splits on sentence ends and line breaks, without list markers', () => {
    expect(sentences('- One here. Two there!\n3) Three')).toEqual([
      'One here.',
      'Two there!',
      'Three'
    ])
  })
})
