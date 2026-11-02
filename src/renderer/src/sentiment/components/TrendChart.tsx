import type { JSX } from 'react'
import type { SentimentCheckPoint } from '@shared/domain'
import { formatNet } from '@shared/sentiment-metrics'
import { DrillButton, DrillFigure, useDrill, type DrillRequest } from '../../drill'
import { ChartHeadline, SectionHead, TrendChart as Chart, type ChartEvent } from '../../ui'
import { formatDay, formatMoment } from '../../utils/dates'
import type { SentimentDrills } from '../drills'
import { countNoun, layoutTrend } from '../utils/model'

const BOX = { left: 0, right: 1, top: 0, bottom: 1 }
const TICKS = [-100, -50, 0, 50, 100]

/**
 * FR-16.4: net sentiment per full check on a time-true axis (NFR-15), in the
 * shared chart style, with the claim count under each check. A check below 5
 * claims is drawn hollow and kept out of the line. Every check's dot and claim
 * count opens the claims of that check (NFR-14). Fixes in the project and Google
 * updates sit as markers under the line.
 */
export function TrendChart({
  brand,
  marketText,
  trend,
  drills,
  events = [],
  onOpenEvent,
  trackingPages
}: {
  brand: string
  marketText: string
  trend: readonly SentimentCheckPoint[]
  drills: SentimentDrills
  events?: readonly ChartEvent[]
  onOpenEvent?: (event: ChartEvent) => void
  /** The pages this chart counts: only their question changes get a tracking marker. */
  trackingPages?: ReadonlySet<string>
}): JSX.Element {
  const { open } = useDrill()
  const points = layoutTrend(trend, BOX)
  const latestRunId = trend.at(-1)?.runId ?? null
  const runDrill = (point: SentimentCheckPoint): DrillRequest =>
    drills.claims(
      {
        id: `trend:${point.runId}`,
        title: `Claims about ${brand} · ${formatMoment(point.checkedAt)} check`,
        description:
          point.runId === latestRunId
            ? `Every claim about ${brand} in the latest full check.`
            : `Every claim about ${brand} in the full check of ${formatMoment(point.checkedAt)}.`,
        checkDateLabel: formatMoment(point.checkedAt),
        everySource: true
      },
      drills.runClaimIds(point.runId)
    )
  const byRun = new Map(points.map((item) => [item.point.runId, item]))
  const known = points.filter((item) => item.net !== null)
  const latest = known.at(-1) ?? null
  const before = known.at(-2) ?? null
  const change = latest && before ? (latest.net ?? 0) - (before.net ?? 0) : null
  const aria = `Net sentiment about ${brand} over ${countNoun(trend.length, 'check', 'checks')}: ${points
    .map(
      (item) =>
        `${formatDay(item.point.checkedAt, { year: false })} ${formatNet(item.net)} from ${countNoun(item.total, 'claim', 'claims')}`
    )
    .join('; ')}.`

  return (
    <section className="st-card" aria-labelledby="st-trend-h">
      <SectionHead
        id="st-trend-h"
        title="Net sentiment over time"
        description={`${marketText} · claim counts under each check · select a check to list its claims`}
      />
      {trend.length === 0 ? (
        <p className="muted">No full check yet.</p>
      ) : (
        <>
          <ChartHeadline
            label="Latest check"
            value={latest ? formatNet(latest.net) : '—'}
            delta={
              change === null || !before
                ? null
                : {
                    text: `${change === 0 ? 'No change' : Math.abs(change)} since ${formatDay(before.point.checkedAt, { year: false })}`,
                    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
                  }
            }
          />
          <Chart
            label={aria}
            series={[
              {
                id: 'net',
                label: 'Net sentiment',
                color: 'var(--chart-2)',
                points: points.map((item) => ({
                  key: item.point.runId,
                  at: item.point.checkedAt,
                  value: item.net ?? 0,
                  hollow: item.net === null
                }))
              }
            ]}
            yTicks={TICKS}
            yFormat={(value) => formatNet(value)}
            height={170}
            events={events}
            onOpenEvent={onOpenEvent}
            {...(trackingPages ? { trackingPages } : {})}
            readoutTitle={(_key, at) => formatMoment(at)}
            readout={(key) => {
              const item = byRun.get(key)
              if (!item) return null
              return (
                <>
                  <p className="ui-chart-card-row">
                    <span>Net</span>
                    <strong className="num">
                      {item.net === null ? 'Not enough data' : formatNet(item.net)}
                    </strong>
                  </p>
                  <p className="ui-chart-card-line">
                    {item.point.positive} positive · {item.point.neutral} neutral ·{' '}
                    {item.point.negative} negative
                  </p>
                </>
              )
            }}
            pointControl={({ point, x, y, onFocus, onBlur }) => {
              const item = byRun.get(point.key)
              if (!item) return null
              const day = formatDay(item.point.checkedAt, { year: false })
              return (
                <button
                  type="button"
                  className="st-point"
                  style={{ left: x, top: y }}
                  aria-label={`${day}: net ${formatNet(item.net)}, show its claims`}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  onClick={() => open(runDrill(item.point))}
                />
              )
            }}
          />
          <ol className="st-trend-foot">
            {points.map((item) => {
              const drill = runDrill(item.point)
              const day = formatDay(item.point.checkedAt, { year: false })
              return (
                <li key={item.point.runId}>
                  <DrillButton
                    drill={drill}
                    label={`${day} · ${countNoun(item.total, 'claim', 'claims')}, show them`}
                    className="st-drill"
                  >
                    {day} · <DrillFigure drill={drill} /> {item.total === 1 ? 'claim' : 'claims'}
                  </DrillButton>
                  {item.net === null ? <span className="faint"> · not enough data</span> : null}
                </li>
              )
            })}
          </ol>
          <ul className="sr-only" aria-label={`Net sentiment about ${brand} per full check`}>
            {points.map((item) => (
              <li key={item.point.runId}>
                {formatDay(item.point.checkedAt)}: net {formatNet(item.net)}, {item.point.positive}{' '}
                positive, {item.point.neutral} neutral, {item.point.negative} negative
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
