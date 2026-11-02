import { describe, expect, it } from 'vitest'
import type { EngineCounts, QuestionEngineStatuses } from '@shared/ipc'
import type { FixSearch, PageFix } from '@shared/page-fixes'
import { scopedCounts } from '../engines/model'
import { engineDrill, type EngineSet } from './drills'
import { questionsInsight, topInstead } from './insights'
import { QUESTION_NOUN } from './model'
import { GAINED, KEPT, LOST, NEW_AIO, NO_AIO, WEEKS, overview } from './summaryFixture.test-helper'
import {
  fixSearchesDrill,
  pageFixesDrill,
  trendDrill,
  weekChangeDrill,
  weekDrill,
  weekDrillId
} from './moreDrills'

function groups(items: readonly { group?: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[item.group ?? ''] = (out[item.group ?? ''] ?? 0) + 1
  return out
}

describe('Summary trend drills (what moved behind a tile’s change)', () => {
  it('lists the cited searches gained and lost, with tiles that add up to the list', () => {
    const drill = trendDrill(overview(), 'cited')
    expect(drill.id).toBe('kpi:cited:moved')
    expect(drill.items.map((item) => item.id)).toEqual([GAINED.key, LOST.key])
    expect(groups(drill.items)).toEqual({ gained: 1, lost: 1 })
    expect(drill.summary?.map((part) => part.group)).toEqual(['gained', 'lost'])
    expect(drill.insight).toBe('1 gained, 1 lost: ±0 net.')
  })

  it('reads AI Overview moves from before and now, and says when the tile counts more', () => {
    const drill = trendDrill(
      overview({
        kpis: { ...overview().kpis, withAio: { value: 4, before: 2, delta: 2 } }
      }),
      'aio'
    )
    expect(drill.items.map((item) => item.id)).toEqual([NEW_AIO.key])
    expect(drill.insight).toBe(
      '1 gained, 0 lost: +1 net. The tile’s change also counts searches added or removed since then.'
    )
  })

  it('reads named moves from the verdict’s named sets, only for questions checked before', () => {
    const drill = trendDrill(overview(), 'named')
    expect(drill.items.map((item) => item.id)).toEqual([LOST.key])
    expect(drill.items[0]?.group).toBe('gained')
  })
})

describe('Summary week drills', () => {
  it('opens exactly the searches the week’s point counts, from the check that counted', () => {
    const data = overview()
    const last = WEEKS.length - 1
    const drill = weekDrill(data, WEEKS, last)
    expect(drill.id).toBe('week:0')
    expect(drill.items).toHaveLength(WEEKS[last]?.cited ?? -1)
    expect(drill.items.map((item) => item.id)).toEqual([GAINED.key, KEPT.key])
    expect(drill.items[0]?.target).toMatchObject({ kind: 'prompt', runId: 'run-23' })
    expect(drill.title).toBe('Cited this week')
    expect(drill.insight).toBe(
      '4 questions showed an AI Overview; you were cited in 2 (50%). Against the week before: 1 gained, 1 lost.'
    )
    const earlier = weekDrill(data, WEEKS, 1)
    expect(earlier.id).toBe(weekDrillId(WEEKS, 1))
    expect(earlier.id).toBe('week:2')
    expect(earlier.items).toHaveLength(WEEKS[1]?.cited ?? -1)
    expect(earlier.title).toBe('Cited in the week to Oct 9')
    // No checked week before it: no comparison.
    expect(earlier.insight).toBe('3 questions showed an AI Overview; you were cited in 2 (67%).')
  })

  it('opens the searches gained and lost since the first checked week', () => {
    const drill = weekChangeDrill(overview(), WEEKS)
    expect(groups(drill.items)).toEqual({ gained: 1, lost: 1 })
    expect(drill.items.map((item) => item.id)).toEqual([GAINED.key, LOST.key])
    expect(drill.insight).toBe('1 gained, 1 lost: ±0 net.')
  })
})

function search(id: string, citedInstead: readonly string[]): FixSearch {
  return {
    id: `t1|${id}`,
    sourceKind: 'topic',
    sourceId: 't1',
    sourceName: 'Gateway',
    promptId: id,
    marketId: 'mkt-us',
    runId: 'run-9',
    label: 'Q1',
    kind: 'question',
    text: `search ${id}`,
    state: 'not_cited',
    targetPageId: null,
    targetUrl: 'https://textbolt.com/pricing',
    citedOwnUrl: null,
    citedInstead,
    winOdds: null,
    checkedAt: '2026-10-22T09:00:00.000Z'
  }
}

function fix(id: string, kind: PageFix['kind'], searches: readonly FixSearch[]): PageFix {
  return {
    id,
    kind,
    page: kind === 'new' ? null : { pageId: null, url: 'https://textbolt.com/pricing' },
    citedUrl: null,
    proposed: kind === 'new' ? 'Gateway guide' : null,
    sources: [{ id: 't1', kind: 'topic', name: 'Gateway', searches: searches.length }],
    searches,
    bestOdds: null,
    avgOdds: null
  }
}

describe('Summary fix drills', () => {
  const fixes = [
    fix('pf1', 'improve', [search('a', ['reddit.com']), search('b', ['reddit.com', 'g2.com'])]),
    fix('pf2', 'owner', [search('c', [])]),
    fix('pf3', 'new', [search('d', ['g2.com'])]),
    fix('pf4', 'new', [search('e', [])])
  ]

  it('lists every page fix, each opening the page fix drawer over the list', () => {
    const drill = pageFixesDrill(fixes, overview())
    expect(drill.items).toHaveLength(fixes.length)
    expect(drill.items[0]?.target).toEqual({
      kind: 'drawer',
      id: 'page-fix',
      values: { 'pfx.id': 'pf1' }
    })
    expect(drill.items[0]?.cells).toEqual({ page: '/pricing', searches: 2 })
    expect(drill.items[2]?.cells?.page).toBe('Gateway guide')
    expect(groups(drill.items)).toEqual({ improve: 1, owner: 1, new: 2 })
    expect(drill.insight).toBe('The top 3 fixes cover 4 of the 5 searches that need work.')
  })

  it('opens exactly the searches one fix covers, with who is cited instead', () => {
    const [first] = fixes
    if (!first) throw new Error('no fix')
    const drill = fixSearchesDrill(first, overview(), QUESTION_NOUN)
    expect(drill.id).toBe('fix:pf1')
    expect(drill.items).toHaveLength(first.searches.length)
    expect(drill.items[0]?.target).toMatchObject({ kind: 'prompt', pageId: 't1', promptId: 'a' })
    expect(drill.insight).toBe('reddit.com is cited instead in both.')
  })
})

describe('Summary engine drills', () => {
  const statuses: QuestionEngineStatuses[] = [
    {
      pageId: 't1',
      promptId: 'q1',
      marketId: 'mkt-us',
      statuses: { chatgpt: 'cited' },
      moved: { chatgpt: 'gained' }
    },
    {
      pageId: 't1',
      promptId: 'q2',
      marketId: 'mkt-us',
      statuses: { chatgpt: 'not_cited' },
      moved: { chatgpt: 'lost' }
    },
    { pageId: 't1', promptId: 'q3', marketId: 'mkt-us', statuses: { chatgpt: 'unavailable' } },
    { pageId: 't1', promptId: 'q4', marketId: 'mkt-us', statuses: { chatgpt: 'no_answer' } },
    // Another market: not on this Summary, so neither counted nor listed.
    {
      pageId: 't1',
      promptId: 'q1',
      marketId: 'mkt-uk',
      statuses: { chatgpt: 'cited' },
      moved: { chatgpt: 'gained' }
    }
  ]

  it('opens exactly the questions each engine count counts, small print included', () => {
    const data = overview()
    const previous: EngineCounts[] = []
    const [count] = scopedCounts(data.questions, statuses, ['chatgpt'], previous)
    if (!count) throw new Error('no count')
    const expected: Record<EngineSet, number> = {
      checked: count.checked,
      answered: count.cited + count.named + count.notCited,
      cited: count.cited,
      named: count.named,
      unavailable: count.unavailable,
      no_answer: count.noAnswer,
      gained: count.gained,
      lost: count.lost,
      moved: count.gained + count.lost
    }
    expect(count).toMatchObject({ gained: 1, lost: 1, unavailable: 1, noAnswer: 1 })
    for (const [set, n] of Object.entries(expected) as [EngineSet, number][]) {
      expect(engineDrill(data, statuses, 'chatgpt', set).items, set).toHaveLength(n)
    }
    const moved = engineDrill(data, statuses, 'chatgpt', 'moved')
    expect(groups(moved.items)).toEqual({ gained: 1, lost: 1 })
    expect(engineDrill(data, statuses, 'chatgpt', 'cited').insight).toBe(
      'Google AI Overview cites you here too.'
    )
  })

  it('keeps the engine’s own gained and lost when no question says how it moved', () => {
    const plain = statuses.map((row) => ({ ...row, moved: undefined }))
    const before: EngineCounts = {
      engine: 'chatgpt',
      label: 'ChatGPT',
      checked: 9,
      cited: 9,
      named: 0,
      notCited: 0,
      noAnswer: 0,
      unavailable: 0,
      error: 0,
      gained: 3,
      lost: 2,
      lastCheckedAt: null
    }
    const [count] = scopedCounts(overview().questions, plain, ['chatgpt'], [before])
    expect(count).toMatchObject({ gained: 3, lost: 2 })
  })
})

describe('Summary insight lines', () => {
  it('names the site cited instead most often, and the cited share of a mixed list', () => {
    expect(topInstead([LOST, NEW_AIO, GAINED])).toEqual({ name: 'reddit.com', count: 2 })
    expect(questionsInsight([GAINED, LOST, NEW_AIO], QUESTION_NOUN)).toBe(
      'You’re cited in 1 of these 3 questions. reddit.com is cited instead in 2 of these 3.'
    )
  })

  it('reads an all-cited list as pages and average place, and says when nothing showed', () => {
    expect(questionsInsight([GAINED, KEPT], QUESTION_NOUN)).toBe(
      '1 cites your target page, 1 another page of yours. Average place #3.'
    )
    expect(questionsInsight([NO_AIO], QUESTION_NOUN)).toBe(
      'This one showed no AI Overview, so there was nothing to cite.'
    )
    expect(questionsInsight([], QUESTION_NOUN)).toBeNull()
  })
})
