import type { JSX, ReactNode } from 'react'

/**
 * A chart card's headline: the big number, an optional "of N", and its change as a
 * soft pill (green up, orange down, grey flat). The number can be a drill control.
 */
export function ChartHeadline({
  label,
  value,
  of,
  delta,
  renderDelta
}: {
  label: string
  value: ReactNode
  /** "of 11 with an AI Overview". */
  of?: ReactNode
  delta?: { text: string; direction: 'up' | 'down' | 'flat' } | null
  /** Wraps the change pill, such as in a drill button that opens what moved. */
  renderDelta?: (pill: ReactNode) => ReactNode
}): JSX.Element {
  return (
    <div className="ui-chart-head">
      <div className="ui-chart-kpi">
        <span className="ui-chart-kpi-label">{label}</span>
        <span className="ui-chart-kpi-value num">
          {value}
          {of ? <span className="ui-chart-kpi-of">{of}</span> : null}
        </span>
      </div>
      {delta
        ? (renderDelta ?? same)(<DeltaPill text={delta.text} direction={delta.direction} />)
        : null}
    </div>
  )
}

function same(node: ReactNode): ReactNode {
  return node
}

export function DeltaPill({
  text,
  direction
}: {
  text: string
  direction: 'up' | 'down' | 'flat'
}): JSX.Element {
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '•'
  return (
    <span className={`ui-delta ui-delta-${direction}`}>
      <span aria-hidden="true">{arrow}</span> {text}
    </span>
  )
}
