import { describe, expect, test } from 'vitest'
import type { TopicResultRow } from './domain'
import { DEFAULT_TOPIC_BANDS } from './domain'
import {
  bandState,
  citedInstead,
  citedOwn,
  competitorCitedNotYou,
  deriveRowState,
  keywordUniverse,
  neededForBand,
  stageCoverage,
  stageExtremes,
  todoGroups,
  topicGoal,
  winOdds,
  winOddsLevel,
  type ScoredReference
} from './topic-scoring'

const own = (position: number, path = '/a/'): ScoredReference => ({
  url: `https://textbolt.com${path}`,
  normalizedUrl: `textbolt.com${path}`,
  domain: 'textbolt.com',
  position,
  classification: 'own'
})
const other = (
  position: number,
  domain: string,
  classification: 'competitor' | 'other' = 'other'
): ScoredReference => ({
  url: `https://${domain}/x`,
  normalizedUrl: `${domain}/x`,
  domain,
  position,
  classification
})

type Row = Pick<
  TopicResultRow,
  | 'promptId'
  | 'kind'
  | 'stage'
  | 'state'
  | 'named'
  | 'kwGroup'
  | 'kwGroupKind'
  | 'intent'
  | 'funnel'
  | 'pageType'
  | 'winOdds'
>

function row(partial: Partial<Row> & Pick<Row, 'promptId' | 'state'>): Row {
  return {
    kind: 'question',
    stage: 'problem',
    named: false,
    kwGroup: null,
    kwGroupKind: null,
    intent: null,
    funnel: null,
    pageType: null,
    winOdds: null,
    ...partial
  }
}

describe('deriveRowState', () => {
  test('every state from a stored outcome', () => {
    expect(deriveRowState({ status: null, references: [] }, null)).toBe('not_checked')
    expect(deriveRowState({ status: 'error', references: [] }, null)).toBe('failed')
    expect(deriveRowState({ status: 'no_aio', references: [] }, 'textbolt.com/a/')).toBe('no_aio')
    expect(
      deriveRowState({ status: 'other_own_page', references: [own(2)] }, 'textbolt.com/a/')
    ).toBe('right_page')
    expect(
      deriveRowState({ status: 'other_own_page', references: [own(2, '/b/')] }, 'textbolt.com/a/')
    ).toBe('other_page')
    // No target page yet: any own page counts as the cited page.
    expect(deriveRowState({ status: 'other_own_page', references: [own(2)] }, null)).toBe(
      'right_page'
    )
    expect(
      deriveRowState(
        { status: 'not_cited', references: [other(1, 'reddit.com')] },
        'textbolt.com/a/'
      )
    ).toBe('not_cited')
    expect(deriveRowState({ status: 'brand_mentioned', references: [] }, null)).toBe('no_page')
  })

  test('an Also OK page cited counts as the right page; another own page does not', () => {
    const cited = { status: 'other_own_page' as const, references: [own(2, '/b/')] }
    expect(deriveRowState(cited, 'textbolt.com/a/', ['textbolt.com/b/'])).toBe('right_page')
    expect(deriveRowState(cited, 'textbolt.com/a/', ['textbolt.com/c/'])).toBe('other_page')
  })

  test('a `target` classification (a page check of the same URL) counts as own', () => {
    expect(
      deriveRowState(
        { status: 'page_cited', references: [{ ...own(1), classification: 'target' }] },
        'textbolt.com/a/'
      )
    ).toBe('right_page')
  })
})

describe('goal and band', () => {
  test('cited ÷ prompts with an overview; failed and no overview left out; kinds apart', () => {
    const rows = [
      row({ promptId: '1', state: 'right_page', named: true }),
      row({ promptId: '2', state: 'other_page' }),
      row({ promptId: '3', state: 'not_cited' }),
      row({ promptId: '4', state: 'no_page' }),
      row({ promptId: '5', state: 'no_aio' }),
      row({ promptId: '6', state: 'failed' }),
      row({ promptId: '7', state: 'not_checked' }),
      row({ promptId: 'k', kind: 'keyword', state: 'right_page' })
    ]
    const goal = topicGoal(rows, 'question', DEFAULT_TOPIC_BANDS.questions)
    expect(goal).toMatchObject({
      prompts: 7,
      checked: 6,
      withAio: 4,
      cited: 2,
      rightPage: 1,
      otherPage: 1,
      named: 1,
      noAio: 1,
      failed: 1,
      notChecked: 1,
      rate: 50,
      bandState: 'in',
      neededForBand: 2,
      toReachBand: 0
    })
    expect(topicGoal(rows, 'keyword', DEFAULT_TOPIC_BANDS.keywords)).toMatchObject({
      withAio: 1,
      cited: 1,
      rate: 100,
      bandState: 'above'
    })
    expect(topicGoal([], 'question', DEFAULT_TOPIC_BANDS.questions)).toMatchObject({
      rate: null,
      bandState: null,
      toReachBand: 0
    })
  })

  test('to reach the band is the cited count still needed at the lower edge', () => {
    expect(neededForBand(26, { lo: 50, hi: 70 })).toBe(13)
    expect(neededForBand(25, { lo: 50, hi: 70 })).toBe(13)
    expect(neededForBand(0, { lo: 50, hi: 70 })).toBe(0)
    const rows = Array.from({ length: 26 }, (_, index) =>
      row({ promptId: String(index), state: index < 11 ? 'right_page' : 'not_cited' })
    )
    expect(topicGoal(rows, 'question', { lo: 50, hi: 70 })).toMatchObject({
      rate: 42,
      toReachBand: 2,
      bandState: 'below'
    })
    expect(bandState(70, { lo: 50, hi: 70 })).toBe('in')
  })
})

