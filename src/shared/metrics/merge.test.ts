import { describe, expect, it } from 'vitest'
import { computeMetrics } from './compute'
import { checksIn, enginesIn, firstCheckAt, mergeEngines, mergedId } from './merge'
import { ALL_ENGINES_COUNTING } from './settings'
import { C1, C2, expectEveryCountDrills, input, pageRows, row } from './fixtures.test-helper'

/** q1 on two engines in two checks; q2 on Google only. */
function engineRows(): ReturnType<typeof row>[] {
  return [
    row('q1', C1, 'not_cited', { domains: ['reddit.com'] }),
    row('q1', C1, 'no_answer', { engine: 'chatgpt' }),
    row('q1', C2, 'not_cited', { domains: ['reddit.com'] }),
    row('q1', C2, 'other', { engine: 'chatgpt', position: 3, domains: ['g2.com'], named: true }),
    row('q2', C1, 'target', { position: 4 }),
    row('q2', C2, 'failed'),
    row('q2', C2, 'target', { engine: 'perplexity', position: 1 })
  ]
}

describe('All engines, counted once (owner option A)', () => {
  it('is the default rule', () => {
    expect(ALL_ENGINES_COUNTING).toBe('once')
  })

  it('cites the question when any engine cites you, best result and position first', () => {
    const merged = mergeEngines(engineRows())
    expect(merged.map((item) => item.id)).toEqual([
      mergedId({ questionId: 'q1', marketId: 'us', checkId: 'c1' }),
      mergedId({ questionId: 'q1', marketId: 'us', checkId: 'c2' }),
      mergedId({ questionId: 'q2', marketId: 'us', checkId: 'c1' }),
      mergedId({ questionId: 'q2', marketId: 'us', checkId: 'c2' })
    ])
    const [q1Before, q1After, , q2After] = merged
    expect(q1Before).toMatchObject({ engine: 'all', result: 'not_cited', citedUrl: null })
    expect(q1After).toMatchObject({
      result: 'other',
      position: 3,
      named: true,
      domains: ['reddit.com', 'g2.com']
    })
    expect(q1After?.parts).toEqual(['q1@c2', 'q1@c2:chatgpt'])
    // A failed Google search does not hide Perplexity citing you.
    expect(q2After).toMatchObject({ result: 'target', position: 1 })
  })

  it('counts each question once, and every count still drills', () => {
    const once = computeMetrics(input(engineRows(), { counting: 'once' }))
    const per = computeMetrics(input(engineRows(), { counting: 'per_engine' }))
    expect(once.counting).toBe('once')
    expect(once.now.checked.n).toBe(2)
    expect(per.now.checked.n).toBe(4)
    expect(once.comparison?.movement.gained.n).toBe(1)
    expect(once.comparison?.movement.kept.n).toBe(1)
    expect(expectEveryCountDrills(once)).toBeGreaterThan(50)
    // The engines' own rows behind each merged row are in `rows` too.
    for (const id of once.now.cited.ids) {
      for (const part of once.rows[id]?.parts ?? []) expect(once.rows[part]).toBeDefined()
    }
    // The engine breakdown counts per engine under either rule.
    expect(once.engines).toEqual(per.engines)
  })

  it('leaves one engine alone', () => {
    const google = computeMetrics(input(engineRows(), { counting: 'once', engine: 'google_aio' }))
    expect(google.now.checked.ids).toEqual(['q1@c2', 'q2@c2'])
    expect(google.offeredEngines).toEqual(['google_aio', 'chatgpt', 'perplexity'])
  })

  it('lists the engines and checks on offer', () => {
    expect(enginesIn(engineRows())).toEqual(['google_aio', 'chatgpt', 'perplexity'])
    expect(checksIn(pageRows())).toEqual([
      { id: 'c1', at: C1 },
      { id: 'c2', at: C2 }
    ])
  })

  it('takes the first check as every check that finished within six hours of the earliest', () => {
    expect(firstCheckAt([])).toBeNull()
    expect(
      firstCheckAt([
        { id: 'a', at: '2026-09-16T15:00:00.000Z' },
        { id: 'b', at: '2026-09-16T15:20:00.000Z' },
        { id: 'c', at: '2026-09-30T15:00:00.000Z' }
      ])
    ).toBe('2026-09-16T15:20:00.000Z')
  })
})
