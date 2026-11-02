import { expect } from 'vitest'
import type { MetricCount, MetricResult, MetricRow, MetricsInput, MetricsResult } from './types'

/** Check times used across the metrics tests. */
export const C1 = '2026-10-01T10:00:00.000Z'
export const C2 = '2026-10-15T10:00:00.000Z'
export const C3 = '2026-10-29T10:00:00.000Z'

const CHECK_OF: Record<string, string> = { [C1]: 'c1', [C2]: 'c2', [C3]: 'c3' }

/** One hand-made row. The id is `<question>@<check>[:<engine>]` unless given. */
export function row(
  questionId: string,
  checkedAt: string,
  result: MetricResult,
  extra: Partial<MetricRow> = {}
): MetricRow {
  const checkId = extra.checkId ?? CHECK_OF[checkedAt] ?? checkedAt
  const engine = extra.engine ?? 'google_aio'
  const cited = result === 'target' || result === 'other'
  return {
    id: `${questionId}@${checkId}${engine === 'google_aio' ? '' : `:${engine}`}`,
    questionId,
    text: `Question ${questionId}`,
    engine,
    marketId: 'us',
    sourceId: 'p1',
    sourceKind: 'page',
    checkId,
    checkedAt,
    result,
    citedUrl: cited ? 'https://textbolt.com/pricing' : null,
    position: cited ? 2 : null,
    domains: [],
    named: false,
    segments: { topic: 'Pricing', group: null, funnel: null, intent: null, pageType: null },
    ...extra
  }
}

/**
 * The small page used by most tests: two checks of page p1 on Google.
 * - q1 not cited → target (gained), number-one source after
 * - q2 other → other (kept)
 * - q3 target → not cited (lost)
 * - q4 no answer → not cited (new answer, still not cited)
 * - q5 no answer → no answer
 * - q6 not cited → failed (left out: failed)
 * - q7 only in the second check (left out: no before)
 * - q8 only in the first check (left out: no after)
 */
export function pageRows(): MetricRow[] {
  return [
    row('q1', C1, 'not_cited', { domains: ['reddit.com'] }),
    row('q2', C1, 'other', { domains: ['reddit.com', 'g2.com'], named: true }),
    row('q3', C1, 'target', { position: 1 }),
    row('q4', C1, 'no_answer'),
    row('q5', C1, 'no_answer'),
    row('q6', C1, 'not_cited'),
    row('q8', C1, 'target'),
    row('q1', C2, 'target', { position: 1, domains: ['g2.com'], named: true }),
    row('q2', C2, 'other', { domains: ['g2.com'], named: true }),
    row('q3', C2, 'not_cited', { domains: ['reddit.com', 'g2.com'] }),
    row('q4', C2, 'not_cited', { domains: ['reddit.com'] }),
    row('q5', C2, 'no_answer'),
    row('q6', C2, 'failed'),
    row('q7', C2, 'target')
  ]
}

/**
 * A request over `rows`. Counts per engine unless `counting` is given, so a row id is the
 * row's own (the `once` rule has its own tests in merge.test.ts).
 */
export function input(rows: readonly MetricRow[], extra: Partial<MetricsInput> = {}): MetricsInput {
  return {
    counting: 'per_engine',
    rows,
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine: 'all',
    window: { from: 'previous', to: null },
    ...extra
  }
}

function isCount(value: unknown): value is MetricCount {
  return (
    typeof value === 'object' &&
    value !== null &&
    'n' in value &&
    'ids' in value &&
    Array.isArray((value as MetricCount).ids)
  )
}

/** Page counts list page URLs, not rows. */
const PAGE_COUNT =
  /^pages\.(published|newPages|rewrites|citedNow|notCitedYet|tooNew|lostGround|notIndexed)$|^pages\.speed\.\d+\.(pages|citedPages)$/

/**
 * Every number drills: each count's total equals its ids, ids are unique, and each row
 * id names a row in `rows`. Returns how many counts it checked.
 */
export function expectEveryCountDrills(result: MetricsResult): number {
  let checked = 0
  const walk = (value: unknown, path: string): void => {
    if (path === 'rows' || value === null || typeof value !== 'object') return
    if (isCount(value)) {
      checked += 1
      expect(value.n, path).toBe(value.ids.length)
      expect(new Set(value.ids).size, path).toBe(value.ids.length)
      if (!PAGE_COUNT.test(path)) {
        for (const id of value.ids) expect(result.rows[id], `${path} → ${id}`).toBeDefined()
      }
      return
    }
    for (const [key, item] of Object.entries(value))
      walk(item, path === '' ? key : `${path}.${key}`)
  }
  walk(result, '')
  return checked
}
