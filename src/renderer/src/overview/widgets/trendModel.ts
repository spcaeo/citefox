import type { MetricsResult } from '@shared/ipc'
import type { MetricRow } from '@shared/metrics'

/**
 * A trend over the shared metrics' history: at each check in scope, the questions whose
 * latest result by then cites you, and those with an AI answer. Each point keeps the rows
 * it counts, so a point opens exactly them. Pure.
 */
export interface TrendStep {
  key: string
  at: string
  cited: readonly MetricRow[]
  answered: readonly MetricRow[]
}

const CITED = new Set(['target', 'other'])
const ANSWERED = new Set(['target', 'other', 'not_cited'])

/** The latest `limit` checks' standing, oldest first. */
export function trendSteps(
  result: Pick<MetricsResult, 'history' | 'checks' | 'rows'>,
  limit = 12
): TrendStep[] {
  // A row per question to borrow its text and source from (history points carry none).
  const template = new Map<string, MetricRow>()
  for (const row of Object.values(result.rows)) {
    if (!template.has(row.questionId)) template.set(row.questionId, row)
  }
  const checks = [...result.checks].sort((a, b) => a.at.localeCompare(b.at)).slice(-limit)
  return checks.map((check) => {
    const cited: MetricRow[] = []
    const answered: MetricRow[] = []
    for (const question of result.history) {
      let latest: (typeof question.points)[number] | null = null
      for (const point of question.points) {
        if (point.checkedAt <= check.at) latest = point
      }
      const base = template.get(question.questionId)
      if (latest === null || base === undefined) continue
      const row: MetricRow = {
        ...base,
        id: latest.rowId,
        engine: question.engine,
        marketId: question.marketId,
        checkId: latest.checkId,
        checkedAt: latest.checkedAt,
        result: latest.result,
        position: latest.position
      }
      if (ANSWERED.has(latest.result)) answered.push(row)
      if (CITED.has(latest.result)) cited.push(row)
    }
    return { key: check.id, at: check.at, cited, answered }
  })
}

/** Cited at the latest step before `day` and at the first step on or after it. */
export function aroundDay(
  steps: readonly TrendStep[],
  startedOn: string,
  finishedOn: string | null
): { before: TrendStep | null; after: TrendStep | null } {
  const start = `${startedOn}T00:00:00.000Z`
  const end = finishedOn === null ? null : `${finishedOn}T23:59:59.999Z`
  let before: TrendStep | null = null
  let after: TrendStep | null = null
  for (const step of steps) {
    if (step.at < start) before = step
    else if (end === null || step.at > end) {
      after ??= step
    }
  }
  // Still rolling out: compare with the latest check.
  if (end === null) after = steps.at(-1) ?? null
  if (after !== null && before !== null && after.key === before.key) after = null
  return { before, after }
}
