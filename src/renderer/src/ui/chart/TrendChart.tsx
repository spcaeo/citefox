import {
  useContext,
  useId,
  useMemo,
  useState,
  type JSX,
  type PointerEvent,
  type ReactNode
} from 'react'
import { GOOGLE_UPDATES } from '@shared/google-updates'
import { formatDay, formatMoment } from '../../utils/dates'
import { useNodeWidth } from '../listGrid/useElementWidth'
import { ChartCard } from './ChartCard'
import { ChartMarkers, type PlacedStack } from './ChartMarkers'
import { MarkerToggles } from './MarkerToggles'
import {
  googleEvents,
  measuringBands,
  rolloutBands,
  joinCrowded,
  stackMarkers,
  visibleEvents,
  type ChartEvent,
  type MarkerKind
} from './markers'
import {
  areaPath,
  linearScale,
  monotonePath,
  nearestIndex,
  segmentsOf,
  spreadLabels,
  timeExtent
} from './scale'
import { TrackingChangesContext, trackingEvents } from './tracking'
import { useMarkerToggles } from './useMarkerToggles'

export interface TrendPoint {
  /** The check (run id) or week this value belongs to. */
  key: string
  /** ISO moment on the time-true axis. */
  at: string
  /** Null: no data here; the line breaks. */
  value: number | null
  /** A partial check or too little data: drawn hollow, left out of the line. */
  hollow?: boolean
}

export interface TrendSeries {
  id: string
  label: string
  /** A colour token, `var(--…)`. */
  color: string
  points: readonly TrendPoint[]
  /** The light fill under the line. Default: the first series only. */
  area?: boolean
  dashed?: boolean
  /** The mark on each check, so lines tell apart without colour. */
  shape?: 'circle' | 'square' | 'diamond'
  /** A new line starts at these keys even when the point before has a value. */
  breakBefore?: ReadonlySet<string>
}

export interface PointControlArgs {
  series: TrendSeries
  point: TrendPoint
  x: number
  y: number
  /** Show this check's card while the control has focus. */
  onFocus: () => void
  onBlur: () => void
}

export interface AxisControlArgs {
  key: string
  at: string
  /** Centre of the check. */
  x: number
  /** Baseline of the date labels. */
  dateY: number
  /** Top of the row under the dates. */
  y: number
  /** Px to the nearest other check (Infinity when alone): a control wider than this overlaps its neighbour. */
  room: number
  onFocus: () => void
  onBlur: () => void
}

export interface TrendChartProps {
  /** Accessible name of the whole chart. */
  label: string
  series: readonly TrendSeries[]
  yTicks: readonly number[]
  yFormat: (value: number) => string
  /** Plot height in px. */
  height?: number
  /** A goal band behind the lines, in y units. */
  band?: { from: number; to: number } | null
  /** Markers that touch what this chart shows (fixes, page changes). Google updates are added. */
  events?: readonly ChartEvent[]
  /** False: no markers row at all (a chart with no time story, such as a sparkline-sized card). */
  markers?: boolean
  /** A fix marker was clicked: open its drawer in place. */
  onOpenEvent?: (event: ChartEvent) => void
  /** The hover card's body for one check. Default: each series' value. */
  readout?: (key: string) => ReactNode
  /** The hover card's first line. Default: the check's date and time. */
  readoutTitle?: (key: string, at: string) => string
  /** A drill control over each drawn point (the "every number drills" rule). */
  pointControl?: (args: PointControlArgs) => ReactNode
  /** A control for each check on the date row (such as "8 of 10 checked"). */
  axisControl?: (args: AxisControlArgs) => ReactNode
  /** Room under the dates for the axis controls, in px. */
  axisRoom?: number
  selectedKey?: string | null
  /** Said once in words where the line has no data (such as before the first check). */
  gapNote?: string | null
  /** The date under a check. Default "Oct 23". */
  xLabel?: (at: string, index: number, count: number) => string
  /** Value label beside each line's end point. */
  endLabels?: boolean
  /** Extra times the axis must reach (a planned fix). */
  extraTimes?: readonly string[]
  /**
   * The pages this chart counts, so only their question changes get a tracking
   * marker (engines, markets and the schedule always do). Absent: every page's.
   */
  trackingPages?: ReadonlySet<string> | null
}

