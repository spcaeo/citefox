import { describe, expect, test } from 'vitest'
import { computeMetrics } from './compute'
import { compare, decompose, sideCounts } from './counts'
import { C1, C2, input, pageRows, row } from './fixtures.test-helper'
import type { MetricPair } from './types'

const ids = (count: { ids: readonly string[] }): readonly string[] => count.ids

describe('counts at one end', () => {
  test('each result counts once, by the one rule', () => {
    const now = sideCounts(pageRows().filter((item) => item.checkedAt === C2))
    expect(now.checked.n).toBe(7)
    expect(ids(now.failed)).toEqual(['q6@c2'])
    expect(now.measured.n).toBe(6)
    expect(ids(now.answered)).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2', 'q7@c2'])
    expect(ids(now.noAnswer)).toEqual(['q5@c2'])
    expect(ids(now.cited)).toEqual(['q1@c2', 'q2@c2', 'q7@c2'])
    expect(ids(now.target)).toEqual(['q1@c2', 'q7@c2'])
    expect(ids(now.other)).toEqual(['q2@c2'])
    expect(ids(now.notCited)).toEqual(['q3@c2', 'q4@c2'])
    expect(ids(now.named)).toEqual(['q1@c2', 'q2@c2'])
    expect(ids(now.notVisible)).toEqual(['q3@c2', 'q4@c2'])
    expect(ids(now.first)).toEqual(['q1@c2'])
    expect(now.rate).toBe(3 / 5)
  })

  test('named needs an answer; the rate is null without answers', () => {
    const counts = sideCounts([row('a', C1, 'no_answer', { named: true })])
    expect(counts.named.n).toBe(0)
    expect(counts.notVisible.n).toBe(0)
    expect(counts.rate).toBeNull()
  })
})

describe('before → after', () => {
  const result = computeMetrics(input(pageRows()))
  const comparison = result.comparison
  if (comparison === null) throw new Error('expected a comparison')

  test('only questions measured at both ends are compared', () => {
    expect(ids(comparison.compared)).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2', 'q5@c2'])
    expect(ids(comparison.before.cited)).toEqual(['q2@c1', 'q3@c1'])
    expect(ids(comparison.after.cited)).toEqual(['q1@c2', 'q2@c2'])
    expect(ids(comparison.before.answered)).toEqual(['q1@c1', 'q2@c1', 'q3@c1'])
    expect(ids(comparison.after.answered)).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2'])
    expect(ids(comparison.before.first)).toEqual(['q3@c1'])
    expect(ids(comparison.after.first)).toEqual(['q1@c2'])
  })

  test('movement: gained, kept, lost, not cited, no answer, answers that came and went', () => {
    const { movement } = comparison
    expect(ids(movement.gained)).toEqual(['q1@c2'])
    expect(ids(movement.kept)).toEqual(['q2@c2'])
    expect(ids(movement.lost)).toEqual(['q3@c2'])
    expect(ids(movement.notCited)).toEqual(['q4@c2'])
    expect(ids(movement.noAnswer)).toEqual(['q5@c2'])
    expect(ids(movement.never)).toEqual(['q4@c2', 'q5@c2'])
    expect(ids(movement.newAnswers)).toEqual(['q4@c2'])
    expect(ids(movement.goneAnswers)).toEqual([])
    expect(ids(movement.namedBefore)).toEqual(['q2@c2'])
    expect(ids(movement.namedAfter)).toEqual(['q1@c2', 'q2@c2'])
    // Every compared question is in exactly one of the five.
    const five = [
      movement.gained,
      movement.kept,
      movement.lost,
      movement.notCited,
      movement.noAnswer
    ]
    expect(five.reduce((sum, count) => sum + count.n, 0)).toBe(comparison.compared.n)
  })

  test('a question missing at one end, or failed, is left out and reported', () => {
    expect(ids(comparison.excluded.noBefore)).toEqual(['q7@c2'])
    expect(ids(comparison.excluded.noAfter)).toEqual(['q8@c1'])
    expect(ids(comparison.excluded.failed)).toEqual(['q6@c2'])
    expect(comparison.compared.ids).not.toContain('q7@c2')
    expect(comparison.before.checked.ids).not.toContain('q8@c1')
  })

  test('market vs your work adds up exactly', () => {
    const split = comparison.decomposition
    // 2 → 2 cited; answers 3 → 4 at an old rate of 2/3: market +0.7, work −0.7.
    expect(split.total).toBe(0)
    expect(split.rateBefore).toBe(2 / 3)
    expect(split.rateAfter).toBe(2 / 4)
    expect(split.market).toBe(0.7)
    expect(split.work).toBe(-0.7)
    expect(split.marketTenths + split.workTenths).toBe(split.total * 10)
    expect(split.marketIds).toEqual(['q4@c2'])
    expect(split.workIds).toEqual(['q1@c2', 'q3@c2'])
  })
})

