import type { MetricPair, MetricRow, QuestionHistory } from './types'
import { questionKey } from './window'

/**
 * Each question's result at every check inside the window, oldest first: the history
 * strip. The window starts at the `from` row (or the `from` moment) and ends at the `to`
 * row; without a `from` end, every earlier check counts.
 */
export function questionHistory(
  rows: readonly MetricRow[],
  pairs: readonly MetricPair[],
  from: string | 'previous' | null
): QuestionHistory[] {
  const byKey = new Map<string, MetricRow[]>()
  for (const row of rows) {
    const key = questionKey(row)
    const list = byKey.get(key) ?? []
    list.push(row)
    byKey.set(key, list)
  }
  return pairs.map((pair) => {
    const start =
      from === null
        ? null
        : from === 'previous'
          ? (pair.from?.checkedAt ?? pair.to.checkedAt)
          : from
    const end = pair.to.checkedAt
    const points = (byKey.get(pair.key) ?? [])
      .filter((row) => row.checkedAt <= end && (start === null || row.checkedAt >= start))
      .sort(
        (left, right) =>
          left.checkedAt.localeCompare(right.checkedAt) || left.checkId.localeCompare(right.checkId)
      )
      .map((row) => ({
        rowId: row.id,
        checkId: row.checkId,
        checkedAt: row.checkedAt,
        result: row.result,
        position: row.position,
        named: row.named
      }))
    return {
      key: pair.key,
      questionId: pair.to.questionId,
      engine: pair.to.engine,
      marketId: pair.to.marketId,
      points
    }
  })
}