const PAD_LEFT = 44
const PAD_TOP = 14
/** Event markers' centre below the axis line: a point's radius plus a marker's. */
const MARKER_LANE = 28
const FALLBACK_WIDTH = 720

/**
 * The one trend chart of the app (owner-approved mock-up, 2026-10-30): a smooth
 * line with a light fill, a faint dashed grid, a bright end point, a hover line
 * that reads out each check, gaps where there is no data, and markers along the
 * baseline for fixes, Google updates, page changes and tracking changes. Drawn at its real width so
 * dots stay round and text keeps its size. Days are spaced to scale.
 */
export function TrendChart({
  label,
  series,
  yTicks,
  yFormat,
  height = 200,
  band = null,
  events = [],
  markers = true,
  onOpenEvent,
  readout,
  readoutTitle,
  pointControl,
  axisControl,
  axisRoom = 34,
  selectedKey = null,
  gapNote = null,
  xLabel,
  endLabels = false,
  extraTimes = [],
  trackingPages = null
}: TrendChartProps): JSX.Element {
  const rawId = useId()
  const gradientId = `trend-fill-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const rolloutId = `trend-roll-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const measured = useNodeWidth(node)
  const W = measured > 0 ? measured : FALLBACK_WIDTH
  const [hover, setHover] = useState<number | null>(null)
  const { hidden, toggle } = useMarkerToggles()

  // Every check across the series, oldest first: the hover line snaps to these.
  const checks = useMemo(() => {
    const map = new Map<string, string>()
    for (const line of series) for (const point of line.points) map.set(point.key, point.at)
    return [...map.entries()]
      .map(([key, at]) => ({ key, at, t: Date.parse(at) }))
      .sort((a, b) => a.t - b.t)
  }, [series])

  const fixTimes = events.filter((event) => event.kind !== 'google').map((event) => event.at)
  const extent = timeExtent([...checks.map((check) => check.at), ...fixTimes, ...extraTimes])
  const [t0, t1] = extent ?? [0, 0]

  // Google updates and the project's tracking changes ride along on every chart with
  // markers; neither stretches the time axis.
  const tracking = useContext(TrackingChangesContext)
  const trackingMarks = useMemo(
    () => trackingEvents(tracking, trackingPages),
    [tracking, trackingPages]
  )
  const withGoogle = markers
    ? [...events, ...googleEvents(GOOGLE_UPDATES, t0, t1), ...trackingMarks]
    : []
  const kinds = new Set<MarkerKind>(withGoogle.map((event) => event.kind))
  const shownEvents = visibleEvents(withGoogle, hidden, t0, t1)
  const hasMarkers = markers && kinds.size > 0

  const right = W - (endLabels ? 52 : 18)
  const plotBottom = PAD_TOP + height
  // Markers sit in their own lane under the axis: a 28px point on the axis line and a
  // 28px marker never overlap, so each keeps a full 24px target (axe target-size).
  const markerY = plotBottom + MARKER_LANE
  const dateY = plotBottom + (hasMarkers ? MARKER_LANE + 28 : 18)
  const axisRowY = dateY + 10
  const svgHeight = axisRowY + (axisControl ? axisRoom : 6)
  const x = linearScale(t0 === t1 ? [t0 - 1, t1 + 1] : [t0, t1], [PAD_LEFT + 8, right])
  const yMin = yTicks[0] ?? 0
  const yMax = yTicks[yTicks.length - 1] ?? 1
  const y = linearScale([yMin, yMax], [plotBottom, PAD_TOP])
  const xOf = (iso: string): number => x(Date.parse(iso))

  const placed: PlacedStack[] = joinCrowded(
    stackMarkers(shownEvents).map((stack) => ({
      stack,
      x: Math.max(PAD_LEFT + 8, Math.min(right, xOf(stack.at)))
    }))
  )
  const bands = measuringBands(shownEvents, t1)
  const rollouts = rolloutBands(shownEvents, t0, t1)

  // Each line's end label at its last point, kept 13px off the others.
  const endYs = spreadLabels(
    series.map((line) => {
      const last = [...line.points].reverse().find((p) => p.value !== null && !p.hollow)
      return last ? y(last.value ?? 0) : plotBottom
    }),
    13
  )

  const focused = hover === null ? null : (checks[hover] ?? null)
  const focusX = focused ? x(focused.t) : 0

  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!node || checks.length === 0) return
    const box = node.getBoundingClientRect()
    const at = ((event.clientX - box.left) / Math.max(box.width, 1)) * W
    const offsetY = event.clientY - box.top
    // Under the plot, or over a marker or its card: the marker's card is the one shown.
    const onMarker = (event.target as Element).closest?.('.ui-chart-marker, .ui-chart-card')
    if (offsetY > plotBottom + 8 || onMarker) {
      setHover(null)
      return
    }
    setHover(
      nearestIndex(
        checks.map((check) => x(check.t)),
        at
      )
    )
  }

  const firstValue = checks.find((check) =>
    series.some((line) => line.points.some((p) => p.key === check.key && p.value !== null))
  )
  const leadingGap = firstValue ? x(firstValue.t) - (PAD_LEFT + 8) : 0
  const gapInside = gapNote !== null && leadingGap > 180

  return (
    <figure className="ui-chart">
      {hasMarkers ? <MarkerToggles kinds={kinds} hidden={hidden} onToggle={toggle} /> : null}
      <div
        ref={setNode}
        className="ui-chart-plot"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          width={W}
          height={svgHeight}
          viewBox={`0 0 ${W} ${svgHeight}`}
          role="img"
          aria-label={label}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={series[0]?.color ?? 'var(--chart-cited)'}
                stopOpacity="0.22"
              />
              <stop
                offset="100%"
                stopColor={series[0]?.color ?? 'var(--chart-cited)'}
                stopOpacity="0"
              />
            </linearGradient>
            {/* A Google rollout is hatched, so it never reads as a goal band or a fix's window. */}
            <pattern
              id={rolloutId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--chart-rollout)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--chart-rollout-line)"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          {band ? (
            <rect
              className="ui-chart-band"
              x={PAD_LEFT}
              width={right - PAD_LEFT}
              y={y(band.to)}
              height={Math.max(0, y(band.from) - y(band.to))}
              rx="6"
            />
          ) : null}
          {rollouts.map((item) => (
            <rect
              key={`rollout-${item.id}`}
              className="ui-chart-rollout"
              fill={`url(#${rolloutId})`}
              x={x(item.from)}
              width={Math.max(2, x(item.to) - x(item.from))}
              y={PAD_TOP}
              height={height}
            />
          ))}
          {bands.map((item) => (
            <rect
              key={`band-${item.id}`}
              className="ui-chart-measure"
              x={x(item.from)}
              width={Math.max(2, x(item.to) - x(item.from))}
              y={PAD_TOP}
              height={height}
              rx="6"
            />
          ))}
          {yTicks.map((tick, index) => (
            <g key={tick}>
              <line
                className={index === 0 ? 'ui-chart-base' : 'ui-chart-grid'}
                x1={PAD_LEFT}
                x2={right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="ui-chart-ylabel" x={PAD_LEFT - 8} y={y(tick) + 4} textAnchor="end">
                {yFormat(tick)}
              </text>
            </g>
          ))}
          {placed.map((item) => (
            <line
              key={`guide-${item.stack.key}`}
              className="ui-chart-guide"
              x1={item.x}
              x2={item.x}
              y1={PAD_TOP}
              y2={markerY - 11}
            />
          ))}
          {gapInside && firstValue ? (
            <g className="ui-chart-gap">
              <rect
                x={PAD_LEFT + 8}
                y={PAD_TOP + height / 2 - 18}
                width={leadingGap - 16}
                height={36}
                rx="10"
              />
              <text
                x={PAD_LEFT + 8 + (leadingGap - 16) / 2}
                y={PAD_TOP + height / 2 + 4}
                textAnchor="middle"
              >
                {gapNote}
              </text>
            </g>
          ) : null}
          {series.map((line, index) => (
            <SeriesPaths
              key={line.id}
              line={line}
              fill={(line.area ?? index === 0) ? `url(#${gradientId})` : null}
              xOf={xOf}
              y={y}
              baseY={plotBottom}
            />
          ))}
          {focused ? (
            <line className="ui-chart-cross" x1={focusX} x2={focusX} y1={PAD_TOP} y2={plotBottom} />
          ) : null}
          {series.map((line, index) => (
            <SeriesDots
              key={`dots-${line.id}`}
              line={line}
              xOf={xOf}
              y={y}
              focusKey={focused?.key ?? null}
              selectedKey={selectedKey}
              endLabel={endLabels ? yFormat : null}
              endLabelY={endYs[index]}
            />
          ))}
          {xLabels(checks, xLabel).map((item) => (
            <text
              key={`x-${item.key}`}
              className="ui-chart-xlabel"
              x={x(item.t)}
              y={dateY}
              textAnchor={
                x(item.t) - 28 < PAD_LEFT ? 'start' : x(item.t) + 28 > W ? 'end' : 'middle'
              }
            >
              {item.text}
            </text>
          ))}
        </svg>
        {pointControl
          ? series.flatMap((line) =>
              line.points.map((point) => {
                if (point.value === null) return null
                const index = checks.findIndex((check) => check.key === point.key)
                return (
                  <span key={`pc-${line.id}-${point.key}`} className="ui-chart-point-slot">
                    {pointControl({
                      series: line,
                      point,
                      x: xOf(point.at),
                      y: y(point.value),
                      onFocus: () => setHover(index),
                      onBlur: () => setHover(null)
                    })}
                  </span>
                )
              })
            )
          : null}
        {axisControl
          ? checks.map((check, index) => (
              <span key={`ac-${check.key}`} className="ui-chart-axis-slot">
                {axisControl({
                  key: check.key,
                  at: check.at,
                  x: x(check.t),
                  dateY,
                  y: axisRowY,
                  room: Math.min(
                    index > 0 ? x(check.t) - x(checks[index - 1]?.t ?? check.t) : Infinity,
                    index < checks.length - 1
                      ? x(checks[index + 1]?.t ?? check.t) - x(check.t)
                      : Infinity
                  ),
                  onFocus: () => setHover(index),
                  onBlur: () => setHover(null)
                })}
              </span>
            ))
          : null}
        {hasMarkers ? (
          <ChartMarkers placed={placed} y={markerY} width={W} onOpen={onOpenEvent} />
        ) : null}
        {focused ? (
          <ChartCard x={focusX} y={PAD_TOP} width={W} side="beside">
            <p className="ui-chart-card-date">
              {readoutTitle ? readoutTitle(focused.key, focused.at) : formatMoment(focused.at)}
            </p>
            {readout ? (
              readout(focused.key)
            ) : (
              <DefaultReadout series={series} checkKey={focused.key} yFormat={yFormat} />
            )}
          </ChartCard>
        ) : null}
      </div>
      {gapNote !== null && !gapInside ? <p className="ui-chart-note">{gapNote}</p> : null}
    </figure>
  )
}

