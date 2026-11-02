import { describe, expect, test } from 'vitest'
import type { PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import { diffRuns, diffSide, type RunRows } from './diff'

function row(promptId: string, status: PromptCheckStatus): PromptCheckRow {
  return {
    promptId,
    promptPosition: 1,
    label: promptId,
    text: `Question ${promptId}`,
    source: 'title_meta_h1',
    intentStage: 'problem',
    status,
    frequency: { matching: 1, samples: 1 },
    position: status === 'page_cited' ? 2 : null,
    citedUrl: null,
    references: [],
    wrongPageCited: status === 'other_own_page',
    named: status === 'no_aio' || status === 'error' ? null : false,
    movement: null,
    previousStatus: null,
    previousPosition: null,
    coverage: null,
    action: null,
    aioSummary: null,
    checkedAt: '2026-10-19T12:00:00.000Z'
  }
}

function run(
  runId: string,
  rows: PromptCheckRow[],
  options: { partial?: boolean; marketId?: string; planned?: number } = {}
): RunRows {
  return {
    runId,
    marketId: options.marketId ?? 'mkt-us',
    partial: options.partial ?? false,
    rows,
    ...(options.planned === undefined ? {} : { planned: options.planned })
  }
}

/** `count` rows that were measured and never cited, ids from `from`. */
function filler(count: number, from = 100): PromptCheckRow[] {
  return Array.from({ length: count }, (_, at) => row(`p${from + at}`, 'not_cited'))
}

describe('diffRuns', () => {
  test('gained, kept, lost and never per prompt in the market', () => {
    const before = run('run-1', [
      row('p1', 'not_cited'),
      row('p2', 'page_cited'),
      row('p3', 'other_own_page'),
      row('p4', 'no_aio'),
      row('p5', 'brand_mentioned')
    ])
    const after = run('run-2', [
      row('p1', 'page_cited'),
      row('p2', 'other_own_page'),
      row('p3', 'not_cited'),
      row('p4', 'not_cited'),
      row('p5', 'error'),
      row('p6', 'page_cited'),
      // New prompts, measured: 9 of 10 measured keeps the run at 90%.
      ...filler(4)
    ])
    const result = diffRuns(before, after)
    expect(result.comparable).toBe(true)
    if (!result.comparable) return
    expect(result.diff.counts).toEqual({ gained: 1, kept: 1, lost: 1, never: 1, unmatched: 6 })
    expect(result.diff.changes.get('mkt-us|p1')).toBe('gained')
    expect(result.diff.changes.get('mkt-us|p2')).toBe('kept')
    expect(result.diff.changes.get('mkt-us|p3')).toBe('lost')
    expect(result.diff.changes.get('mkt-us|p4')).toBe('never')
    expect(result.diff.changes.get('mkt-us|p5')).toBeNull()
    expect(result.diff.changes.get('mkt-us|p6')).toBeNull()
  })

  test('a re-check of a few prompts (under 90% of the set) is never compared', () => {
    const full = run('run-1', [row('p1', 'not_cited'), ...filler(9)])
    const partial = run('run-2', [row('p1', 'page_cited')], { partial: true, planned: 10 })
    expect(diffRuns(full, partial)).toEqual({ comparable: false, reason: 'coverage', diff: null })
    expect(diffRuns(partial, full)).toEqual({ comparable: false, reason: 'coverage', diff: null })
  })

  test('a partial run that measured 90% of its set is compared like for like', () => {
    const full = run('run-1', [row('p1', 'not_cited'), ...filler(9)])
    const partial = run('run-2', [row('p1', 'page_cited'), ...filler(8)], {
      partial: true,
      planned: 10
    })
    const result = diffRuns(full, partial)
    expect(result.comparable).toBe(true)
    if (!result.comparable) return
    expect(result.diff.changes.get('mkt-us|p1')).toBe('gained')
    expect(result.diff.counts).toEqual({ gained: 1, kept: 0, lost: 0, never: 8, unmatched: 0 })
  })

  test('failed searches count against coverage and are never "not cited"', () => {
    const before = run('run-1', [row('p1', 'page_cited'), ...filler(9)])
    // 8 of 10 measured: the run is below 90%, so nothing is compared.
    const thin = run('run-2', [row('p1', 'error'), row('p2', 'error'), ...filler(8)])
    expect(diffRuns(before, thin)).toEqual({ comparable: false, reason: 'coverage', diff: null })
    // 9 of 10: compared, and the failed search is unmatched, not lost.
    const enough = run('run-3', [row('p1', 'error'), ...filler(9)])
    const result = diffRuns(before, enough)
    expect(result.comparable).toBe(true)
    if (!result.comparable) return
    expect(result.diff.changes.get('mkt-us|p1')).toBeNull()
    expect(result.diff.counts.lost).toBe(0)
    expect(result.diff.counts.unmatched).toBe(1)
  })

  test('exactly 90% compares; just under does not; an empty run never does', () => {
    const before = run('run-1', filler(20))
    const at = run('run-2', [...filler(18), row('x1', 'error'), row('x2', 'error')])
    const under = run('run-3', [
      ...filler(17),
      row('x1', 'error'),
      row('x2', 'error'),
      row('x3', 'error')
    ])
    expect(diffRuns(before, at).comparable).toBe(true)
    expect(diffRuns(before, under)).toMatchObject({ comparable: false, reason: 'coverage' })
    expect(diffRuns(before, run('run-4', []))).toMatchObject({
      comparable: false,
      reason: 'coverage'
    })
  })

  test('no earlier run, or another market, is not comparable', () => {
    const after = run('run-2', [row('p1', 'page_cited')])
    expect(diffRuns(null, after).comparable).toBe(false)
    expect(diffRuns(run('run-1', [row('p1', 'not_cited')], { marketId: 'mkt-uk' }), after)).toEqual(
      { comparable: false, reason: 'market', diff: null }
    )
  })

  test('keyOf follows a reworded prompt to the same question', () => {
    const lineage = new Map([['p1-v2', 'p1']])
    const keyOf = (item: PromptCheckRow): string => lineage.get(item.promptId) ?? item.promptId
    const result = diffRuns(
      run('run-1', [row('p1', 'not_cited')]),
      run('run-2', [row('p1-v2', 'page_cited')]),
      { keyOf }
    )
    expect(result.comparable && result.diff.counts.gained).toBe(1)
  })
})

describe('diffSide', () => {
  test('a failed search is not measured and never cited', () => {
    expect(diffSide(row('p1', 'error'))).toEqual({ cited: false, failed: true })
    expect(diffSide(row('p1', 'page_cited'))).toEqual({ cited: true, failed: false })
  })
})