describe('market vs your work', () => {
  /** `n` pairs with these before → after results. */
  function pairs(spec: readonly [string, string, number][]): MetricPair[] {
    const out: MetricPair[] = []
    let index = 0
    for (const [from, to, n] of spec) {
      for (let i = 0; i < n; i += 1) {
        index += 1
        const key = `k${index}`
        out.push({
          key,
          from: row(key, C1, from as never),
          to: row(key, C2, to as never)
        })
      }
    }
    return out
  }

  test('a bigger mix: 8 new answers at the old rate of 6/102 explain +0.5 of +16', () => {
    const result = compare(
      pairs([
        ['target', 'target', 4],
        ['target', 'not_cited', 2],
        ['not_cited', 'target', 14],
        ['no_answer', 'target', 4],
        ['not_cited', 'not_cited', 82],
        ['no_answer', 'not_cited', 4],
        ['no_answer', 'no_answer', 6]
      ]),
      []
    )
    const split = result.decomposition
    expect(result.before.cited.n).toBe(6)
    expect(result.before.answered.n).toBe(102)
    expect(result.after.cited.n).toBe(22)
    expect(result.after.answered.n).toBe(110)
    expect(split).toMatchObject({ total: 16, market: 0.5, work: 15.5 })
    expect(split.marketTenths + split.workTenths).toBe(160)
    expect(split.marketIds).toHaveLength(8)
    expect(split.workIds).toHaveLength(20)
  })

  test('no answers before: the rate is unknown and all of the change is your work', () => {
    const result = compare(pairs([['no_answer', 'target', 3]]), [])
    expect(result.decomposition).toMatchObject({ total: 3, market: 0, work: 3, rateBefore: null })
  })

  test('answers vanishing make the market part negative', () => {
    const result = compare(
      pairs([
        ['target', 'no_answer', 2],
        ['not_cited', 'no_answer', 2]
      ]),
      []
    )
    expect(result.decomposition).toMatchObject({ total: -2, market: -2, work: 0 })
    expect(result.movement.goneAnswers.n).toBe(4)
  })

  test('the two parts add up exactly for any mix (seeded)', () => {
    let seed = 7
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const results = ['target', 'other', 'not_cited', 'no_answer', 'failed'] as const
    for (let round = 0; round < 200; round += 1) {
      const spec: [string, string, number][] = []
      for (let i = 0; i < 6; i += 1) {
        spec.push([
          results[Math.floor(next() * 5)] ?? 'target',
          results[Math.floor(next() * 5)] ?? 'target',
          Math.floor(next() * 9)
        ])
      }
      const result = compare(pairs(spec), [])
      const split = decompose(result.before, result.after, result.movement)
      expect(split.marketTenths + split.workTenths).toBe(split.total * 10)
      expect(Number.isInteger(split.marketTenths)).toBe(true)
      expect(split.total).toBe(result.movement.gained.n - result.movement.lost.n)
    }
  })
})
