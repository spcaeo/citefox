import type { MetricRow, MetricsResult } from '../../metrics/types'

/** The engine rows behind one `to` row: its parts under All engines counted once, else itself. */
export function engineRowsOf(metrics: MetricsResult, id: string): MetricRow[] {
  const row = metrics.rows[id]
  if (row === undefined) return []
  if (row.engine !== 'all') return [row]
  return (row.parts ?? []).flatMap((part) => {
    const found = metrics.rows[part]
    return found === undefined ? [] : [found]
  })
}
