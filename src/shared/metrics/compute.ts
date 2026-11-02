import { allSegments, engineRows, domainRows, type BreakdownInput } from './breakdowns'
import { compare, isCompared, sideCounts } from './counts'
import { questionHistory } from './history'
import { checksIn, enginesIn, mergeEngines } from './merge'
import { pageMetrics } from './pages'
import { ALL_ENGINES_COUNTING } from './settings'
import type { MetricRow, MetricsInput, MetricsResult, MetricWindow } from './types'
import { filterRows, resolveWindow, type ResolvedWindow } from './window'

/**
 * Every number of one scope × market × engine × window (Docs/METRICS.md). The reports,
 * the IPC channel `reports:metrics` and the screens read this; each count carries the
 * row ids behind it.
 *
 * "All engines" counts as `input.counting` says (default `ALL_ENGINES_COUNTING`): with
 * `once`, each question in each check is one `all` row (merge.ts) and the engines'
 * own rows sit in `rows` as its `parts`. The engine breakdown always counts per engine.
 */
export function computeMetrics(input: MetricsInput): MetricsResult {
  const counting = input.counting ?? ALL_ENGINES_COUNTING
  const scoped = filterRows(input.rows, { ...input, engine: 'all' })
  const perEngine =
    input.engine === 'all' ? scoped : scoped.filter((row) => row.engine === input.engine)
  const merging = input.engine === 'all' && counting === 'once'
  const rows = merging ? mergeEngines(perEngine) : perEngine
  const window = resolveWindow(rows, input.window)
  const breakdown = breakdownOf(window, input.window)
  const engineWindow = merging ? resolveWindow(perEngine, input.window) : window
  const at = input.window.to ?? latestCheck(window.to)
  const used = new Map<string, MetricRow>()
  const partsById = merging ? new Map(perEngine.map((row) => [row.id, row])) : null
  const keep = (row: MetricRow): void => {
    used.set(row.id, row)
    for (const id of row.parts ?? []) {
      const part = partsById?.get(id)
      if (part !== undefined) used.set(id, part)
    }
  }
  window.to.forEach(keep)
  for (const pair of window.pairs) if (pair.from !== null) keep(pair.from)
  window.noAfter.forEach(keep)
  if (merging) {
    engineWindow.to.forEach(keep)
    for (const pair of engineWindow.pairs) if (pair.from !== null) keep(pair.from)
  }
  return {
    scope: input.scope,
    marketId: input.marketId,
    engine: input.engine,
    window: input.window,
    counting,
    offeredEngines: enginesIn(scoped),
    checks: checksIn(scoped),
    now: sideCounts(window.to),
    comparison: input.window.from !== null ? compare(window.pairs, window.noAfter) : null,
    segments: allSegments(breakdown),
    domains: domainRows(breakdown, input.ownDomain),
    pages: pageMetrics(breakdown, input.pages ?? [], at),
    engines: engineRows(breakdownOf(engineWindow, input.window)),
    history: questionHistory(rows, window.pairs, input.window.from),
    fromOf: Object.fromEntries(
      window.pairs.flatMap((pair) => (pair.from === null ? [] : [[pair.to.id, pair.from.id]]))
    ),
    rows: Object.fromEntries(used)
  }
}

function breakdownOf(window: ResolvedWindow, asked: MetricWindow): BreakdownInput {
  return {
    to: window.to,
    compared: asked.from !== null ? window.pairs.filter(isCompared) : null
  }
}

function latestCheck(rows: readonly MetricRow[]): string | null {
  let at: string | null = null
  for (const row of rows) if (at === null || row.checkedAt > at) at = row.checkedAt
  return at
}
