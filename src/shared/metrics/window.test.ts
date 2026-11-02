import { describe, expect, test } from 'vitest'
import { computeMetrics } from './compute'
import { C1, C2, C3, input, pageRows, row } from './fixtures.test-helper'
import type { MetricRow } from './types'
import { filterRows, questionKey, resolveWindow } from './window'

const ids = (rows: readonly MetricRow[]): string[] => rows.map((item) => item.id)

describe('the window', () => {
  test('a page counts only its newest check: a question dropped from it drops out', () => {
    const window = resolveWindow(pageRows(), { from: null, to: null })
    expect(ids(window.to)).toEqual(['q1@c2', 'q2@c2', 'q3@c2', 'q4@c2', 'q5@c2', 'q6@c2', 'q7@c2'])
    expect(window.pairs.every((pair) => pair.from === null)).toBe(true)
    expect(window.noAfter).toEqual([])
  })

  test('previous: each page against its check before the latest', () => {
    const window = resolveWindow(pageRows(), { from: 'previous', to: null })
    expect(window.pairs.map((pair) => pair.from?.id ?? null)).toEqual([
      'q1@c1',
      'q2@c1',
      'q3@c1',
      'q4@c1',
      'q5@c1',
      'q6@c1',
      null
    ])
    expect(ids(window.noAfter)).toEqual(['q8@c1'])
  })

  test('a time picks the newest check at or before it, at either end', () => {
    const rows = [...pageRows(), row('q1', C3, 'other')]
    const toC2 = resolveWindow(rows, { from: C1, to: C2 })
    expect(toC2.pairs.find((pair) => pair.key === questionKey(rows[0] as MetricRow))?.to.id).toBe(
      'q1@c2'
    )
    const late = resolveWindow(rows, { from: '2026-10-20T00:00:00.000Z', to: null })
    // The page's newest check is c3 (q1 only); at Oct 20 it was c2.
    expect(ids(late.to)).toEqual(['q1@c3'])
    expect(late.pairs[0]?.from?.id).toBe('q1@c2')
    expect(ids(late.noAfter)).toEqual(['q2@c2', 'q3@c2', 'q4@c2', 'q5@c2', 'q6@c2', 'q7@c2'])
    const latestOnly = computeMetrics(input(rows, { window: { from: null, to: C1 } }))
    expect(latestOnly.comparison).toBeNull()
    expect(latestOnly.now.checked.ids).toEqual([
      'q1@c1',
      'q2@c1',
      'q3@c1',
      'q4@c1',
      'q5@c1',
      'q6@c1',
      'q8@c1'
    ])
  })

  test('a topic keeps each question’s newest result across its checks (batches)', () => {
    const topic = (id: string, at: string, result: MetricRow['result']): MetricRow =>
      row(id, at, result, { sourceId: 't1', sourceKind: 'topic' })
    const rows = [
      topic('t-a', C1, 'not_cited'),
      topic('t-b', C1, 'not_cited'),
      topic('t-b', C2, 'target')
    ]
    const window = resolveWindow(rows, { from: 'previous', to: null })
    expect(ids(window.to)).toEqual(['t-a@c1', 't-b@c2'])
    // Before the topic's latest check (c2): t-a still stands at c1, so it compares with itself.
    expect(window.pairs.map((pair) => pair.from?.id)).toEqual(['t-a@c1', 't-b@c1'])
    const metrics = computeMetrics(input(rows))
    expect(metrics.comparison?.movement.gained.ids).toEqual(['t-b@c2'])
    expect(metrics.comparison?.movement.notCited.ids).toEqual(['t-a@c1'])
  })

  test('a check id breaks a tie between two checks finished at the same moment', () => {
    const rows = [
      row('a', C1, 'target', { checkId: 'z' }),
      row('a', C1, 'not_cited', { checkId: 'b' })
    ]
    expect(ids(resolveWindow(rows, { from: null, to: null }).to)).toEqual(['a@z'])
  })
})

describe('filters', () => {
  const rows: MetricRow[] = [
    ...pageRows(),
    row('q1', C1, 'not_cited', { engine: 'chatgpt' }),
    row('q1', C2, 'other', { engine: 'chatgpt' }),
    row('q1', C2, 'target', { marketId: 'ca', id: 'q1@c2:ca' }),
    row('t-a', C2, 'target', { sourceId: 't1', sourceKind: 'topic' })
  ]

  test('engine: one engine reads only its rows; all counts each engine', () => {
    const chatgpt = computeMetrics(input(rows, { engine: 'chatgpt' }))
    expect(chatgpt.now.checked.ids).toEqual(['q1@c2:chatgpt'])
    expect(chatgpt.comparison?.movement.gained.ids).toEqual(['q1@c2:chatgpt'])
    const google = computeMetrics(input(rows, { engine: 'google_aio' }))
    const all = computeMetrics(input(rows))
    expect(all.now.checked.n).toBe(google.now.checked.n + chatgpt.now.checked.n)
    expect(all.comparison?.movement.gained.n).toBe(
      (google.comparison?.movement.gained.n ?? 0) + (chatgpt.comparison?.movement.gained.n ?? 0)
    )
    expect(all.engines.map((item) => item.engine)).toEqual(['google_aio', 'chatgpt'])
    expect(all.engines[1]?.cited.after?.ids).toEqual(['q1@c2:chatgpt'])
  })

  test('market and scope', () => {
    expect(
      ids(filterRows(rows, { scope: { kind: 'project' }, marketId: 'ca', engine: 'all' }))
    ).toEqual(['q1@c2:ca'])
    expect(
      ids(filterRows(rows, { scope: { kind: 'topic', id: 't1' }, marketId: null, engine: 'all' }))
    ).toEqual(['t-a@c2'])
    const page = filterRows(rows, {
      scope: { kind: 'page', id: 'p1' },
      marketId: 'us',
      engine: 'all'
    })
    expect(page.every((item) => item.sourceId === 'p1' && item.marketId === 'us')).toBe(true)
    // A topic id never matches a page scope, nor the other way round.
    expect(
      filterRows(rows, { scope: { kind: 'page', id: 't1' }, marketId: null, engine: 'all' })
    ).toEqual([])
    const topic = computeMetrics(input(rows, { scope: { kind: 'topic', id: 't1' } }))
    expect(topic.now.cited.ids).toEqual(['t-a@c2'])
    expect(topic.comparison?.excluded.noBefore.ids).toEqual(['t-a@c2'])
  })
})
