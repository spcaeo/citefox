// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MetricsRequest, ReportDownloadRequest } from '@shared/ipc'
import { EMPTY_EXTRAS, type ReportExtras } from '@shared/report/review'
import { sampleMetrics } from '@shared/report/review/sample.test-helper'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockSchedulesClient } from '../schedulesMock'
import { ReportsScreen } from '../ReportsScreen'
import type { ReviewClient } from './client'
import type { ReviewProject } from './ReviewView'

/**
 * The Visibility report's new cards in the app: the cover strip, the headline, the net
 * sentiment line, the opportunity, By engine, target pages, the Topics universe and the
 * Reputation tab, each number opening its drawer.
 */

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const SITE = 'https://textbolt.com'

const PROJECT: ReviewProject = {
  id: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  brand: 'TextBolt',
  defaultMarket: {
    id: 'us',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  },
  markets: []
}

const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  visibility: {
    scopeLabel: 'Whole project',
    brands: ['TextBolt'],
    targets: {
      'topic-1|q1': [`${SITE}/email-to-sms-outlook`],
      'topic-1|q5': [`${SITE}/features`, `${SITE}/textbolt-for-schools`]
    },
    reputation: {
      brand: 'TextBolt',
      answers: 9,
      read: 9,
      claims: { positive: 4, neutral: 1, negative: 1 },
      rows: [
        {
          rowId: 'google_aio:c3:q2',
          tone: 'positive',
          theme: 'Setup',
          rank: '#1 of 2 brands named',
          reason: 'Listed first for setup.'
        }
      ],
      issues: [
        {
          id: 'c1',
          rowId: 'google_aio:c3:q2',
          question: '',
          claim: 'TextBolt has no trial.',
          brand: 'TextBolt',
          own: true,
          why: 'It has one.',
          correction: 'TextBolt has a 14-day trial.',
          sourceToFix: 'g2.com'
        }
      ],
      trend: [{ at: '2026-10-28T15:00:00.000Z', positive: 4, neutral: 1, negative: 1 }],
      themes: [
        {
          theme: 'Setup',
          positive: 2,
          neutral: 0,
          negative: 0,
          examples: [{ claim: 'Quick to set up.', tone: 'positive', rowId: 'google_aio:c3:q2' }]
        }
      ],
      brands: [
        {
          brand: 'TextBolt',
          own: true,
          rowIds: ['google_aio:c3:q2'],
          first: 1,
          positive: 4,
          neutral: 1,
          negative: 1
        },
        {
          brand: 'Twilio',
          own: false,
          rowIds: ['google_aio:c3:q2'],
          first: 0,
          positive: 1,
          neutral: 0,
          negative: 0
        }
      ]
    },
    since: null
  }
}

function fakeClient(): { client: ReviewClient; saved: ReportDownloadRequest[] } {
  const saved: ReportDownloadRequest[] = []
  const read = (request: MetricsRequest): ReturnType<typeof sampleMetrics> =>
    sampleMetrics({
      engine:
        request.engine === 'chatgpt' || request.engine === 'google_aio' ? request.engine : 'all',
      from: request.from === null ? null : undefined
    })
  return {
    saved,
    client: {
      metrics: async (request) => read(request),
      review: async (request) => ({ metrics: read(request), extras: EXTRAS }),
      download: async (request) => {
        saved.push(request)
        return { ok: true, filePath: '/tmp/x.csv', filename: 'x.csv', bytes: 10 }
      }
    }
  }
}

function screen(client: ReviewClient): ReturnType<typeof render> {
  return render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="America/Chicago"
      reviewClient={client}
      project={PROJECT}
      pages={[{ id: 'topic-1', label: 'Email to SMS', title: null, url: null, kind: 'topic' }]}
    />
  )
}

