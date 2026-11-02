import { describe, expect, it } from 'vitest'
import {
  buildPlan,
  checkParamsPatch,
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
import { NOW, OPTIONS, scopePage } from './fixtures.test-helper'

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
    expect(
      buildPlan({ state: state(), options: quiet, notCited: null, pageQuestions: null, now: NOW })
        .blocked
    ).toBe('Nothing is due. Next check: Nov 2 (2 pages).')
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
