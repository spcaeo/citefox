import { Fragment, type JSX } from 'react'
import { formatMonthDay } from '../m3/model'
import { rateTicks, TrendChart, type ChartEvent, type TrendSeries } from '../ui'
import { formatMoment } from '../utils/dates'
import { checkedIds, noOverviewIds } from './progressDrills'
import { RunDrillButton, RunFigure } from './progressRuns'
import { useProgressRuns } from './progressRunsContext'
import { citedPromptIds, pointAccessibleName, type TrendBar } from './trends'

/**
 * FR-14.3. Page cited ÷ AI Overviews shown per check on a time-true axis, in the
 * shared chart style. Partial checks are hollow and left out of the line; a new
 * question set starts a new line. Fixes on this page and Google updates sit as
 * markers on the baseline; a fix marker opens that fix in its drawer. Under each
 * date, the questions checked open the check's questions.
 */
export function RateChart({
  bars,
  events,
  name,
  selectedId,
  onSelect,
  onOpenEvent,
  trackingPages
}: {
  bars: readonly TrendBar[]
  /** Fixes logged on this page in this market (`fixEvents`). */
  events: readonly ChartEvent[]
  name: string
  selectedId: string | null
  onSelect: (bar: TrendBar) => void
  onOpenEvent: (event: ChartEvent) => void
  /** The pages this chart counts: only their question changes get a tracking marker. */
  trackingPages?: ReadonlySet<string>
}): JSX.Element {
  const runs = useProgressRuns()
  const byId = new Map(bars.map((bar) => [bar.runId, bar]))
  const breaks = new Set(bars.filter((bar) => bar.versionChanged).map((bar) => bar.runId))
  const series: TrendSeries = {
    id: 'rate',
    label: 'Page cited',
    color: 'var(--chart-cited)',
    breakBefore: breaks,
    points: bars.map((bar) => ({
      key: bar.runId,
      at: bar.finishedAt,
      value: bar.rate,
      hollow: bar.partial
    }))
  }
  const peak = Math.max(0, ...bars.map((bar) => bar.rate ?? 0))

  return (
    <div className="vis-chart">
      <TrendChart
        label={name}
        series={[series]}
        yTicks={rateTicks(peak)}
        yFormat={(value) => `${Math.round(value * 100)}%`}
        height={210}
        events={events}
        onOpenEvent={onOpenEvent}
        {...(trackingPages ? { trackingPages } : {})}
        selectedKey={selectedId}
        readoutTitle={(key, at) => {
          const bar = byId.get(key)
          return `${formatMoment(at)}${bar ? ` · ${bar.event}${bar.partial ? ', partial' : ''}` : ''}`
        }}
        readout={(key) => {
          const bar = byId.get(key)
          if (!bar) return null
          return (
            <>
              <p className="ui-chart-card-row">
                <span>Page cited</span>
                <strong className="num">{bar.rateLabel}</strong>
              </p>
              <p className="ui-chart-card-line">{bar.citedLine}</p>
              <p className="ui-chart-card-line">{bar.coverageLabel}</p>
              {bar.versionChanged ? (
                <p className="ui-chart-card-line">The question set changed at this check.</p>
              ) : null}
            </>
          )
        }}
        pointControl={({ point, x, y, onFocus, onBlur }) => {
          const bar = byId.get(point.key)
          if (!bar || bar.rate === null) return null
          const day = formatMonthDay(bar.finishedAt)
          return (
            <button
              type="button"
              className="vis-point"
              style={{ left: x, top: y }}
              aria-pressed={selectedId === bar.runId}
              aria-label={pointAccessibleName(bar, day)}
              data-nfr-drill={`point:${bar.runId}`}
              onFocus={onFocus}
              onBlur={onBlur}
              onClick={() => onSelect(bar)}
            >
              <span className="sr-only" data-nfr-figure={`point:${bar.runId}`}>
                {citedPromptIds(bar).length}
              </span>
            </button>
          )
        }}
        axisRoom={bars.some((bar) => bar.rate === null) ? 2 * TICK_HEIGHT + 4 : TICK_HEIGHT + 6}
        axisControl={({ key, x, y }) => {
          const bar = byId.get(key)
          if (!bar) return null
          return <CheckedTick bar={bar} x={x} y={y} runs={runs} />
        }}
      />
    </div>
  )
}

/** A tick is a 24px-tall target (WCAG 2.5.8), so the No AI Overview tick sits a full tick below. */
const TICK_HEIGHT = 24

/**
 * "8 of 10" under a check's date: the questions that check measured, and for a
 * check with no AI Overview at all, the questions without one. Both open their list.
 */
function CheckedTick({
  bar,
  x,
  y,
  runs
}: {
  bar: TrendBar
  x: number
  y: number
  runs: ReturnType<typeof useProgressRuns>
}): JSX.Element {
  const day = formatMonthDay(bar.finishedAt)
  const results = runs ? runs.cached(runs.marketId, bar.runId) : undefined
  const text = `${bar.promptsChecked} of ${bar.promptsTotal}`
  if (!runs || !results) {
    return (
      <span className="vis-tick vis-tick-plain" style={{ left: x, top: y }} aria-hidden="true">
        {text}
      </span>
    )
  }
  const checked = checkedIds(results)
  const none = noOverviewIds(results)
  return (
    <Fragment>
      <RunDrillButton
        className="vis-tick"
        style={{ left: x, top: y }}
        label={`${day}: ${checked.length} of ${bar.promptsTotal} ${bar.promptsTotal === 1 ? 'question' : 'questions'} checked, show them`}
        copy={{
          id: `checked:${bar.runId}`,
          title: 'Questions checked',
          description: `Every question this ${bar.partial ? 'partial ' : ''}check measured on ${day}.`
        }}
        ids={checked}
        marketId={runs.marketId}
        runId={bar.runId}
      >
        <RunFigure id={`checked:${bar.runId}`} ids={checked} /> of {bar.promptsTotal}
      </RunDrillButton>
      {bar.rate === null && none.length > 0 ? (
        <RunDrillButton
          className="vis-tick vis-tick-noaio"
          style={{ left: x, top: y + TICK_HEIGHT }}
          label={`${day}: No AI Overview · ${none.length} ${none.length === 1 ? 'question' : 'questions'}, show them`}
          copy={{
            id: `noaio:${bar.runId}`,
            title: 'No AI Overview',
            description: `Questions with no AI Overview on ${day}, so this check has no rate.`
          }}
          ids={none}
          marketId={runs.marketId}
          runId={bar.runId}
        >
          No AI Overview · <RunFigure id={`noaio:${bar.runId}`} ids={none} />
        </RunDrillButton>
      ) : null}
    </Fragment>
  )
}
