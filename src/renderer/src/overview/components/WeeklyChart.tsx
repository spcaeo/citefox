import { useEffect, useMemo, type JSX, type ReactNode } from 'react'
import type { OverviewWeek } from '@shared/ipc'
import { AskSparkle } from '../../assistant/sparkle/AskSparkle'
import { DrillButton, DrillNumber, useDrill, type ItemDrill } from '../../drill'
import { ChartHeadline, countTicks, Panel, TrendChart, type ChartEvent } from '../../ui'
import { formatDay } from '../../utils/dates'
import { nounCount, QUESTION_NOUN, weeklyTrend, type CountNoun } from '../model'

/**
 * Searches (or questions) where you're cited, by week, in the shared chart style:
 * this week's count big with its change since the first check, then a smooth line
 * of each week's state at its end, on a scale of the most searches with an AI
 * Overview in any week. Weeks before the first check are a gap, said once in words.
 * Every fix in the project and Google's updates sit as markers under the line.
 */
export function WeeklyChart({
  weeks,
  aio,
  weekDrill,
  change,
  noun = QUESTION_NOUN,
  events = [],
  onOpenEvent,
  tools
}: {
  weeks: readonly OverviewWeek[]
  /** The searches with an AI Overview now (the scale), which "of N" opens. */
  aio: ItemDrill
  /** The searches cited at the end of week `index`: what its point opens. */
  weekDrill?: (index: number) => ItemDrill
  /** The searches behind "N since the first check". */
  change?: ItemDrill
  /** "search" when keywords are tracked too. */
  noun?: CountNoun
  /** Every fix logged in the project. */
  events?: readonly ChartEvent[]
  onOpenEvent?: (event: ChartEvent) => void
  /** The widget's own controls (its engine filter), after the AI sparkle. */
  tools?: ReactNode
}): JSX.Element {
  const withAio = aio.items.length
  const trend = weeklyTrend(weeks, noun)
  const title = `${noun.Many} where you’re cited, by week`
  const last = weeks.length - 1
  const { open, register } = useDrill()
  // Each checked week's cited searches, by its end: what its point and the big number open.
  const drills = useMemo(() => {
    const out = new Map<string, ItemDrill>()
    if (!weekDrill) return out
    weeks.forEach((week, index) => {
      if (week.cited !== null && week.searches !== undefined) out.set(week.endsAt, weekDrill(index))
    })
    return out
  }, [weeks, weekDrill])
  // A copied link to a week's drill reopens it: register every week, not only the hovered one.
  useEffect(() => {
    for (const drill of drills.values()) register(drill)
  }, [drills, register])
  const thisWeek = weeks[last] ? drills.get(weeks[last].endsAt) : undefined
  return (
    <Panel
      title={title}
      padding={16}
      className="ov-chart ai-spark-host"
      actions={
        <>
          <AskSparkle target={{ kind: 'chart', label: title }} />
          {tools}
        </>
      }
    >
      <div className="ov-chart-body">
        <ChartHeadline
          label="This week"
          value={
            trend.latest === null ? (
              '—'
            ) : thisWeek ? (
              <DrillNumber
                drill={thisWeek}
                label={`${nounCount(thisWeek.items.length, noun)} cited this week`}
              />
            ) : (
              trend.latest
            )
          }
          of={
            <span className="ov-meta num">
              of{' '}
              <DrillNumber
                drill={aio}
                suffix={` ${withAio === 1 ? noun.one : noun.many}`}
                label={`of ${nounCount(withAio, noun)} with an AI Overview`}
              />{' '}
              with an AI Overview
            </span>
          }
          delta={trend.delta}
          {...(change && change.items.length > 0
            ? {
                renderDelta: (pill) => (
                  <DrillButton
                    drill={change}
                    className="ov-trend-btn"
                    label={`${trend.delta?.text ?? 'Change since the first check'}: open the ${nounCount(change.items.length, noun)} that moved`}
                    untracked
                  >
                    {pill}
                  </DrillButton>
                )
              }
            : {})}
        />
        <TrendChart
          label={`Cited ${noun.many} per week. ${trend.described}.`}
          series={[
            {
              id: 'cited',
              label: `Cited ${noun.many}`,
              color: 'var(--chart-cited)',
              points: trend.points
            }
          ]}
          yTicks={countTicks(trend.top)}
          yFormat={(value) => String(value)}
          height={150}
          events={events}
          onOpenEvent={onOpenEvent}
          gapNote={trend.gapNote}
          xLabel={(at, index) => (index === last ? 'This week' : formatDay(at, { year: false }))}
          readoutTitle={(_key, at) => `Week to ${formatDay(at, { year: false })}`}
          readout={(key) => {
            const week = weeks.find((item) => item.endsAt === key)
            if (!week) return null
            return week.cited === null ? (
              <p className="ui-chart-card-line">Not checked yet</p>
            ) : (
              <>
                <p className="ui-chart-card-row">
                  <span>Cited</span>
                  <strong className="num">
                    {week.cited} of {nounCount(week.withAio ?? 0, noun)}
                  </strong>
                </p>
                {drills.has(key) && week.cited > 0 ? (
                  <p className="ui-chart-card-line">Select the point to see them</p>
                ) : null}
              </>
            )
          }}
          pointControl={({ point, x, y, onFocus, onBlur }) => {
            const drill = drills.get(point.key)
            if (!drill || drill.items.length === 0) return null
            const day = formatDay(point.at, { year: false })
            return (
              <button
                type="button"
                className="ov-point"
                style={{ left: x, top: y }}
                aria-label={`Week to ${day}: ${nounCount(drill.items.length, noun)} cited. Open them`}
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
    </Panel>
  )
}
