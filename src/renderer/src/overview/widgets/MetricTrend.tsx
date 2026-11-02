import { useEffect, useMemo, type JSX, type ReactNode } from 'react'
import { DrillNumber, opaqueId, useDrill, type ItemDrill } from '../../drill'
import { fixEvents, fixesFor, subjectLabels } from '../../fixes/chartEvents'
import { useChartFixes } from '../../fixes/hooks/useChartFixes'
import { openChartEvent } from '../../pageChanges/actions'
import { usePageChangeEvents } from '../../pageChanges/hooks'
import { ChartHeadline, countTicks, TrendChart } from '../../ui'
import { formatDay } from '../../utils/dates'
import type { BoardWidget } from '@shared/summary-board'
import { metricScope, scopeKey, useWidgetMetrics, type WidgetEnv } from './env'
import { engineWords, metricRowsDrill, widgetScope } from './metricDrills'
import { trendSteps } from './trendModel'
import { WidgetCard, WidgetNote } from './WidgetCard'

/**
 * Trend with markers for any topic, page or engine (the shared metrics' history): at
 * each check, the questions whose latest answer cites you, on the shared chart with your
 * fixes, Google updates and unlogged page changes as markers. Each point opens its rows.
 */
export function MetricTrend({
  widget,
  env,
  tools
}: {
  widget: BoardWidget
  env: WidgetEnv
  tools: ReactNode
}): JSX.Element {
  const scope = useMemo(() => metricScope(widget.config.scope), [widget.config.scope])
  const subjectId = scope.kind === 'project' ? null : scope.id
  // The latest checks alone, with every earlier check in the history: the whole trend.
  const metrics = useWidgetMetrics(env, scope, widget.engine, null)
  const { open, register } = useDrill()
  const words = engineWords(widget.engine)
  const name = widget.config.label ?? (scope.kind === 'project' ? null : 'this ' + scope.kind)
  const title = name === null ? 'Cited over time' : `Cited over time: ${name}`
  const fixList = useChartFixes(env.projectId)
  const subjects = useMemo(() => (subjectId === null ? null : new Set([subjectId])), [subjectId])
  const fixMarks = useMemo(
    () =>
      fixEvents(fixesFor(fixList, subjects), {
        now: new Date(),
        pageLabel: subjectLabels(fixList)
      }),
    [fixList, subjects]
  )
  const pageMarks = usePageChangeEvents(env.projectId, scope.kind === 'page' ? subjects : null)
  const events = useMemo(
    () => (scope.kind === 'topic' ? fixMarks : [...fixMarks, ...pageMarks]),
    [scope.kind, fixMarks, pageMarks]
  )
  const steps = useMemo(
    () => (metrics.data === null ? null : trendSteps(metrics.data)),
    [metrics.data]
  )
  const drills = useMemo(() => {
    const out = new Map<string, ItemDrill>()
    if (steps === null) return out
    const drillScope = widgetScope(env.data, env.marketLabel)
    for (const step of steps) {
      out.set(
        step.key,
        metricRowsDrill(
          step.cited,
          {
            id: `w:trend:${widget.engine}:${opaqueId(scopeKey(scope))}:${opaqueId(step.key)}`,
            title: `Cited ${words} at the check of ${formatDay(step.at, { year: false })}`,
            description: `Questions whose latest answer ${words} by that check cites you.`
          },
          drillScope
        )
      )
    }
    return out
  }, [steps, env.data, env.marketLabel, widget.engine, words, scope])
  useEffect(() => {
    for (const drill of drills.values()) register(drill)
  }, [drills, register])

  if (steps === null) {
    return (
      <WidgetCard title={title} tools={tools}>
        <WidgetNote loading={metrics.loading} error={metrics.error} />
      </WidgetCard>
    )
  }
  if (steps.length === 0) {
    return (
      <WidgetCard title={title} tools={tools}>
        <WidgetNote>No checks {words} yet.</WidgetNote>
      </WidgetCard>
    )
  }
  const last = steps[steps.length - 1]
  const first = steps[0]
  const lastDrill = last ? drills.get(last.key) : undefined
  const top = Math.max(1, ...steps.map((step) => step.answered.length))
  const delta = last && first && steps.length > 1 ? last.cited.length - first.cited.length : null
  return (
    <WidgetCard title={title} tools={tools} className="ov-chart">
      <div className="ov-chart-body">
        <ChartHeadline
          label="Latest check"
          value={
            lastDrill ? (
              <DrillNumber
                drill={lastDrill}
                label={`${lastDrill.items.length} cited ${words} at the latest check`}
              />
            ) : (
              '—'
            )
          }
          of={
            <span className="ov-meta num">
              of {last?.answered.length ?? 0} with an AI answer {words}
            </span>
          }
          delta={
            delta === null
              ? null
              : {
                  text: `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} since ${formatDay(first?.at ?? null, { year: false })}`,
                  direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
                }
          }
        />
        <TrendChart
          label={`Cited questions ${words} at each check.`}
          series={[
            {
              id: 'cited',
              label: 'Cited questions',
              color: 'var(--chart-cited)',
              points: steps.map((step) => ({
                key: step.key,
                at: step.at,
                value: step.cited.length
              }))
            }
          ]}
          yTicks={countTicks(top)}
          yFormat={(value) => String(value)}
          height={widget.size === 'm' ? 110 : 150}
          events={events}
          onOpenEvent={openChartEvent}
          readoutTitle={(_key, at) => `Check of ${formatDay(at, { year: false })}`}
          readout={(key) => {
            const step = steps.find((item) => item.key === key)
            if (!step) return null
            return (
              <p className="ui-chart-card-row">
                <span>Cited</span>
                <strong className="num">
                  {step.cited.length} of {step.answered.length}
                </strong>
              </p>
            )
          }}
          pointControl={({ point, x, y, onFocus, onBlur }) => {
            const drill = drills.get(point.key)
            if (!drill || drill.items.length === 0) return null
            return (
              <button
                type="button"
                className="ov-point"
                style={{ left: x, top: y }}
                aria-label={`Check of ${formatDay(point.at, { year: false })}: ${drill.items.length} cited. Open them`}
                data-nfr-drill={drill.id}
                data-drill-open=""
                onFocus={onFocus}
                onBlur={onBlur}
                onMouseEnter={onFocus}
                onMouseLeave={onBlur}
                onClick={() => open(drill)}
              >
                <span className="sr-only" data-nfr-figure={drill.id}>
                  {drill.items.length}
                </span>
              </button>
            )
          }}
        />
      </div>
    </WidgetCard>
  )
}
