import { describe, expect, test } from 'vitest'
import { C1, C2, pageRows, row } from './fixtures.test-helper'
import { verdictSetsOf } from './verdict-sets'
import { resolveWindow } from './window'

describe('verdict sets', () => {
  const { pairs } = resolveWindow(
    pageRows().map((item) =>
      item.questionId === 'q4' && item.checkedAt === C2 ? { ...item, domains: ['g2.com'] } : item
    ),
    { from: 'previous', to: null }
  )
  const sets = verdictSetsOf(pairs, 'g2.com')

  test('now: every question, with the ids of its row now', () => {
    expect(sets.tracked).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2', 'q5@c2', 'q6@c2', 'q7@c2'])
    expect(sets.aio).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2', 'q7@c2'])
    expect(sets.cited).toEqual(['q1@c2', 'q2@c2', 'q7@c2'])
    expect(sets.named).toEqual(['q1@c2', 'q2@c2'])
    expect(sets.not_visible).toEqual(['q3@c2', 'q4@c2'])
    expect(sets.top_site).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2'])
  })

  test('changes: only questions measured at both ends, drilling to their rows now', () => {
    expect(sets.gained).toEqual(['q1@c2'])
    expect(sets.kept).toEqual(['q2@c2'])
    expect(sets.lost).toEqual(['q3@c2'])
    expect(sets.cited_before).toEqual(['q2@c2', 'q3@c2'])
    expect(sets.cited_after).toEqual(['q1@c2', 'q2@c2'])
    expect(sets.named_before).toEqual(['q2@c2'])
    expect(sets.named_after).toEqual(['q1@c2', 'q2@c2'])
  })

  test('no top site, no comparison', () => {
    const latest = verdictSetsOf(
      [{ key: 'a', from: null, to: row('a', C1, 'target', { domains: ['g2.com'] }) }],
      null
    )
    expect(latest.top_site).toEqual([])
    expect(latest.cited).toEqual(['a@c1'])
    expect(latest.cited_before).toEqual([])
    expect(latest.gained).toEqual([])
  })
})
