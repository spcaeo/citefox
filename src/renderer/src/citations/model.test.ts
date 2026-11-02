import { describe, expect, it } from 'vitest'
import type { CitedOverviewRef, CitedPageRow, CitedQuestionRef } from '@shared/ipc'
import {
  domainRows,
  filterWhose,
  listRows,
  pitchQuestions,
  rowName,
  viewFrom,
  whoseCounts,
  whoseFrom,
  whoseText,
  citationsListLink
} from './model'

function page(id: string, domain: string, patch: Partial<CitedPageRow> = {}): CitedPageRow {
  return {
    id,
    url: `https://www.${domain}/${id}/`,
    title: null,
    domain,
    domainId: `d-${domain}`,
    whose: 'other',
    competitor: null,
    marketIds: ['mkt-us'],
    questions: [],
    overviews: [],
    ...patch
  }
}

function ref(promptId: string, marketId: string, position: number): CitedQuestionRef {
  return {
    id: `page-1|${promptId}`,
    pageId: 'page-1',
    pageKind: 'page' as const,
    pageLabel: 'Alerts',
    promptId,
    promptLabel: promptId,
    promptText: promptId,
    marketId,
    runId: `run-${marketId}`,
    marketIds: [marketId],
    position
  }
}

function seen(promptId: string, marketId: string, position: number): CitedOverviewRef {
  return {
    id: `run-${marketId}|${promptId}`,
    questionId: `page-1|${promptId}`,
    marketId,
    runId: `run-${marketId}`,
    position
  }
}

describe('citations model', () => {
  it('reads the route values, falling back to pages and all', () => {
    expect(viewFrom('domains')).toBe('domains')
    expect(viewFrom('nope')).toBe('pages')
    expect(viewFrom(null)).toBe('pages')
    expect(whoseFrom('competitor')).toBe('competitor')
    expect(whoseFrom('mine')).toBe('all')
  })

  it('groups pages by domain, each question and overview once at its best position', () => {
    const rows = [
      page('a', 'g2.com', {
        marketIds: ['mkt-us'],
        questions: [ref('p1', 'mkt-us', 4)],
        overviews: [seen('p1', 'mkt-us', 4)]
      }),
      page('b', 'g2.com', {
        marketIds: ['mkt-uk', 'mkt-us'],
        questions: [ref('p1', 'mkt-uk', 2), ref('p2', 'mkt-us', 3)],
        overviews: [seen('p1', 'mkt-us', 6), seen('p1', 'mkt-uk', 2), seen('p2', 'mkt-us', 3)]
      }),
      page('c', 'textbolt.com', { whose: 'yours', title: 'Pricing' })
    ]
    const [g2, own] = domainRows(rows)
    expect(g2).toMatchObject({ id: 'd-g2.com', kind: 'domain', domain: 'g2.com', url: null })
    expect(g2?.pages.map((item) => item.id)).toEqual(['a', 'b'])
    expect(g2?.marketIds).toEqual(['mkt-us', 'mkt-uk'])
    expect(g2?.questions.map((item) => [item.id, item.marketIds, item.position])).toEqual([
      ['page-1|p1', ['mkt-us', 'mkt-uk'], 2],
      ['page-1|p2', ['mkt-us'], 3]
    ])
    expect(g2?.overviews.map((item) => [item.id, item.position])).toEqual([
      ['run-mkt-us|p1', 4],
      ['run-mkt-uk|p1', 2],
      ['run-mkt-us|p2', 3]
    ])
    expect(own?.whose).toBe('yours')
    expect(listRows(rows, 'pages').map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters and counts by whose, and names rows plainly', () => {
    const rows = listRows(
      [
        page('a', 'textbolt.com', { whose: 'yours', title: 'Pricing' }),
        page('b', 'twilio.com', { whose: 'competitor', competitor: 'Twilio' }),
        page('c', 'g2.com')
      ],
      'pages'
    )
    expect(whoseCounts(rows)).toEqual({ all: 3, yours: 1, competitor: 1, other: 1 })
    expect(filterWhose(rows, 'competitor').map((item) => item.id)).toEqual(['b'])
    expect(filterWhose(rows, 'all')).toHaveLength(3)
    expect(rows.map(rowName)).toEqual(['Pricing', 'twilio.com/b/', 'g2.com/c/'])
    expect(rows.map(whoseText)).toEqual(['Yours', 'Twilio', 'Other'])
  })
})

describe('pitchQuestions', () => {
  it('keeps an other site’s questions where a competitor is cited next to it and you are not', () => {
    const over = (id: string, questionId: string): CitedOverviewRef => ({
      id,
      questionId,
      marketId: 'mkt-us',
      runId: 'run-1',
      position: 1
    })
    const q = (promptId: string): CitedQuestionRef => ({
      ...ref(promptId, 'mkt-us', 1),
      id: `page-1|${promptId}`
    })
    const rows = [
      page('mine', 'textbolt.com', { whose: 'yours', overviews: [over('o1', 'page-1|p1')] }),
      page('rival', 'twilio.com', {
        whose: 'competitor',
        overviews: [over('o1', 'page-1|p1'), over('o2', 'page-1|p2')]
      }),
      page('blog', 'example.com', {
        questions: [q('p1'), q('p2'), q('p3')],
        overviews: [over('o1', 'page-1|p1'), over('o2', 'page-1|p2'), over('o3', 'page-1|p3')]
      })
    ]
    const found = pitchQuestions(rows)
    expect([...found.keys()]).toEqual(['blog'])
    expect([...(found.get('blog') ?? [])]).toEqual(['page-1|p2'])
  })
})

describe('citationsListLink', () => {
  it('opens the List for a link with its filters, and leaves every other link alone', () => {
    expect(citationsListLink('#/citations?cit.whose=other')).toBe(
      '#/citations?cit.whose=other&view=list'
    )
    expect(citationsListLink('#/citations?view=pages&cit.whose=other')).toBeNull()
    expect(citationsListLink('#/citations')).toBeNull()
    expect(citationsListLink('#/citations?d.result=target')).toBeNull()
  })
})