function DefaultReadout({
  series,
  checkKey,
  yFormat
}: {
  series: readonly TrendSeries[]
  checkKey: string
  yFormat: (value: number) => string
}): JSX.Element {
  return (
    <>
      {series.map((line) => {
        const point = line.points.find((item) => item.key === checkKey)
        if (!point) return null
        return (
          <p key={line.id} className="ui-chart-card-row">
            <span>
              <span
                className="ui-chart-key"
                style={{ background: line.color }}
                aria-hidden="true"
              />
              {line.label}
            </span>
            <strong className="num">{point.value === null ? '—' : yFormat(point.value)}</strong>
          </p>
        )
      })}
    </>
  )
}

/** Date labels under the checks: every one when they fit, else first, last and a spread between. */
function xLabels(
  checks: readonly { key: string; at: string; t: number }[],
  label?: (at: string, index: number, count: number) => string
): { key: string; t: number; text: string }[] {
  const max = 7
  const step = checks.length <= max ? 1 : Math.ceil((checks.length - 1) / (max - 1))
  return checks.flatMap((check, index) => {
    const keep = index % step === 0 || index === checks.length - 1
    if (!keep) return []
    if (index !== checks.length - 1 && checks.length - 1 - index < step / 2) return []
    const text = label
      ? label(check.at, index, checks.length)
      : formatDay(check.at, { year: false })
    return [{ key: check.key, t: check.t, text }]
  })
}

