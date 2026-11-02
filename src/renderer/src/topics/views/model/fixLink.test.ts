import { describe, expect, it } from 'vitest'
import { pageFixIdOf, rollupPageFixes, type FixSearch } from '@shared/page-fixes'
import { pageFixIdsFor } from './fixLink'
import type { Search } from './types'

function search(over: Partial<Search>): Search {
  return {
    id: 'p1',
    ref: 'Q1',
    number: 1,
    kind: 'question',
    text: 'A question',
    stage: null,
    result: 'not_cited',
    citedInstead: [],
    pageCited: null,
    targetUrl: 'https://example.com/target/',
    winOdds: 70,
    sourceId: 'topic-1',
    sourceName: 'Topic',
    checkedAt: null,
    ...over
  }
}

describe('pageFixIdsFor', () => {
  it('names the one page fix the searches fall in, with the same id the rollup gives', () => {
    const picked = [search({ id: 'p1' }), search({ id: 'p2' })]
    const fixSearch = {
      id: 'topic-1|p1',
      sourceKind: 'topic',
      sourceId: 'topic-1',
      sourceName: 'Topic',
      promptId: 'p1',
      marketId: null,
      runId: null,
      label: 'Q1',
      kind: 'question',
      text: 'A question',
      state: 'not_cited',
      targetPageId: null,
      targetUrl: 'https://example.com/target/',
      citedOwnUrl: null,
      citedInstead: [],
      winOdds: null,
      checkedAt: null
    } as FixSearch
    const [fix] = rollupPageFixes([fixSearch]).fixes
    expect(pageFixIdOf(fixSearch)).toBe(fix?.id)
    expect(pageFixIdsFor(picked)).toEqual([fix?.id])
  })

  it('names every fix when the searches span several, the one with most searches first', () => {
    const picked = [
      search({ id: 'p1', result: 'other_page', pageCited: 'https://example.com/blog/' }),
      search({ id: 'p2' }),
      search({ id: 'p3' })
    ]
    const ids = pageFixIdsFor(picked)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(pageFixIdsFor([search({ id: 'p2' })])[0])
  })

  it('is empty when no search needs a page fix', () => {
    expect(pageFixIdsFor([search({ result: 'target' })])).toEqual([])
  })
})
