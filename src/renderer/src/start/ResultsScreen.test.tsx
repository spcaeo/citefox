// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TopicResultRow } from '@shared/domain'
import type { SiteStartPlan, TopicResults } from '@shared/ipc'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { axeViolations } from '../ui/axe.test-helper'
import { fakeStartClient } from './fakeStartClient.test-helper'
import { StartResultsScreen } from './ResultsScreen'
import { firstFixes, firstResultsHeadline, firstResultsModel, sourcesOf } from './resultsModel'

afterEach(cleanup)
vi.setConfig({ testTimeout: 30_000 })

const PROJECT = { id: 'proj-1', name: 'TextBolt', domain: 'textbolt.com' }
const BASE = textboltTopicResults()
const TEMPLATE = BASE.rows[0] as TopicResultRow

function row(
  number: number,
  state: TopicResultRow['state'],
  extra: Partial<TopicResultRow> = {}
): TopicResultRow {
  return {
    ...TEMPLATE,
    promptId: `p${number}`,
    stableKey: `k${number}`,
    number,
    kind: 'question',
    text: `Question ${number}?`,
    state,
    targetUrl: 'https://textbolt.com/pricing/',
    citedOwnUrl: null,
    citedInstead: [],
    position: null,
    aioSummary: null,
    ...extra
  }
}

const ROWS: TopicResultRow[] = [
  row(1, 'not_cited', { citedInstead: ['text-em-all.com', 'simpletexting.com'] }),
  row(2, 'right_page', {
    targetUrl: 'https://textbolt.com/att-alternative/',
    citedOwnUrl: 'https://textbolt.com/att-alternative/',
    citedInstead: ['att.com', 'reddit.com'],
    position: 2,
    aioSummary: 'Email-to-text services such as TextBolt forward alerts.'
  }),
  row(3, 'not_cited', { citedInstead: ['text-em-all.com'] }),
  row(4, 'no_page', { targetUrl: null, citedInstead: ['simpletexting.com'] }),
  row(5, 'no_aio'),
  row(6, 'other_page', {
    targetUrl: 'https://textbolt.com/use-cases/it-alerts/',
    citedOwnUrl: 'https://textbolt.com/blog/x/',
    citedInstead: ['text-em-all.com']
  }),
  row(7, 'not_checked')
]

function results(rows: TopicResultRow[]): TopicResults {
  return { ...BASE, rows }
}

function plan(topicId: string | null): SiteStartPlan {
  return {
    topicId,
    budget: { markets: 1, promptsPerPage: 10, questionsPerTopic: 10, samples: 1, searchesLeft: 200 }
  } as unknown as SiteStartPlan
}

describe('firstResultsModel', () => {
  it('counts overviews shown, citations, rivals and target pages from the rows', () => {
    const model = firstResultsModel(results(ROWS))
    expect(model).toMatchObject({
      questions: 7,
      checked: 6,
      withAio: 5,
      cited: 2,
      rate: 40,
      targetPages: 3,
      targetPagesCited: 1
    })
    expect(model.topInstead).toEqual({ domain: 'text-em-all.com', count: 3 })
    expect(model.nextInstead.map((item) => item.domain)).toEqual([
      'simpletexting.com',
      'att.com',
      'reddit.com'
    ])
    expect(model.win?.cited).toBe(true)
    expect(model.win?.row.number).toBe(2)
    expect(model.glance.map((cell) => cell.label)).toEqual([
      'text-em-all.com',
      'You',
      'text-em-all.com',
      'simpletexting.com',
      '—',
      'You',
      'Not checked'
    ])
    expect(firstResultsHeadline(model)).toBe(
      "Google shows an AI Overview for 5 of 6 questions. You're cited in 2."
    )
  })

  it('places the own page at its cited position among the sources', () => {
    expect(sourcesOf(ROWS[1] as TopicResultRow)).toEqual([
      { position: 1, label: 'att.com', own: false },
      { position: 2, label: 'textbolt.com/att-alternative', own: true },
      { position: 3, label: 'reddit.com', own: false }
    ])
  })

  it('ranks fixes by questions moved: a shared not-cited page first, new pages after', () => {
    const fixes = firstFixes(ROWS)
    expect(fixes).toHaveLength(3)
    expect(fixes[0]).toMatchObject({
      target: '/pricing',
      state: 'not_cited',
      promptIds: ['p1', 'p3'],
      detail: 'Moves Q1, Q3 · text-em-all.com cited instead'
    })
    expect(fixes.map((fix) => fix.state)).toEqual(['not_cited', 'other_page', 'no_page'])
    expect(fixes[2]?.target).toBeNull()
  })

  it('is honest with nothing cited: the closest miss, no win', () => {
    const model = firstResultsModel(results([row(1, 'not_cited'), row(2, 'no_aio')]))
    expect(model.cited).toBe(0)
    expect(model.win?.cited).toBe(false)
    expect(firstResultsHeadline(model)).toBe(
      "Google shows an AI Overview for 1 of 2 questions. You're not cited yet."
    )
    expect(firstResultsHeadline(firstResultsModel(results([row(1, 'no_aio')])))).toBe(
      'Google shows an AI Overview for 0 of 1 question.'
    )
  })
})

describe('StartResultsScreen', () => {
  it('shows the headline, tiles, first win and fixes, with one primary to the dashboard', async () => {
    const client = fakeStartClient({ plan: plan('topic-1'), results: results(ROWS) })
    const view = render(<StartResultsScreen client={client} project={PROJECT} />)
    expect(
      await screen.findByText(
        "Google shows an AI Overview for 5 of 6 questions. You're cited in 2."
      )
    ).toBeTruthy()
    expect(screen.getByRole('region', { name: 'AI Overview shown' }).textContent).toContain('5')
    const sources = screen.getByRole('list', { name: 'AI Overview sources for Q2' })
    expect(within(sources).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Your first 3 fixes' })).toBeTruthy()
    const dashboard = screen.getByRole('link', { name: 'Open my dashboard' })
    expect(dashboard.getAttribute('href')).toBe('#/topics/topic-1')
    const fix = screen.getByRole('link', { name: /Answer these questions up top on \/pricing/ })
    expect(fix.getAttribute('href')).toBe('#/topics/topic-1?filter=state%3Anot_cited')
    expect(screen.getByRole('list', { name: 'Top source cited for each question' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('without a started topic it points back to the plan', async () => {
    const client = fakeStartClient({ plan: plan(null) })
    render(<StartResultsScreen client={client} project={PROJECT} />)
    expect(await screen.findByRole('heading', { name: 'No first check yet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to your plan' }).getAttribute('href')).toBe(
      '#/start'
    )
  })
})
