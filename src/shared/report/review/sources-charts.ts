import type { RankedBarsInput, SplitBarInput } from '../../charts'
import type { ReviewReport } from './types'

/**
 * The chart inputs of the Sources and Answer shape tabs, shared by the app and the
 * downloaded file so both draw the same marks with the same drill ids.
 */
type Input<T> = Omit<T, 'width' | 'titles'>

/** Citations by owner: your pages, competitors, other sites. Citations do not drill. */
export function sourceSplitChart(report: ReviewReport): Input<SplitBarInput> {
  const { sources } = report
  return {
    label: 'Who the cited pages belong to',
    emptyText: 'No citations yet',
    parts: [
      {
        label: 'Your pages',
        value: sources.yours,
        tone: 'target',
        note: `${sources.yoursShare}% of citations`
      },
      { label: 'Competitors', value: sources.competitor, tone: 'not-cited' },
      { label: 'Other sites', value: sources.other, tone: 'muted' }
    ]
  }
}

/** What the answers are made of: answers holding each block, most first. */
export function shapeBlocksChart(report: ReviewReport): Input<RankedBarsInput> {
  return {
    label: 'What the answers are made of',
    emptyText: 'No answers read yet',
    items: report.answerShape.blocks.map((block) => ({
      id: block.answers.drill,
      label: block.name,
      value: block.answers.n
    }))
  }
}