describe('stages, universe and to-do', () => {
  test('stage coverage lists ids that match the counts, in journey order', () => {
    const rows = [
      row({ promptId: 'a', stage: 'decide', state: 'right_page' }),
      row({ promptId: 'b', stage: 'problem', state: 'not_cited' }),
      row({ promptId: 'c', stage: 'problem', state: 'no_aio' }),
      row({ promptId: 'd', stage: 'problem', state: 'other_page' })
    ]
    const stages = stageCoverage(rows)
    expect(stages.map((stage) => stage.stage)).toEqual(['problem', 'decide'])
    expect(stages[0]).toMatchObject({
      prompts: 3,
      withAio: 2,
      cited: 1,
      notCited: 1,
      noAio: 1,
      rate: 50,
      citedIds: ['d'],
      noAioIds: ['c']
    })
    expect(stageExtremes(stages).weakest).toBeNull()
  })

  test('keyword universe tables add up', () => {
    const rows = [
      row({
        promptId: 'k1',
        kind: 'keyword',
        stage: null,
        kwGroup: 'Pricing',
        kwGroupKind: 'intent',
        intent: 'commercial',
        funnel: 'bofu',
        pageType: 'product page',
        state: 'right_page',
        named: true
      }),
      row({
        promptId: 'k2',
        kind: 'keyword',
        stage: null,
        kwGroup: 'Pricing',
        kwGroupKind: 'intent',
        intent: 'commercial',
        funnel: 'bofu',
        pageType: 'product page',
        state: 'no_aio'
      }),
      row({
        promptId: 'k3',
        kind: 'keyword',
        stage: null,
        kwGroup: 'Cover — sms',
        kwGroupKind: 'coverage',
        intent: 'informational',
        funnel: 'tofu',
        pageType: 'blog',
        state: 'not_cited'
      })
    ]
    const universe = keywordUniverse(rows)
    expect(universe).toMatchObject({
      keywords: 3,
      aioShown: 2,
      youCited: 1,
      brandNamed: 1,
      citedRate: 50,
      groupsWithNoCitations: ['Cover — sms']
    })
    expect(universe.byGroup.map((item) => [item.key, item.keywords, item.groupKind])).toEqual([
      ['Pricing', 2, 'intent'],
      ['Cover — sms', 1, 'coverage']
    ])
    expect(universe.byFunnel.map((item) => item.label)).toEqual(['TOFU', 'BOFU'])
    expect(universe.byPageType.reduce((sum, item) => sum + item.keywords, 0)).toBe(3)
  })

  test('to-do groups sort by win odds and never include no overview', () => {
    const rows = [
      row({
        promptId: 'a',
        state: 'not_cited',
        winOdds: { score: 40, level: 'medium', reason: '' }
      }),
      row({ promptId: 'b', state: 'not_cited', winOdds: { score: 80, level: 'high', reason: '' } }),
      row({ promptId: 'c', state: 'no_aio' })
    ]
    const groups = todoGroups(rows)
    expect(groups.map((group) => group.state)).toEqual([
      'not_cited',
      'other_page',
      'no_page',
      'right_page'
    ])
    expect(groups[0]?.promptIds).toEqual(['b', 'a'])
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(2)
  })
})

describe('win odds', () => {
  test('a confident target with small sites cited ranks high; no page ranks low', () => {
    const high = winOdds({
      state: 'not_cited',
      hasTarget: true,
      matchConfidence: 90,
      targetConfirmed: true,
      references: [other(1, 'smallblog.io'), other(2, 'nicheforum.net')],
      named: false
    })
    const low = winOdds({
      state: 'no_page',
      hasTarget: false,
      matchConfidence: null,
      targetConfirmed: false,
      references: [
        other(1, 'wikipedia.org'),
        other(2, 'reddit.com'),
        other(3, 'twilio.com', 'competitor')
      ],
      named: false
    })
    expect(high?.level).toBe('high')
    expect(low?.level).toBe('low')
    expect((high?.score ?? 0) > (low?.score ?? 100)).toBe(true)
    expect(low?.reason).toMatch(/no page of yours/iu)
    expect(
      winOdds({
        state: 'no_aio',
        hasTarget: true,
        matchConfidence: 90,
        targetConfirmed: false,
        references: [],
        named: null
      })
    ).toBeNull()
    expect([winOddsLevel(70), winOddsLevel(69), winOddsLevel(39)]).toEqual([
      'high',
      'medium',
      'low'
    ])
  })
})

describe('sources', () => {
  test('cited instead, own citation and competitor-not-you', () => {
    const refs = [
      other(1, 'www.reddit.com'),
      own(2, '/b/'),
      own(3),
      other(4, 'twilio.com', 'competitor')
    ]
    expect(citedInstead(refs)).toEqual(['reddit.com', 'twilio.com'])
    expect(citedOwn(refs, 'textbolt.com/a/')).toEqual({
      url: 'https://textbolt.com/a/',
      position: 3
    })
    expect(citedOwn(refs, null)?.position).toBe(2)
    expect(competitorCitedNotYou(refs)).toBe(false)
    expect(competitorCitedNotYou([other(1, 'twilio.com', 'competitor')])).toBe(true)
  })
})
