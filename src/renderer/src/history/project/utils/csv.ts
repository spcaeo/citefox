import { MICROS_PER_USD, type Market } from '@shared/domain'
import type { GridCsvRequest, HistorySubject, ProjectCheck } from '@shared/ipc'
import { marketLabel } from '../../../shell/model'
import { formatClock, formatDay } from '../../../utils/dates'
import { checkState, durationText, enginesText, kindLabel, stateLabel } from '../model'

/**
 * Check history as CSV (`grid:exportCsv`, FR-21.1): the rows the filters keep,
 * every column, so a client gets the whole ledger whatever the grid hides.
 */
export function historyCsv(
  rows: readonly ProjectCheck[],
  subjects: ReadonlyMap<string, HistorySubject>,
  markets: ReadonlyMap<string, Market>,
  today: Date = new Date()
): GridCsvRequest {
  return {
    fileName: `check-history-${today.toISOString().slice(0, 10)}.csv`,
    header: [
      'Date',
      'Time',
      'Page or topic',
      'URL',
      'Type',
      'Market',
      'Questions checked',
      'Questions total',
      'Overviews',
      'Cited',
      'Named',
      'Score',
      'Change',
      'Searches',
      'Engines',
      'Search credits',
      'Cost (USD)',
      'Status',
      'Duration',
      'Failed questions'
    ],
    rows: rows.map((check) => {
      const subject = subjects.get(check.pageId)
      const market = markets.get(check.marketId)
      return [
        formatDay(check.startedAt),
        // A spreadsheet column: one fixed 24-hour form, whatever the computer's clock.
        formatClock(check.startedAt, { locale: 'en-GB' }),
        subject?.label ?? 'Removed page',
        subject?.url ?? '',
        kindLabel(check.kind),
        market ? marketLabel(market) : 'Removed market',
        check.questionsChecked,
        check.questionsTotal,
        check.aiOverviews,
        check.cited,
        check.named,
        check.score,
        check.scoreChange,
        check.searchesUsed,
        enginesText(check.engines),
        check.credits ?? 0,
        ((check.costMicros ?? 0) / MICROS_PER_USD).toFixed(4),
        stateLabel(checkState(check)),
        check.durationMs === null ? '' : durationText(check.durationMs),
        check.failedPromptIds.length
      ]
    })
  }
}
