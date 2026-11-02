import { TOPIC_STAGE_LABEL } from '@shared/domain'
import type { GridCsvRequest } from '@shared/ipc'
import { GOOGLE_WORDS, type ResultWords } from '../../../ui/resultWords'
import { resultLabel } from './results'
import type { Search } from './types'

/** The searches as a CSV, the columns the List view shows plus the topic and check time. */
export function searchesCsv(
  searches: readonly Search[],
  baseName: string,
  now = new Date(),
  words: ResultWords = GOOGLE_WORDS
): GridCsvRequest {
  const day = now.toISOString().slice(0, 10)
  return {
    fileName: `${baseName}-searches-${day}.csv`,
    header: [
      'Number',
      'Search',
      'Type',
      'Stage',
      'Result',
      'Page Google cited',
      'Cited instead',
      'Win odds',
      'Topic or page',
      'Checked'
    ],
    rows: searches.map((search) => [
      search.ref,
      search.text,
      search.kind === 'question' ? 'Question' : 'Keyword',
      search.stage ? TOPIC_STAGE_LABEL[search.stage] : '',
      resultLabel(search.result, words),
      search.pageCited ?? '',
      search.citedInstead.join(' '),
      search.winOdds,
      search.sourceName,
      search.checkedAt ?? ''
    ])
  }
}
