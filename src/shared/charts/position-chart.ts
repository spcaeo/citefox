import { columnsChart, type BucketItem } from './columns'
import { percentShares } from './scale'
import type { ChartCommon, ChartMarkup, ChartTone } from './svg'

export type PositionKey = '1' | '2' | '3' | '4-5' | '6+' | 'none'

export interface PositionBucket {
  key: PositionKey
  label: string
  count: number
}

const BUCKETS: readonly {
  key: PositionKey
  label: string
  tone: ChartTone
  test: (p: number) => boolean
}[] = [
  { key: '1', label: '#1', tone: 'target', test: (p) => p === 1 },
  { key: '2', label: '#2', tone: 'target', test: (p) => p === 2 },
  { key: '3', label: '#3', tone: 'target', test: (p) => p === 3 },
  { key: '4-5', label: '#4–5', tone: 'target-soft', test: (p) => p >= 4 && p <= 5 },
  { key: '6+', label: '#6+', tone: 'muted', test: (p) => p >= 6 }
]

/**
 * Counts source positions (1 = first source in the answer) into #1, #2, #3, #4–5
 * and #6+, plus "Not cited" when `notCited` is given. Positions under 1 or not
 * whole are left out.
 */
export function positionBuckets(positions: readonly number[], notCited?: number): PositionBucket[] {
  const valid = positions.filter((p) => Number.isInteger(p) && p >= 1)
  const out: PositionBucket[] = BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: valid.filter(bucket.test).length
  }))
  if (notCited !== undefined)
    out.push({ key: 'none', label: 'Not cited', count: Math.max(0, notCited) })
  return out
}

export interface PositionChartInput extends ChartCommon {
  /** Your source position in each answer that cites you. */
  positions: readonly number[]
  /** Answers that do not cite you, drawn as an orange last column. */
  notCited?: number
  /** Drill ids become `${idPrefix}:1`, `:2`, `:3`, `:4-5`, `:6+`, `:none`. */
  idPrefix?: string
  height?: number
}

/** Where you sit among an answer's sources: how often #1, #2, #3, #4–5, #6+. */
export function positionChart(input: PositionChartInput): ChartMarkup {
  const buckets = positionBuckets(input.positions, input.notCited)
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const shares = percentShares(buckets.map((bucket) => bucket.count))
  const items: BucketItem[] =
    total === 0
      ? []
      : buckets.map((bucket, index) => ({
          id: input.idPrefix ? `${input.idPrefix}:${bucket.key}` : null,
          label: bucket.label,
          value: bucket.count,
          tone:
            bucket.key === 'none'
              ? 'not-cited'
              : (BUCKETS.find((b) => b.key === bucket.key)?.tone ?? 'muted'),
          sub: `${shares[index] ?? 0}%`
        }))
  return columnsChart('positions', {
    ...input,
    items,
    height: input.height ?? 180,
    valueWords: 'answers',
    emptyText: input.emptyText ?? 'Not cited in any answer yet'
  })
}
