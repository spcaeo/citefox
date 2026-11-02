/**
 * Report charts shared by the app (ui/chart/ReportCharts.tsx) and the downloaded
 * report (main/export/html): pure builders that return SVG markup, styled by
 * charts.css. Every clickable mark carries `data-drill`, a role and an aria-label.
 */
export * from './svg'
export * from './scale'
export { pairedBars, type PairedBarsInput, type PairedItem } from './paired-bars'
export {
  gainersLosers,
  splitMovers,
  type GainersLosersInput,
  type MoverItem,
  type MoverLists
} from './gainers-losers'
export { bucketColumns, columnsChart, type BucketColumnsInput, type BucketItem } from './columns'
export {
  historyCellSize,
  historyLegendWords,
  historyStrip,
  HISTORY_WORDS,
  type HistoryCell,
  type HistoryState,
  type HistoryStripInput
} from './history-strip'
export { rankedBars, type RankedBarsInput, type RankedItem } from './ranked-bars'
export {
  segmentPath,
  splitBar,
  splitParts,
  splitWidths,
  type SplitBarInput,
  type SplitPart
} from './split-bar'
export {
  positionBuckets,
  positionChart,
  type PositionBucket,
  type PositionChartInput,
  type PositionKey
} from './position-chart'
export {
  funnelChart,
  funnelRows,
  type FunnelInput,
  type FunnelRow,
  type FunnelStep
} from './funnel'
export { arcPath, donutChart, type DonutInput, type DonutPart } from './donut'
