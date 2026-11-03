import { describe, expect, it } from 'vitest'
import {
  buildPlan,
  checkParamsPatch,
  defaultScope,
  EVERYTHING_AGAIN,
  failedCounts,
  failedMap,
  hasScopeParam,
  missedMarkets,
  nothingDue,
  pageCheckValues,
  parseCheckParams,
  planSummary,
  scopePageIds,
  type CheckNowState,
  type CheckPlan,
  type NotCitedMap
} from './model'
import { NOW, OPTIONS, projectCheck, scopePage } from './fixtures.test-helper'
import type { ProjectHistory } from '@shared/ipc'

function state(overrides: Partial<CheckNowState> = {}): CheckNowState {
  return {
    scope: { kind: 'due', ids: [] },
    markets: [],
    only: 'all',
    prompts: [],
    q: '',
    ...overrides
  }
}

describe('Check now URL values', () => {
  it('parses check.* and writes the same values back', () => {
    const parsed = parseCheckParams({
      'check.scope': 'group',
      'check.ids': 'g1,bad id,g1',
      'check.markets': 'mkt-uk',
      'check.only': 'notcited',
      'check.q': 'pricing'
    })
    expect(parsed).toEqual({
      scope: { kind: 'group', ids: ['g1'] },
      markets: ['mkt-uk'],
      only: 'notcited',
      prompts: [],
      q: 'pricing'
    })
    expect(checkParamsPatch(parsed)).toEqual({
      'check.scope': 'group',
      'check.ids': 'g1',
      'check.markets': 'mkt-uk',
      'check.only': 'notcited',
      'check.prompts': null,
      'check.q': 'pricing'
    })
  })

  it('defaults to everything due; question ids alone mean selected questions', () => {
    expect(parseCheckParams({})).toEqual(state())
    expect(parseCheckParams({ 'check.scope': 'view' }).scope.kind).toBe('due')
    expect(parseCheckParams({ 'check.prompts': 'q1,q2' })).toMatchObject({
      only: 'picked',
      prompts: ['q1', 'q2']
    })
  })

  it('opens on one page or topic', () => {
    expect(pageCheckValues('p9', 'page', { only: 'picked' })).toEqual({
      'check.scope': 'pages',
      'check.ids': 'p9',
      'check.only': 'picked'
    })
    expect(pageCheckValues('t1', 'topic')).toEqual({ 'check.scope': 'topic', 'check.ids': 't1' })
  })
})

