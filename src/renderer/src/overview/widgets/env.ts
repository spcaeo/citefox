import type { EngineId } from '@shared/domain'
import type {
  EngineCounts,
  MetricsResult,
  QuestionEngineStatuses,
  VisibilityOverview
} from '@shared/ipc'
import type { MetricScope } from '@shared/metrics'
import type { PageFix } from '@shared/page-fixes'
import type { WidgetEngine, WidgetScope } from '@shared/summary-board'
import { useEngineRevision } from '../../shell/engineRevision'
import type { ChartEvent } from '../../ui'
import type { OverviewClient } from '../client'
import type { OverviewQuery } from '../hooks/useOverviewRoute'
import { useCachedRead, type CachedRead } from './useCachedRead'

/** Everything a widget may read: the overview the screen loaded, and its sources. */
export interface WidgetEnv {
  projectId: string
  data: VisibilityOverview
  /** "all markets", or the picked market. */
  marketLabel: string
  /** Engines the project checks (Google AI Overview at least). */
  offered: readonly EngineId[]
  source: OverviewClient
  query: OverviewQuery
  setQuery: (patch: Partial<OverviewQuery>) => void
  addHref: string
  /** Each offered engine's counts over Summary's questions (headline on one engine). */
  engineCounts: readonly EngineCounts[]
  /** Each question's latest answer on each engine. */
  engineQuestions: readonly QuestionEngineStatuses[]
  /** Page fixes to do (the Fixes badge). Null while unknown. */
  pageFixes: number | null
  allFixes: readonly PageFix[] | null
  nextFixes: readonly PageFix[] | null
  /** Every fix and unlogged page change, as chart markers. */
  marks: readonly ChartEvent[]
}

/** The metrics scope of a widget's scope (the project when none). */
export function metricScope(scope: WidgetScope | undefined): MetricScope {
  if (scope === undefined || scope.kind === 'project' || scope.id === undefined) {
    return { kind: 'project' }
  }
  return { kind: scope.kind, id: scope.id }
}

/** A short key for a scope, for drill ids and cache keys. */
export function scopeKey(scope: MetricScope): string {
  return scope.kind === 'project' ? 'project' : `${scope.kind}-${scope.id}`
}

/**
 * The shared metrics (`reports:metrics`, the same numbers as Reports) for one scope and
 * engine, latest checks against each question's previous check (`from: null`: the latest
 * checks alone, with every earlier check in the history, for a trend). Null source: none.
 */
export function useWidgetMetrics(
  env: WidgetEnv,
  scope: MetricScope,
  engine: WidgetEngine,
  from: 'previous' | null = 'previous'
): CachedRead<MetricsResult> {
  const revision = useEngineRevision()
  const read = env.source['reports:metrics']
  const marketId = env.query.market ?? null
  const key =
    read === undefined
      ? null
      : `metrics|${env.projectId}|${scopeKey(scope)}|${marketId ?? ''}|${engine}|${from ?? 'none'}|${revision}`
  return useCachedRead(key, () => {
    if (read === undefined) return Promise.reject(new Error('No metrics source'))
    return read({
      projectId: env.projectId,
      scope,
      marketId,
      engine,
      from,
      to: null
    })
  })
}

/**
 * Google AI Overview reads the Summary's own (Google) numbers. All reads the shared
 * metrics (owner option A: a question counts once, cited when any engine cites you), the
 * same numbers as Reports; only a source without the metrics channel falls back to
 * Google's.
 */
export function readsSummaryNumbers(env: Pick<WidgetEnv, 'source'>, engine: WidgetEngine): boolean {
  if (engine === 'google_aio') return true
  return engine === 'all' && env.source['reports:metrics'] === undefined
}