function linePoints(
  line: TrendSeries,
  xOf: (iso: string) => number,
  y: (value: number) => number
): (readonly [number, number])[][] {
  const drawn = line.points.filter((point) => !point.hollow)
  const runs = segmentsOf(drawn, (point) => point.value !== null)
  const out: (readonly [number, number])[][] = []
  for (const run of runs) {
    let current: (readonly [number, number])[] = []
    for (const point of run) {
      if (line.breakBefore?.has(point.key) && current.length > 0) {
        out.push(current)
        current = []
      }
      current.push([xOf(point.at), y(point.value ?? 0)] as const)
    }
    if (current.length > 0) out.push(current)
  }
  return out
}

function SeriesPaths({
  line,
  fill,
  xOf,
  y,
  baseY
}: {
  line: TrendSeries
  fill: string | null
  xOf: (iso: string) => number
  y: (value: number) => number
  baseY: number
}): JSX.Element {
  const runs = linePoints(line, xOf, y)
  return (
    <g style={{ color: line.color }}>
      {runs.map((points, index) => (
        <g key={index}>
          {fill && points.length > 1 ? <path d={areaPath(points, baseY)} fill={fill} /> : null}
          {points.length > 1 ? (
            <path
              className={line.dashed ? 'ui-chart-line ui-chart-line-dashed' : 'ui-chart-line'}
              d={monotonePath(points)}
            />
          ) : null}
        </g>
      ))}
    </g>
  )
}