describe('Check now plan', () => {
  const plan = (input: Partial<CheckNowState>, notCited: NotCitedMap | null = null): CheckPlan =>
    buildPlan({ state: state(input), options: OPTIONS, notCited, pageQuestions: null, now: NOW })

  it('checks the due pages in every market with every question', () => {
    expect(plan({})).toMatchObject({
      pageIds: ['a'],
      marketIds: null,
      promptIds: null,
      estimate: { min: 8, max: 16, pages: 1 },
      blocked: null
    })
  })

  it('never picks a page that is not tracked', () => {
    expect(scopePageIds(state({ scope: { kind: 'cluster', ids: ['c1'] } }), OPTIONS, NOW)).toEqual([
      'a'
    ])
    expect(plan({ scope: { kind: 'pages', ids: ['c'] } }).blocked).toMatch(/is tracked yet/)
  })

  it('says why Check now is off', () => {
    expect(plan({ scope: { kind: 'pages', ids: [] } }).blocked).toBe(
      'Pick at least one page to check.'
    )
    expect(plan({ scope: { kind: 'pages', ids: ['b'] }, markets: ['mkt-uk'] }).blocked).toBe(
      'None of these pages is checked in the picked markets.'
    )
    expect(plan({ only: 'picked' }).blocked).toBe('Pick at least one question to check.')
    expect(plan({ only: 'notcited' })).toMatchObject({ waiting: true })
  })

  it('says when the next check is when nothing is due', () => {
    const quiet = {
      ...OPTIONS,
      pages: [
        scopePage('x', { nextCheckAt: '2026-11-02T09:00:00.000Z' }),
        scopePage('y', { nextCheckAt: '2026-11-02T15:00:00.000Z' }),
        scopePage('z', { nextCheckAt: '2026-11-09T09:00:00.000Z' })
      ]
    }
    expect(nothingDue(quiet, NOW)).toBe('Nothing is due. Next check: Nov 2 (2 pages).')
    expect(nothingDue({ ...OPTIONS, pages: [] }, NOW)).toBe(
      'Nothing is due and nothing is scheduled.'
    )
    const blocked = buildPlan({
      state: state(),
      options: quiet,
      notCited: null,
      pageQuestions: null,
      now: NOW
    })
    // 3 pages x 4 questions + the topic's 6: the way out names all of them.
    expect(blocked.blocked).toBe(
      'Nothing is due. Next check: Nov 2 (2 pages). Choose “Everything again” to run all 18 questions now.'
    )
    expect(blocked.wayOut).toEqual({ label: 'Run all 18 questions again', patch: EVERYTHING_AGAIN })
    // With no question anywhere there is nothing to offer.
    const empty = buildPlan({
      state: state(),
      options: { ...quiet, pages: [], topics: [] },
      notCited: null,
      pageQuestions: null,
      now: NOW
    })
    expect(empty.blocked).toBe('Nothing is due and nothing is scheduled.')
    expect(empty.wayOut).toBeNull()
  })

  it('only not cited checks the pages with missed questions, just those questions', () => {
    // Page a has US and UK; both questions were missed in both.
    const notCited: NotCitedMap = new Map([
      ['a', { promptIds: ['q2', 'q3'], marketIds: ['mkt-us', 'mkt-uk'] }],
      ['b', { promptIds: [], marketIds: [] }]
    ])
    const result = plan({ scope: { kind: 'group', ids: ['g1'] }, only: 'notcited' }, notCited)
    expect(result).toMatchObject({
      pageIds: ['a'],
      marketIds: ['mkt-us', 'mkt-uk'],
      promptIds: ['q2', 'q3'],
      estimate: { min: 4, max: 8, pages: 1 },
      blocked: null
    })
    expect(planSummary(result, OPTIONS)).toBe(
      '1 page · 2 markets · 2 questions · About 4–8 searches · 500 left this month'
    )
    expect(
      plan(
        { scope: { kind: 'pages', ids: ['b'] }, only: 'notcited' },
        new Map([['b', { promptIds: [], marketIds: [] }]])
      ).blocked
    ).toMatch(/Every question was cited/)
  })

  it('only not cited searches only the markets where something was missed', () => {
    // Every market picked, but page a missed questions in the UK only.
    const ukOnly: NotCitedMap = new Map([['a', { promptIds: ['q2'], marketIds: ['mkt-uk'] }]])
    expect(plan({ scope: { kind: 'pages', ids: ['a'] }, only: 'notcited' }, ukOnly)).toMatchObject({
      pageIds: ['a'],
      marketIds: ['mkt-uk'],
      promptIds: ['q2'],
      estimate: { min: 1, max: 2, pages: 1 }
    })
    // The chosen market wins: a miss in another market is never searched.
    expect(
      plan(
        { scope: { kind: 'pages', ids: ['a'] }, only: 'notcited', markets: ['mkt-us'] },
        new Map([['a', { promptIds: ['q2'], marketIds: ['mkt-us', 'mkt-uk'] }]])
      )
    ).toMatchObject({ marketIds: ['mkt-us'], estimate: { min: 1, pages: 1 } })
    expect(
      plan({ scope: { kind: 'pages', ids: ['a'] }, only: 'notcited', markets: ['mkt-us'] }, ukOnly)
        .blocked
    ).toBe('None of these pages is checked in the picked markets.')
    expect(missedMarkets(OPTIONS, ['a'], ukOnly, null)).toEqual(['mkt-uk'])
  })

  it('picked questions count only those of the page', () => {
    const result = buildPlan({
      state: state({ scope: { kind: 'pages', ids: ['b'] }, only: 'picked', prompts: ['q1', 'zz'] }),
      options: OPTIONS,
      notCited: null,
      pageQuestions: ['q1', 'q2'],
      now: NOW
    })
    expect(result).toMatchObject({ pageIds: ['b'], promptIds: ['q1', 'zz'], estimate: { min: 1 } })
  })

  it('checks a topic as its own subject', () => {
    expect(plan({ scope: { kind: 'topic', ids: ['t1'] }, markets: ['mkt-us'] })).toMatchObject({
      pageIds: ['t1'],
      marketIds: ['mkt-us'],
      estimate: { min: 6, pages: 1 }
    })
  })
})

describe('Check now default scope', () => {
  const none = { ...OPTIONS, pages: OPTIONS.pages.map((page) => ({ ...page, nextCheckAt: null })) }

  it('keeps everything due when something is due', () => {
    expect(defaultScope(OPTIONS, NOW)).toEqual({ kind: 'due', ids: [] })
  })

  it('moves to every tracked page when nothing is due, so Check now is never off', () => {
    expect(defaultScope(none, NOW)).toEqual({ kind: 'tracked', ids: [] })
  })

  it('moves to the one topic when there are no tracked pages', () => {
    expect(defaultScope({ ...none, pages: [] }, NOW)).toEqual({ kind: 'topic', ids: ['t1'] })
  })

  it('moves to everything again when several topics are the only thing to check', () => {
    const topics = [
      ...OPTIONS.topics,
      { id: 't2', name: 'Pricing', kind: 'topic' as const, count: 0, questions: 3 }
    ]
    expect(defaultScope({ ...none, pages: [], topics }, NOW)).toEqual({ kind: 'all', ids: [] })
  })

  it('stays on due for a project with nothing to check', () => {
    expect(defaultScope({ ...none, pages: [], topics: [] }, NOW)).toEqual({ kind: 'due', ids: [] })
  })

  it('knows when the URL holds a scope', () => {
    expect(hasScopeParam({})).toBe(false)
    expect(hasScopeParam({ 'check.scope': 'tracked' })).toBe(true)
  })
})