describe('Visibility report › new cards', () => {
  it('Where you stand: cover, headline, sentiment line, opportunity and engines', async () => {
    window.location.hash = '#/?report=visibility'
    const { client } = fakeClient()
    const view = screen(client)
    await view.findByRole('heading', { name: 'The opportunity' })
    const facts = view.getByLabelText('About this report')
    expect(facts.textContent).toContain('Brands looked for')
    expect(facts.textContent).toContain('2 of 12 questions')
    expect(view.getByText(/An AI answer shows for/)).toBeTruthy()
    expect(view.getByText(/Net sentiment \+50 from 6 claims/)).toBeTruthy()
    expect(view.getAllByText(/of tracked/).length).toBe(1)
    const tabs = view.getByRole('tablist', { name: 'Report sections' })
    expect(within(tabs).getByRole('tab', { name: /^Reputation & sources/ })).toBeTruthy()
    // By engine: each number opens its questions in a drawer.
    const engines = view.getByRole('table', { name: 'By engine' })
    expect(within(engines).getAllByRole('row')).toHaveLength(3)
    fireEvent.click(within(engines).getAllByRole('button')[0] as HTMLElement)
    await waitFor(() => expect(window.location.hash).toContain('rd=vis%3Aeng%3Agoogle_aio%3Aans'))
    // The sentiment line opens Reputation.
    fireEvent.click(view.getByRole('button', { name: 'See Reputation' }))
    await view.findByRole('heading', { name: 'What AI says about you' })
    expect(window.location.hash).toContain('section=reputation')
  })

  it('Reputation leads with the score, then themes, competitors, claims and answers', async () => {
    window.location.hash = '#/?report=visibility&section=reputation'
    const { client, saved } = fakeClient()
    const view = screen(client)
    await view.findByRole('heading', { name: 'Net sentiment' })
    expect(document.querySelector('.rv-net')?.textContent).toBe('+50')
    expect(view.getByText('Quick to set up.')).toBeTruthy()
    expect(view.getByRole('table', { name: 'You next to your competitors' })).toBeTruthy()
    expect(view.getByText(/TextBolt has a 14-day trial\./)).toBeTruthy()
    expect(view.getByText('g2.com')).toBeTruthy()
    // Answer by answer starts collapsed.
    expect(view.queryByRole('table', { name: 'Answer by answer' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Show 1 answer' }))
    expect(view.getByRole('table', { name: 'Answer by answer' }).textContent).toContain(
      '#1 of 2 brands named'
    )
    fireEvent.click(
      within(view.getByRole('region', { name: 'Wrong claims worth correcting' })).getByRole(
        'button',
        { name: 'Download CSV' }
      )
    )
    await waitFor(() => expect(saved.at(-1)).toMatchObject({ format: 'csv', table: 'claims' }))
  })

  it('Reputation says what it needs on an engine CiteFox AI does not read', async () => {
    window.location.hash = '#/?report=visibility&section=reputation&engine=chatgpt'
    const { client } = fakeClient()
    const view = screen(client)
    await view.findByText(/Pick Google AI Overview or All engines/)
    expect(view.queryByRole('heading', { name: 'Net sentiment' })).toBeNull()
  })

  it('Pages: target page tiles and table; Topics: universe tiles and new columns', async () => {
    window.location.hash = '#/?report=visibility&section=pages'
    const { client } = fakeClient()
    const view = screen(client)
    const table = await view.findByRole('table', { name: 'Your target pages' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent)
    ).toEqual(['Page', 'Role', 'Set for', 'Google AI Overview', 'ChatGPT', 'Total', 'Status'])
    expect(table.textContent).toContain('Primary')
    expect(table.textContent).toContain('Not cited yet')
    expect(view.getByRole('button', { name: /Target pages set up/ })).toBeTruthy()
    expect(view.getByRole('table', { name: 'Other pages of yours being cited' })).toBeTruthy()
    window.location.hash = '#/?report=visibility&section=topics'
    const topics = await view.findByRole('table', { name: 'Results by Topic group' })
    const heads = within(topics)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(heads).toContain('Answer shown')
    expect(heads).toContain('Brand named')
    expect(topics.textContent).toContain('Few questions')
    expect(view.getByRole('button', { name: /Largest/ })).toBeTruthy()
  })
})
