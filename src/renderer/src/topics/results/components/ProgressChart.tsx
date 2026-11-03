import type { JSX } from 'react'
import { DrillLink } from '../../../drill'
import { TrendChart, type ChartEvent } from '../../../ui'
import { formatCheckTime, formatDate } from '../model/format'
import type { TopicBand } from '../types'

export interface ProgressSeriesPoint {
  runId: string
  at: string
  /** Whole percent; null when no prompt showed an overview. */
  rate: number | null
  cited: number
  withAio: number
}

export interface ProgressSeries {
  id: 'target' | 'questions' | 'keywords'
  label: string
  /** CSS colour (a token). */
  color: string
  /** Each series has its own marker, so they tell apart without colour. */
  marker: 'circle' | 'square' | 'diamond'
  points: readonly ProgressSeriesPoint[]
}

const TICKS = [0, 25, 50, 75, 100]

/**
 * Goal % per full check on a real-date axis (Topic-Overview "Progress"), in the
 * shared chart style: one smooth line per kind (the headline with its light fill),
 * the goal band behind, end labels on the last point, a hover card per check, and
 * markers for fixes on the topic's pages and Google updates. Each check's date is a
 * link that opens the topic as of that check (keyboard focus shows the same card).
 */
export function ProgressChart({
  series,
  band,
  bandLabel,
  topicId,
  marketId,
  events = [],
  onOpenEvent,
  trackingPages
}: {
  series: readonly ProgressSeries[]
  band: TopicBand
  bandLabel: string
  topicId: string
  marketId: string
  /** Fixes on this topic or its target page. */
  events?: readonly ChartEvent[]
  onOpenEvent?: (event: ChartEvent) => void
  /** The pages this chart counts: only their question changes get a tracking marker. */
  trackingPages?: ReadonlySet<string>
}): JSX.Element {
  const runs = new Map<string, string>()
  for (const line of series) for (const point of line.points) runs.set(point.runId, point.at)
  const described = [...runs.entries()]
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .map(([runId, at]) => {
      const values = series
        .map((line) => {
          const point = line.points.find((item) => item.runId === runId)
          return point?.rate == null ? null : `${line.label} ${point.rate}%`
        })
        .filter(Boolean)
        .join(', ')
      return `${formatDate(at)}: ${values}`
    })
    .join('; ')

  return (
    <figure className="tr-progress">
      <TrendChart
        label={`Cited rate per full check. ${described}. Target band ${band.lo} to ${band.hi}%.`}
        series={series.map((line) => ({
          id: line.id,
          label: line.label,
          color: line.color,
          shape: line.marker,
          area: line.id === 'target',
          points: line.points.map((point) => ({
            key: point.runId,
            at: point.at,
            value: point.rate
          }))
        }))}
        yTicks={TICKS}
        yFormat={(value) => `${value}%`}
        height={220}
        band={{ from: band.lo, to: band.hi }}
        endLabels
        events={events}
        onOpenEvent={onOpenEvent}
        {...(trackingPages ? { trackingPages } : {})}
        xLabel={(at) => formatDate(at)}
        readoutTitle={(_key, at) => formatCheckTime(at)}
        readout={(key) =>
          series.map((line) => {
            const point = line.points.find((item) => item.runId === key)
            if (!point) return null
            return (
              <p key={line.id} className="ui-chart-card-row">
                <span>
                  <span
                    className="ui-chart-key"
                    style={{ background: line.color }}
                    aria-hidden="true"
                  />
                  {line.label} · {point.cited} of {point.withAio}
                </span>
                <strong className="num">{point.rate === null ? '—' : `${point.rate}%`}</strong>
              </p>
            )
          })
        }
        axisRoom={8}
        axisControl={({ key, at, x, dateY, room, onFocus, onBlur }) => (
          <span
            className="tr-hit"
            // Never wider than the gap to the next check, so close checks do not overlap.
            style={{ left: x, top: dateY - 14, width: Math.min(56, Math.max(24, room)) }}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <DrillLink
              className="tr-hit-area"
              target={{ kind: 'topic', topicId, marketId, runId: key }}
              label={`Open the check of ${formatCheckTime(at)}`}
            >
              <span className="sr-only">{formatDate(at)}</span>
            </DrillLink>
          </span>
        )}
      />
      <div className="tr-progress-legend">
        {series.length > 1 ? (
          <ul aria-label="Legend">
            {series.map((line) => (
              <li key={line.id}>
                <span
                  className={`tr-legend-mark tr-legend-${line.marker}`}
                  style={{ background: line.color }}
                  aria-hidden="true"
                />
                {line.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <span className="tr-help">
          <span className="tr-band-key" aria-hidden="true" /> {bandLabel}
        </span>
      </div>
    </figure>
  )
}
