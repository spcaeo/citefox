import { ResultBar, ResultDot } from '../../ResultBar'
import { countResults, resultBucket, RESULT_BUCKETS, type ResultBucket } from '../../resultTones'
import type { ListColumn, ListTree } from '../types'

/* Shared fixtures for the tree grid tests and the views playground: a topic's searches. */

export interface Search {
  id: string
  n: number
  text: string
  stage: string
  result: ResultBucket
  odds: number
}

export const STAGES = ['Problem', 'Solution', 'Compare', 'Decide'] as const

/** `count` searches spread over the stages and results, the same every time. */
export function searches(count: number): Search[] {
  return Array.from({ length: count }, (_, at) => ({
    id: `s${at + 1}`,
    n: at + 1,
    text: `Search ${at + 1}: how do I get Nagios alerts by text ${at % 7 === 0 ? 'fast' : ''}`.trim(),
    stage: STAGES[at % STAGES.length] as string,
    result: (RESULT_BUCKETS[Math.floor(at / 4) % 4] ?? RESULT_BUCKETS[0])?.key as ResultBucket,
    odds: 40 + ((at * 37) % 60)
  }))
}

export const SEARCH_TREE: ListTree<Search> = {
  path: (row) => [
    { key: row.stage, label: row.stage },
    {
      key: row.result,
      label: resultBucket(row.result).label,
      lead: <ResultDot result={row.result} />
    }
  ],
  order: [...STAGES, ...RESULT_BUCKETS.map((bucket) => bucket.key)]
}

const needsWork = (rows: readonly Search[]): number =>
  rows.filter((row) => row.result === 'not_cited' || row.result === 'other_page').length

export const SEARCH_COLUMNS: ListColumn<Search>[] = [
  {
    id: 'text',
    label: 'Stage › Result › Search',
    width: 'fill',
    sort: (row) => row.text,
    render: (row) => row.text
  },
  {
    id: 'searches',
    label: 'Searches',
    width: 96,
    numeric: true,
    sort: false,
    render: () => '',
    total: (rows) => rows.length,
    totalSort: (rows) => rows.length
  },
  {
    id: 'results',
    label: 'Results',
    width: 150,
    sort: false,
    render: (row) => resultBucket(row.result).label,
    total: (rows) => <ResultBar counts={countResults(rows, (row) => row.result)} />
  },
  {
    id: 'work',
    label: 'Needs work',
    width: 104,
    numeric: true,
    sort: (row) => (row.result === 'not_cited' || row.result === 'other_page' ? 1 : 0),
    render: () => '',
    total: (rows) => needsWork(rows),
    totalSort: needsWork
  },
  {
    id: 'odds',
    label: 'Win odds',
    width: 96,
    numeric: true,
    sort: (row) => row.odds,
    render: (row) => row.odds,
    total: (rows) => `up to ${Math.max(...rows.map((row) => row.odds))}`,
    totalSort: (rows) => Math.max(...rows.map((row) => row.odds))
  }
]
