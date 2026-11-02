import { describe, expect, it } from 'vitest'
import type { EngineCounts } from '@shared/ipc'
import {
  costText,
  dotKind,
  enginesOf,
  hasEngine,
  isAnswerFilter,
  mergeCounts,
  offeredEngines,
  parseEngineFilter,
  questionKey,
  scopedCounts,
  spendText,
  statusMap,
  statusRank,
  statusText
} from './model'

function counts(patch: Partial<EngineCounts> & Pick<EngineCounts, 'engine'>): EngineCounts {
  return {
    label: patch.engine,
    checked: 0,
    cited: 0,
    named: 0,
    notCited: 0,
    noAnswer: 0,
    unavailable: 0,
    error: 0,
    gained: 0,
    lost: 0,
    lastCheckedAt: null,
    ...patch
  }
}

describe('engine model', () => {
  it('reads the filter from the URL only when the screen offers that engine', () => {
    const offered = ['google_aio', 'chatgpt'] as const
    expect(parseEngineFilter('chatgpt', offered)).toBe('chatgpt')
    expect(parseEngineFilter('perplexity', offered)).toBe('all')
    expect(parseEngineFilter('bard', offered)).toBe('all')
    expect(parseEngineFilter(null, offered)).toBe('all')
    expect(isAnswerFilter('chatgpt')).toBe(true)
    expect(isAnswerFilter('google_aio')).toBe(false)
    expect(isAnswerFilter('all')).toBe(false)
  })

  it('keeps a row when it asked the picked engine; rows without a list are Google (audit #4)', () => {
    expect(hasEngine(['google_aio', 'chatgpt'], 'chatgpt')).toBe(true)
    expect(hasEngine(['google_aio'], 'chatgpt')).toBe(false)
    expect(hasEngine(undefined, 'google_aio')).toBe(true)
    expect(hasEngine([], 'chatgpt')).toBe(false)
    expect(hasEngine(['perplexity'], 'all')).toBe(true)
    expect(enginesOf([['chatgpt'], undefined, ['perplexity', 'chatgpt']])).toEqual([
      'google_aio',
      'chatgpt',
      'perplexity'
    ])
    expect(enginesOf([])).toEqual([])
  })

  it('offers the project engines and any engine with answers, in display order', () => {
    expect(
      offeredEngines(
        ['chatgpt', 'google_aio'],
        [counts({ engine: 'gemini', checked: 2 }), counts({ engine: 'copilot', checked: 0 })]
      )
    ).toEqual(['google_aio', 'chatgpt', 'gemini'])
  })

  it('draws unavailable, no answer and errors as the grey dot', () => {
    expect(dotKind('cited')).toBe('cited')
    expect(dotKind('named')).toBe('named')
    expect(dotKind('not_cited')).toBe('not_cited')
    for (const status of ['no_answer', 'unavailable', 'error', null, undefined] as const) {
      expect(dotKind(status)).toBe('none')
    }
    expect(statusText('unavailable')).toBe('Unavailable')
    expect(statusText(undefined)).toBe('Not checked')
    expect(statusRank('cited')).toBeLessThan(statusRank('not_cited'))
    expect(statusRank(undefined)).toBeGreaterThan(statusRank('error'))
  })

  it('keys statuses by page and question in the picked market', () => {
    const map = statusMap(
      [
        { pageId: 'p1', promptId: 'q1', marketId: 'us', statuses: { chatgpt: 'cited' } },
        { pageId: 'p1', promptId: 'q1', marketId: 'uk', statuses: { chatgpt: 'not_cited' } }
      ],
      'us'
    )
    expect(map.get(questionKey('p1', 'q1'))).toEqual({ chatgpt: 'cited' })
    expect(map.size).toBe(1)
  })

  it('sums counts over page batches and keeps the newest check', () => {
    const merged = mergeCounts([
      [counts({ engine: 'chatgpt', checked: 2, cited: 1, lastCheckedAt: '2026-10-20T10:00:00Z' })],
      [
        counts({ engine: 'chatgpt', checked: 3, cited: 2, lastCheckedAt: '2026-10-24T10:00:00Z' }),
        counts({ engine: 'google_aio', checked: 1 })
      ]
    ])
    expect(merged.map((item) => item.engine)).toEqual(['google_aio', 'chatgpt'])
    expect(merged[1]).toMatchObject({ checked: 5, cited: 3, lastCheckedAt: '2026-10-24T10:00:00Z' })
  })

  it('writes credits and money plainly', () => {
    expect(costText(5_600)).toBe('$0.006')
    expect(costText(110_000)).toBe('$0.11')
    expect(costText(0)).toBe('$0')
    expect(costText(1_240_500_000)).toBe('$1,240.50')
    expect(spendText(7, 5_600)).toBe('7 credits · $0.006')
    expect(spendText(1, 0)).toBe('1 credit')
    expect(spendText(0, 0)).toBe('No credits used')
  })

  it('counts only the questions a screen shows, each in its own market', () => {
    const [chat] = scopedCounts(
      [
        { pageId: 'p1', promptId: 'q1', marketId: 'us' },
        { pageId: 'p1', promptId: 'q2', marketId: 'us' }
      ],
      [
        { pageId: 'p1', promptId: 'q1', marketId: 'us', statuses: { chatgpt: 'cited' } },
        { pageId: 'p1', promptId: 'q1', marketId: 'uk', statuses: { chatgpt: 'cited' } },
        { pageId: 'p1', promptId: 'q2', marketId: 'us', statuses: { chatgpt: 'unavailable' } }
      ],
      ['chatgpt'],
      [counts({ engine: 'chatgpt', checked: 9, cited: 9, gained: 1 })]
    )
    expect(chat).toMatchObject({ checked: 2, cited: 1, unavailable: 1, gained: 1 })
  })
})
