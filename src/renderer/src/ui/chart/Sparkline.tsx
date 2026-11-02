import type { JSX } from 'react'
import { linearScale, monotonePath, segmentsOf, type Pt } from './scale'

/**
 * A small trend in a row or tile: the same smooth line as the big charts, a gap
 * where a value is missing, and a bright end point. The colour follows the
 * direction unless one is given (up green, down orange, flat grey).
 */
export function Sparkline({
  values,
  label,
  max = 100,
  width = 96,
  height = 28,
  color
}: {
  values: readonly (number | null)[]
  label: string
  max?: number
  width?: number
  height?: number
  /** A colour token. */
  color?: string
}): JSX.Element {
  const x = linearScale([0, Math.max(1, values.length - 1)], [4, width - 6])
  const y = linearScale([0, max], [height - 4, 4])
  const indexed = values.map((value, index) => ({ value, index }))
  const runs = segmentsOf(indexed, (item) => item.value !== null)
  const known = indexed.filter((item) => item.value !== null)
  const first = known[0]?.value ?? null
  const last = known[known.length - 1]
  const tone =
    color ??
    (first === null || last?.value == null || last.value === first
      ? 'var(--ink-4)'
      : last.value > first
        ? 'var(--chart-cited)'
        : 'var(--result-not-cited)')
  return (
    <svg
      className="ui-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      style={{ color: tone }}
    >
      {runs.map((run) => {
        const points: Pt[] = run.map((item) => [x(item.index), y(item.value ?? 0)])
        return <path key={run[0]?.index} className="ui-spark-line" d={monotonePath(points)} />
      })}
      {last ? (
        <circle className="ui-spark-end" cx={x(last.index)} cy={y(last.value ?? 0)} r={2.5} />
      ) : null}
    </svg>
  )
}