function SeriesDots({
  line,
  xOf,
  y,
  focusKey,
  selectedKey,
  endLabel,
  endLabelY
}: {
  line: TrendSeries
  xOf: (iso: string) => number
  y: (value: number) => number
  focusKey: string | null
  selectedKey: string | null
  endLabel: ((value: number) => string) | null
  /** Where the end label sits, moved off its neighbours'. */
  endLabelY?: number
}): JSX.Element {
  const drawn = line.points.filter((point) => point.value !== null)
  const last = [...drawn].reverse().find((point) => !point.hollow)
  return (
    <g style={{ color: line.color }}>
      {drawn.map((point) => {
        const cx = xOf(point.at)
        const cy = y(point.value ?? 0)
        const isLast = point === last
        const big = isLast || point.key === focusKey || point.key === selectedKey
        return (
          <g key={point.key} data-point={point.key} data-hollow={point.hollow ? '' : undefined}>
            {isLast ? <circle className="ui-chart-halo" cx={cx} cy={cy} r={9} /> : null}
            {point.key === selectedKey ? (
              <circle className="ui-chart-selected" cx={cx} cy={cy} r={8} />
            ) : null}
            <Mark
              shape={line.shape ?? 'circle'}
              cx={cx}
              cy={cy}
              r={big ? 4.5 : 3}
              hollow={point.hollow ?? false}
            />
            {isLast && endLabel ? (
              <text className="ui-chart-endlabel" x={cx + 10} y={(endLabelY ?? cy) + 4}>
                {endLabel(point.value ?? 0)}
              </text>
            ) : null}
          </g>
        )
      })}
    </g>
  )
}

function Mark({
  shape,
  cx,
  cy,
  r,
  hollow
}: {
  shape: 'circle' | 'square' | 'diamond'
  cx: number
  cy: number
  r: number
  hollow: boolean
}): JSX.Element {
  const className = hollow ? 'ui-chart-dot ui-chart-dot-hollow' : 'ui-chart-dot'
  if (shape === 'circle') return <circle className={className} cx={cx} cy={cy} r={r} />
  const side = r * 1.8
  return (
    <rect
      className={className}
      x={cx - side / 2}
      y={cy - side / 2}
      width={side}
      height={side}
      rx={shape === 'square' ? 1.5 : 0}
      transform={shape === 'diamond' ? `rotate(45 ${cx} ${cy})` : undefined}
    />
  )
}
