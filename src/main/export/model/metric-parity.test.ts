import { describe, expect, test } from 'vitest'
import type { ExportRequest } from '@shared/ipc'
import { citationChange, type CitationChange } from '@shared/report/diff'
import { prepareExport } from '../prepare'
import { reportMetrics } from './metric-rows'
import { collectScope, type ScopeData } from './rows'
import { richSampleDataset } from './sample-dataset.test-helper'
import { sampleReportModel, sampleReportRequest } from './sample.test-helper'
import type { Count, ReportModel, ReportRow } from './types'

/**
 * The offline report reads its tiles, verdict and "What changed" from the shared metrics
 * layer. These tests keep the rules it used before the switch (copied here) and prove
 * the numbers, and the prompts behind each, are the same.
 */

/** The report's own rules before the switch to `src/shared/metrics`. */
function legacy(scope: ScopeData): Record<string, string[]> {
  const ids = (predicate: (row: ReportRow) => boolean): string[] =>
    scope.rows.filter(predicate).map((row) => row.id)
  const change = new Map<string, CitationChange | null>()
  for (const row of scope.rows) {
    const prior = scope.previous.get(row.id)
    change.set(
      row.id,
      citationChange(
        prior === undefined ? null : { cited: prior.cited, failed: prior.status === 'error' },
        { cited: row.cited, failed: row.status === 'error' }
      )
    )
  }
  const comparable = (predicate: (row: ReportRow) => boolean): string[] =>
    ids((row) => change.get(row.id) !== null && predicate(row))
  const is = (row: ReportRow, ...values: CitationChange[]): boolean =>
    values.includes(change.get(row.id) as CitationChange)
  return {
    all: ids(() => true),
    'aio:shown': ids((row) => row.aio),
    'aio:cited': ids((row) => row.cited),
    'aio:page': ids((row) => row.pageCited),
    named: ids((row) => row.named),
    invisible: ids((row) => row.notVisible),
    failed: ids((row) => row.status === 'error'),
    wrongpage: ids((row) => row.wrongPage),
    'change:gained': ids((row) => is(row, 'gained')),
    'change:kept': ids((row) => is(row, 'kept')),
    'change:lost': ids((row) => is(row, 'lost')),
    'change:never': ids((row) => is(row, 'never')),
    'change:none': ids((row) => change.get(row.id) === null),
    'change:cited-before': comparable((row) => is(row, 'kept', 'lost')),
    'change:cited-after': comparable((row) => is(row, 'kept', 'gained')),
    'change:named-before': comparable((row) => scope.previous.get(row.id)?.named === true),
    'change:named-after': comparable((row) => row.named)
  }
}

const VARIANTS: [string, Partial<ExportRequest>][] = [
  ['one page, two markets', {}],
  ['the whole project', { scope: 'project', pageIds: [] }],
  ['one market', { marketIds: ['mkt-us'] }]
]

function scopeOf(overrides: Partial<ExportRequest>): ScopeData {
  const dataset = richSampleDataset()
  return collectScope(prepareExport(dataset, sampleReportRequest(overrides)).pages)
}

function drillIds(model: ReportModel, count: Count): readonly string[] {
  return count.drill === null ? [] : (model.drills[count.drill] ?? [])
}

describe('the offline report counts by the shared metrics, unchanged', () => {
  for (const [name, overrides] of VARIANTS) {
    test(`same numbers and prompts as before the switch: ${name}`, () => {
      const scope = scopeOf(overrides)
      const before = legacy(scope)
      const model = sampleReportModel(overrides)
      // Every token the old rules registered lists exactly the same prompts now.
      for (const [token, ids] of Object.entries(before)) {
        if (ids.length === 0 && model.drills[token] === undefined) continue
        expect(model.drills[token], token).toEqual(ids)
      }
      const tiles: [Count, string][] = [
        [model.overview.tracked, 'all'],
        [model.overview.aio, 'aio:shown'],
        [model.overview.cited, 'aio:cited'],
        [model.overview.named, 'named'],
        [model.overview.notVisible, 'invisible'],
        [model.overview.failed, 'failed'],
        [model.overview.pageCited, 'aio:page'],
        [model.overview.wrongPage, 'wrongpage'],
        [model.whatChanged.gained, 'change:gained'],
        [model.whatChanged.kept, 'change:kept'],
        [model.whatChanged.lost, 'change:lost'],
        [model.whatChanged.never, 'change:never'],
        [model.whatChanged.noEarlier, 'change:none']
      ]
      for (const [count, token] of tiles) {
        expect(count.n, token).toBe(before[token]?.length)
        expect(drillIds(model, count), token).toEqual(before[token])
      }
      expect(model.overview.measured).toBe(
        scope.rows.filter((row) => row.status !== 'error').length
      )
    })
  }

  test('the sample exercises every change, so the comparison is a real one', () => {
    const metrics = reportMetrics(scopeOf({ scope: 'project', pageIds: [] }))
    expect(metrics.movement.gained.n).toBeGreaterThan(0)
    expect(metrics.movement.lost.n).toBeGreaterThan(0)
    expect(metrics.movement.kept.n).toBeGreaterThan(0)
    expect(metrics.notCompared.length).toBeGreaterThan(0)
  })
})