describe('Check now: everything again', () => {
  const plan = (input: Partial<CheckNowState>): CheckPlan =>
    buildPlan({
      state: state({ scope: { kind: 'all', ids: [] }, ...input }),
      options: OPTIONS,
      notCited: null,
      pageQuestions: null,
      now: NOW
    })

  it('runs every question of every tracked page and topic, and says how many', () => {
    const result = plan({})
    // Tracked pages a, b, d (not c) and the topic t1; a has two markets.
    expect(result).toMatchObject({
      pageIds: ['a', 'b', 'd', 't1'],
      marketIds: null,
      promptIds: null,
      questionCount: 18,
      blocked: null
    })
    // a: 4 x 2 markets, b: 4, d: 4, topic: 6 x 2 markets (a topic uses every market).
    expect(result.estimate).toEqual({ min: 28, max: 56, pages: 4 })
    expect(planSummary(result, OPTIONS)).toBe(
      '3 pages · 1 topic · every market · 18 questions · About 28–56 searches · 500 left this month'
    )
  })

  it('is available with one topic and nothing else', () => {
    const onlyTopic = { ...OPTIONS, pages: [] }
    const result = buildPlan({
      state: state({ scope: { kind: 'all', ids: [] } }),
      options: onlyTopic,
      notCited: null,
      pageQuestions: null,
      now: NOW
    })
    expect(result).toMatchObject({ pageIds: ['t1'], questionCount: 6, blocked: null })
  })
})

describe('Check now: only the ones that failed last time', () => {
  const history = (checks: ReturnType<typeof projectCheck>[]): ProjectHistory =>
    ({ checks }) as unknown as ProjectHistory

  it('takes the failed questions of the latest ended check of each page and market', () => {
    const map = failedMap(
      history([
        projectCheck({
          runId: 'new',
          startedAt: '2026-10-20T10:00:00.000Z',
          failedPromptIds: ['q1']
        }),
        // An older check of the same page and market: its failures were retried.
        projectCheck({
          runId: 'old',
          startedAt: '2026-10-19T10:00:00.000Z',
          failedPromptIds: ['q9']
        }),
        projectCheck({ runId: 'uk', marketId: 'mkt-uk', failedPromptIds: ['q1', 'q2'] }),
        // A running check has no verdict yet.
        projectCheck({ runId: 'run', pageId: 'b', status: 'running', failedPromptIds: ['q5'] }),
        projectCheck({ runId: 'ok', pageId: 'd', failedPromptIds: [] })
      ]),
      null
    )
    expect([...map.entries()]).toEqual([
      ['a', { promptIds: ['q1', 'q2'], marketIds: ['mkt-us', 'mkt-uk'] }]
    ])
    expect(failedCounts(map, ['a', 'b'])).toEqual({ questions: 2, pages: 1 })
    expect(failedCounts(null, ['a'])).toBeNull()
  })

  it('looks only at the picked markets', () => {
    const map = failedMap(
      history([
        projectCheck({ failedPromptIds: ['q1'] }),
        projectCheck({ runId: 'uk', marketId: 'mkt-uk', failedPromptIds: ['q2'] })
      ]),
      ['mkt-uk']
    )
    expect(map.get('a')).toEqual({ promptIds: ['q2'], marketIds: ['mkt-uk'] })
  })

  it('retries just those questions, in just the markets where they failed', () => {
    const failed: NotCitedMap = new Map([
      ['a', { promptIds: ['q1', 'q2'], marketIds: ['mkt-uk'] }],
      ['b', { promptIds: [], marketIds: [] }]
    ])
    const result = buildPlan({
      state: state({ scope: { kind: 'tracked', ids: [] }, only: 'failed' }),
      options: OPTIONS,
      notCited: null,
      failed,
      pageQuestions: null,
      now: NOW
    })
    expect(result).toMatchObject({
      pageIds: ['a'],
      marketIds: ['mkt-uk'],
      promptIds: ['q1', 'q2'],
      estimate: { min: 2, max: 4, pages: 1 },
      blocked: null
    })
  })

  it('waits for the checks, and says so when nothing failed', () => {
    const input = {
      state: state({ scope: { kind: 'tracked' as const, ids: [] }, only: 'failed' as const }),
      options: OPTIONS,
      notCited: null,
      pageQuestions: null,
      now: NOW
    }
    expect(buildPlan({ ...input, failed: null })).toMatchObject({ waiting: true })
    const none = buildPlan({ ...input, failed: new Map() })
    expect(none.blocked).toMatch(/No question failed last time/)
    expect(none.wayOut?.patch).toEqual({ only: 'all', prompts: [] })
  })
})
