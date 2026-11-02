import { useState, type JSX } from 'react'
import {
  bucketColumns,
  donutChart,
  funnelChart,
  gainersLosers,
  historyStrip,
  pairedBars,
  positionChart,
  rankedBars,
  splitBar,
  type BucketColumnsInput,
  type ChartMarkup,
  type DonutInput,
  type FunnelInput,
  type GainersLosersInput,
  type HistoryStripInput,
  type PairedBarsInput,
  type PositionChartInput,
  type RankedBarsInput,
  type SplitBarInput
} from '@shared/charts'
import { useNodeWidth } from '../listGrid/useElementWidth'
import { ChartFrame } from './ChartFrame'

/**
 * The report charts in the app (one look with the downloaded report): each
 * wrapper measures its box, draws the shared builder at that width with the
 * app's hover card instead of native titles, and passes clicks on a mark to
 * `onDrill(id)` (screens open a drawer). See src/shared/charts.
 */

type AppInput<T> = Omit<T, 'width' | 'titles'> & {
  onDrill?: (id: string) => void
  className?: string
}

/** Before the box is measured (and in tests) the chart draws at this width. */
const FALLBACK_WIDTH = 640

function Measured({
  build,
  onDrill,
  className
}: {
  build: (width: number) => ChartMarkup
  onDrill?: (id: string) => void
  className?: string
}): JSX.Element {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const width = useNodeWidth(node) || FALLBACK_WIDTH
  return (
    <ChartFrame frameRef={setNode} markup={build(width)} onDrill={onDrill} className={className} />
  )
}

/** Paired before/after bars: a faint bar for the earlier check, a solid one for now. */
export function PairedBarsChart({
  onDrill,
  className,
  ...input
}: AppInput<PairedBarsInput>): JSX.Element {
  return (
    <Measured
      build={(width) => pairedBars({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/** Who gained ground and who lost it, with change chips. */
export function GainersLosersChart({
  onDrill,
  className,
  ...input
}: AppInput<GainersLosersInput>): JSX.Element {
  return (
    <Measured
      build={(width) => gainersLosers({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/** "How fast pages get cited": columns by days live. */
export function BucketColumnsChart({
  onDrill,
  className,
  ...input
}: AppInput<BucketColumnsInput>): JSX.Element {
  return (
    <Measured
      build={(width) => bucketColumns({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/** Ranked bars with a faint bar for the earlier value. */
export function RankedBarsChart({
  onDrill,
  className,
  ...input
}: AppInput<RankedBarsInput>): JSX.Element {
  return (
    <Measured
      build={(width) => rankedBars({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/** One bar cut into parts that add up (market vs your work). */
export function SplitBarChart({
  onDrill,
  className,
  ...input
}: AppInput<SplitBarInput>): JSX.Element {
  return (
    <Measured
      build={(width) => splitBar({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/** How often you are source #1, #2, #3, #4–5 or #6+. */
export function PositionChart({
  onDrill,
  className,
  ...input
}: AppInput<PositionChartInput>): JSX.Element {
  return (
    <Measured
      build={(width) => positionChart({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/** Where visibility falls away: tracked → AI answer shown → cited → named. */
export function FunnelChart({ onDrill, className, ...input }: AppInput<FunnelInput>): JSX.Element {
  return (
    <Measured
      build={(width) => funnelChart({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}

/**
 * One square per check. Sized by its cells, not its box (it sits in table rows);
 * `width` caps it.
 */
export function HistoryStripChart({
  onDrill,
  className,
  ...input
}: Omit<HistoryStripInput, 'titles'> & {
  onDrill?: (id: string) => void
  className?: string
}): JSX.Element {
  return (
    <ChartFrame
      markup={historyStrip({ ...input, titles: false })}
      onDrill={onDrill}
      className={`ui-rchart-inline${className ? ` ${className}` : ''}`}
    />
  )
}

/** A ring cut into parts that add up (share of voice). */
export function DonutChart({ onDrill, className, ...input }: AppInput<DonutInput>): JSX.Element {
  return (
    <Measured
      build={(width) => donutChart({ ...input, width, titles: false })}
      onDrill={onDrill}
      className={className}
    />
  )
}
