import type { PromptCheckStatus } from '@shared/domain'
import {
  changeOf,
  isCompared,
  movementOf,
  sideCounts,
  verdictSetsOf,
  type Change,
  type MetricPair,
  type MetricResult,
  type MetricRow,
  type Movement,
  type SideCounts
} from '@shared/metrics'
import type { VerdictSet } from '@shared/report/verdict'
import { NO_SEGMENTS } from '../../metrics/rows'
import { isAioStatus, type PreviousResult, type ScopeData } from './rows'
import type { ReportRow } from './types'

/**
 * The offline report's rows as shared metrics rows (`src/shared/metrics`), so the
 * report's tiles, verdict and "What changed" count by the same rules as Summary and
 * `reports:metrics`. "Cited" means one thing everywhere: a page of yours is among the
 * answer's sources (`rows.ts` `citesYou`, the rule `reports:metrics` uses).
 */

function resultOf(status: PromptCheckStatus, cited: boolean, pageCited: boolean): MetricResult {
  if (status === 'error') return 'failed'
  if (!isAioStatus(status)) return 'no_answer'
  if (!cited) return 'not_cited'
  return pageCited ? 'target' : 'other'
}

function base(row: ReportRow): Omit<MetricRow, 'result' | 'named' | 'position' | 'checkedAt'> {
  return {
    id: row.id,
    questionId: `${row.pageId}|${row.promptId}`,
    text: row.text,
    engine: 'google_aio',
    marketId: row.marketId,
    sourceId: row.pageId,
    sourceKind: 'page',
    checkId: row.runId,
    citedUrl: row.cited ? row.citedUrl : null,
    domains: row.topDomains,
    segments: NO_SEGMENTS
  }
}

export function reportMetricRow(row: ReportRow): MetricRow {
  return {
    ...base(row),
    result: resultOf(row.status, row.cited, row.pageCited),
    named: row.named,
    position: row.cited ? row.position : null,
    checkedAt: row.checkedAt ?? ''
  }
}

/** The previous full check's result for the same prompt, under the current row's id. */
export function previousMetricRow(row: ReportRow, prior: PreviousResult): MetricRow {
  const result = resultOf(prior.status, prior.cited, prior.status === 'page_cited')
  return {
    ...base(row),
    result,
    citedUrl: null,
    named: prior.named,
    position: prior.cited ? prior.position : null,
    checkedAt: prior.checkedAt
  }
}

/** Every report row now, with the previous full check's result when there is one. */
export function reportPairs(scope: ScopeData): MetricPair[] {
  return scope.rows.map((row) => {
    const prior = scope.previous.get(row.id)
    return {
      key: row.id,
      from: prior === undefined ? null : previousMetricRow(row, prior),
      to: reportMetricRow(row)
    }
  })
}

export interface ReportMetrics {
  now: SideCounts
  /** Each row's change, or null when it is not compared. */
  change: ReadonlyMap<string, Change | null>
  movement: Movement
  /** Rows not compared (no earlier full check, or a failed search), in row order. */
  notCompared: readonly string[]
  verdictSets: Record<VerdictSet, string[]>
}

export function reportMetrics(scope: ScopeData): ReportMetrics {
  const pairs = reportPairs(scope)
  const change = new Map<string, Change | null>(
    pairs.map((pair) => [pair.key, isCompared(pair) ? changeOf(pair) : null])
  )
  return {
    now: sideCounts(pairs.map((pair) => pair.to)),
    change,
    movement: movementOf(pairs.filter(isCompared)),
    notCompared: pairs.filter((pair) => change.get(pair.key) === null).map((pair) => pair.key),
    verdictSets: verdictSetsOf(pairs, null)
  }
}
