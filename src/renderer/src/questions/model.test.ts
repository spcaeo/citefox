import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW,
  costLine,
  costProblem,
  filterRows,
  parseGroup,
  parseView,
  questionKpis,
  recheckPlan,
  resultText,
  shareText,
  viewQuery
} from './model'
import { PRICING, TOPIC, questionRow, questionsList } from './questions.fixtures.test-helper'

const SOURCES = new Map([
  [PRICING.id, PRICING],
  [TOPIC.id, TOPIC]
])

describe('questions view URL', () => {
  it('round-trips every owned key and leaves defaults out', () => {
    const view = {
      ...DEFAULT_VIEW,
      q: 'sms api',
      kind: 'page' as const,
      source: 'page-1',
      result: 'cited' as const,
      change: 'gained' as const,
      market: 'm-uk',
      sort: [
        { key: 'result', dir: 'asc' as const },
        { key: 'checked', dir: 'desc' as const }
      ],
      group: 'stage' as const,
      row: 'p-1',
      panel: 'target' as const,
      pick: ['p-1', 'p-2'],
      type: 'keyword' as const
    }
    const query = viewQuery(view)
    expect(query).toBe(
      'q=sms+api&kind=page&type=keyword&source=page-1&result=cited&change=gained&market=m-uk&sort=result%3Aasc%2Cchecked%3Adesc&group=stage&row=p-1&panel=target&pick=p-1%2Cp-2'
    )
    expect(parseView(query)).toEqual(view)
    expect(viewQuery(DEFAULT_VIEW)).toBe('')
  })

  it('parses each grouping, with topic the default and the old source grouping as topic', () => {
    expect(parseGroup(null)).toBe('topic')
    expect(parseGroup('source')).toBe('topic')
    expect(parseGroup('stage')).toBe('stage')
    expect(parseGroup('target')).toBe('target')
    expect(parseGroup('none')).toBe('none')
    expect(parseView('group=source').group).toBe('topic')
    expect(viewQuery({ ...DEFAULT_VIEW, group: 'topic' })).toBe('')
    expect(viewQuery({ ...DEFAULT_VIEW, group: 'target' })).toBe('group=target')
  })

  it('filters by kind and counts keywords apart in the KPIs', () => {
    const rows = [
      questionRow({ promptId: 'q-1', sourceId: 'topic-1', text: 'how do I text my crew' }),
      questionRow({
        promptId: 'k-1',
        sourceId: 'topic-1',
        text: 'crew texting app',
        promptKind: 'keyword'
      }),
      questionRow({
        promptId: 'k-2',
        sourceId: 'topic-1',
        text: 'sms alerts',
        promptKind: 'keyword',
        enabled: false
      })
    ]
    const ids = (view: Partial<typeof DEFAULT_VIEW>): string[] =>
      filterRows(rows, SOURCES, { ...DEFAULT_VIEW, ...view }).map((row) => row.promptId)
    expect(ids({ type: 'keyword' })).toEqual(['k-1', 'k-2'])
    expect(ids({ type: 'question' })).toEqual(['q-1'])
    expect(ids({})).toEqual(['q-1', 'k-1', 'k-2'])
    expect(questionKpis(rows)).toMatchObject({ tracked: 2, keywords: 1 })
  })

  it('keeps picked ids only with the target panel', () => {
    expect(parseView('panel=sort&pick=p-1').pick).toEqual([])
    expect(parseView('panel=sort&pick=p-1').panel).toBe('sort')
    expect(parseView('panel=target&pick=p-1,p-1,../x,p-2').pick).toEqual(['p-1', 'p-2'])
    expect(viewQuery({ ...DEFAULT_VIEW, panel: 'sort', pick: ['p-1'] })).toBe('panel=sort')
    expect(parseView('panel=wizard').panel).toBeNull()
  })

  it('keeps picked ids with the re-check confirm', () => {
    const view = parseView('confirm=recheck&pick=p-1,p-2')
    expect(view.confirm).toBe('recheck')
    expect(view.pick).toEqual(['p-1', 'p-2'])
    expect(parseView('confirm=delete&pick=p-1')).toMatchObject({ confirm: null, pick: [] })
    expect(viewQuery({ ...DEFAULT_VIEW, confirm: 'recheck', pick: ['p-1'] })).toBe(
      'confirm=recheck&pick=p-1'
    )
  })

  it('keeps keys it does not own, such as the dialog', () => {
    expect(viewQuery({ ...DEFAULT_VIEW, result: 'named' }, 'dialog=add-questions&row=p-9')).toBe(
      'dialog=add-questions&result=named'
    )
  })

  it('drops unknown or malformed values', () => {
    expect(
      parseView(
        '?kind=video&type=phrase&result=great&change=up&sort=nope:asc,result:sideways&source=../x&group=x&panel=x'
      )
    ).toEqual({ ...DEFAULT_VIEW, sort: [{ key: 'result', dir: 'asc' }] })
  })
})

describe('filters and figures', () => {
  const list = questionsList()

  it('filters by kind, source, result and change', () => {
    const ids = (patch: Partial<typeof DEFAULT_VIEW>): string[] =>
      filterRows(list.rows, SOURCES, { ...DEFAULT_VIEW, ...patch }).map((row) => row.promptId)
    expect(ids({ kind: 'topic' })).toEqual(['p-t1'])
    expect(ids({ source: 'page-1' })).toEqual(['p-1', 'p-2', 'p-3'])
    expect(ids({ result: 'no_overview' })).toEqual(['p-2'])
    expect(ids({ change: 'gained', kind: 'page' })).toEqual(['p-1'])
  })

  it('counts tracked (enabled) questions and the latest checks', () => {
    expect(questionKpis(list.rows)).toEqual({
      tracked: 3,
      keywords: 0,
      overviews: 2,
      cited: 1,
      named: 1
    })
    expect(shareText(1, 2)).toBe('1 of 2 · 50%')
    expect(shareText(0, 0)).toBe('None yet')
  })

  it('words the result', () => {
    // The four shared words (audit2 #3); Google's place shows apart.
    expect(resultText(list.rows[1]!)).toBe('Right page')
    expect(
      resultText(questionRow({ promptId: 'x', sourceId: 'page-1', text: 'x', inMarket: false }))
    ).toBe('Not in this market')
  })
})

describe('re-check plan', () => {
  const list = questionsList()

  it('skips disabled questions and sums samples per source', () => {
    const plan = recheckPlan(list.rows, SOURCES)
    expect(plan).toEqual({
      promptIds: ['p-t1', 'p-1', 'p-2'],
      pageIds: ['topic-1', 'page-1'],
      skipped: 1,
      min: 4,
      max: 8
    })
    expect(costLine(plan, 'US · EN', 120)).toBe(
      'Uses 4 searches in US · EN, up to 8 if Google loads the overview separately · 120 left. 1 question skipped (off or not in US · EN).'
    )
    expect(costProblem(plan, 120)).toBeNull()
    expect(costProblem(plan, 3)).toBe(
      'Not enough searches left this month: this uses 4 and 3 are left.'
    )
  })

  it('cannot start with nothing to check', () => {
    const plan = recheckPlan([list.rows[3]!], SOURCES)
    expect(costProblem(plan, null)).toBe('None of these questions can be checked here.')
  })
})
