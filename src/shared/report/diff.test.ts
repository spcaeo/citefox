import { describe, expect, test } from 'vitest'
import {
  citationChange,
  COMPARE_MIN_COVERAGE,
  coverageComparable,
  diffQuestions,
  measuredCount,
  type DiffSide
} from './diff'

const cited: DiffSide = { cited: true, failed: false }
const notCited: DiffSide = { cited: false, failed: false }
const failed: DiffSide = { cited: false, failed: true }

describe('citationChange', () => {
  test('the four changes', () => {
    expect(citationChange(notCited, cited)).toBe('gained')
    expect(citationChange(cited, cited)).toBe('kept')
    expect(citationChange(cited, notCited)).toBe('lost')
    expect(citationChange(notCited, notCited)).toBe('never')
  })

  test('no earlier result, or a failed search on either side, is not a change', () => {
    expect(citationChange(null, cited)).toBeNull()
    expect(citationChange(failed, cited)).toBeNull()
    expect(citationChange(cited, failed)).toBeNull()
  })
})

describe('diffQuestions', () => {
  test('counts every question of the latest check once; keys only in the earlier one are ignored', () => {
    const before = new Map<string, DiffSide>([
      ['a', notCited],
      ['b', cited],
      ['c', cited],
      ['d', notCited],
      ['gone', cited],
      ['f', failed]
    ])
    const after = new Map<string, DiffSide>([
      ['a', cited],
      ['b', cited],
      ['c', notCited],
      ['d', notCited],
      ['new', cited],
      ['f', cited]
    ])
    const diff = diffQuestions(before, after)
    expect(diff.counts).toEqual({ gained: 1, kept: 1, lost: 1, never: 1, unmatched: 2 })
    expect([...diff.changes]).toEqual([
      ['a', 'gained'],
      ['b', 'kept'],
      ['c', 'lost'],
      ['d', 'never'],
      ['new', null],
      ['f', null]
    ])
  })

  test('the counts add up to the questions of the latest check', () => {
    const after = new Map<number, DiffSide>(
      Array.from({ length: 20 }, (_, index) => [index, index % 3 === 0 ? cited : notCited])
    )
    const before = new Map<number, DiffSide>(
      Array.from({ length: 15 }, (_, index) => [index, index % 2 === 0 ? cited : notCited])
    )
    const { counts } = diffQuestions(before, after)
    expect(counts.gained + counts.kept + counts.lost + counts.never + counts.unmatched).toBe(20)
    expect(counts.unmatched).toBe(5)
  })
})

describe('coverage rule', () => {
  test('90% of the planned questions is enough; less, or nothing planned, is not', () => {
    expect(COMPARE_MIN_COVERAGE).toBe(0.9)
    expect(coverageComparable(9, 10)).toBe(true)
    expect(coverageComparable(10, 10)).toBe(true)
    expect(coverageComparable(8, 10)).toBe(false)
    expect(coverageComparable(89, 99)).toBe(false)
    expect(coverageComparable(90, 100)).toBe(true)
    expect(coverageComparable(0, 0)).toBe(false)
    expect(coverageComparable(3, Number.NaN)).toBe(false)
  })

  test('a failed search is not measured', () => {
    expect(measuredCount([cited, notCited, failed, failed])).toBe(2)
  })

  test('with a plan, a thin check on either side hides every change', () => {
    const before = new Map<string, DiffSide>(
      Array.from({ length: 10 }, (_, index) => [`q${index}`, notCited])
    )
    const after = new Map<string, DiffSide>(
      Array.from({ length: 10 }, (_, index) => [`q${index}`, index < 2 ? failed : cited])
    )
    const thin = diffQuestions(before, after, { before: 10, after: 10 })
    expect(thin.lowCoverage).toBe(true)
    expect(thin.counts).toEqual({ gained: 0, kept: 0, lost: 0, never: 0, unmatched: 10 })
    expect([...thin.changes.values()].every((change) => change === null)).toBe(true)
    // The earlier check planned 12 and measured 10: under 90% on that side too.
    expect(diffQuestions(after, before, { before: 12, after: 10 }).lowCoverage).toBe(true)
    // Without a plan the old rule stands: each question on its own.
    const plain = diffQuestions(before, after)
    expect(plain.lowCoverage).toBe(false)
    expect(plain.counts).toMatchObject({ gained: 8, unmatched: 2 })
  })

  test('a failed search is never "not cited", whatever the coverage', () => {
    const before = new Map<string, DiffSide>([['q', cited]])
    const after = new Map<string, DiffSide>([['q', failed]])
    expect(diffQuestions(before, after).changes.get('q')).toBeNull()
  })
})
