import type { DonutInput } from '../../charts'
import type { ReviewReport } from './types'

/** The share-of-voice ring, the same in the app and the downloaded file. */
export function sovChart(report: ReviewReport): Omit<DonutInput, 'width' | 'titles'> {
  const sov = report.competition.sov
  return {
    label: `Share of voice, ${report.toLabel}`,
    centerWords: 'answers',
    emptyText: 'No AI answer showed yet',
    parts:
      sov === null
        ? []
        : [
            { id: sov.you.drill, label: 'You', value: sov.you.n, tone: 'target' },
            {
              id: sov.competitor.drill,
              label: 'Named competitors',
              value: sov.competitor.n,
              tone: 'not-cited'
            },
            { id: sov.others.drill, label: 'Other sites only', value: sov.others.n, tone: 'other' },
            { id: sov.none.drill, label: 'No site cited', value: sov.none.n, tone: 'none' }
          ]
  }
}
