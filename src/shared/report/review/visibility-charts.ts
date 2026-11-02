import type { BucketColumnsInput, ChartTone } from '../../charts'
import type { ReviewReport } from './types'

/**
 * The Visibility report's chart inputs, shared by the app (ui/chart/ReportCharts) and the
 * download (shared SVG builders), so both draw the same marks with the same drills.
 */
type Input<T> = Omit<T, 'width' | 'titles'>

const OPPORTUNITY_TONES: Readonly<Record<string, ChartTone>> = {
  invisible: 'not-cited',
  wrongpage: 'other',
  ugc: 'muted',
  winning: 'target'
}

export function opportunityChart(report: ReviewReport): Input<BucketColumnsInput> {
  const { opportunity } = report.visibility
  return {
    label: 'The opportunity',
    valueWords: 'questions',
    emptyText: 'No AI answers yet',
    height: 200,
    items:
      opportunity.answers.n === 0
        ? []
        : opportunity.bars.map((bar) => ({
            id: bar.value.drill,
            label: bar.label,
            value: bar.value.n,
            tone: OPPORTUNITY_TONES[bar.id] ?? 'ink'
          }))
  }
}

const TONE_TONES: Readonly<Record<string, ChartTone>> = {
  positive: 'target',
  neutral: 'none',
  negative: 'not-cited'
}

export function toneChart(report: ReviewReport): Input<BucketColumnsInput> {
  return {
    label: 'How the answers speak about you',
    valueWords: 'answers',
    emptyText: 'No answer names you yet',
    height: 180,
    items: report.visibility.reputation.split.map((slice) => ({
      id: slice.value.drill,
      label: slice.label,
      value: slice.value.n,
      tone: TONE_TONES[slice.tone] ?? 'ink'
    }))
  }
}
