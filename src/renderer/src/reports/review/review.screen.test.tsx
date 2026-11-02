// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MetricsRequest, ReportDownloadRequest } from '@shared/ipc'
import { sampleMetrics } from '@shared/report/review/sample.test-helper'
import { NO_SENDER } from '@shared/report/review/sender'
import { resetDrawersForTests } from '../../shell/drawers'
import { primeReportSender } from '../branding/senderStore'
import { createMockSchedulesClient } from '../schedulesMock'
import { ReportsScreen } from '../ReportsScreen'
import type { ReviewClient } from './client'
import type { ReviewProject } from './ReviewView'

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
  primeReportSender(null)
})

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

function fakeClient(): {
  client: ReviewClient
  asked: MetricsRequest[]
  saved: ReportDownloadRequest[]
} {
  const asked: MetricsRequest[] = []
  const saved: ReportDownloadRequest[] = []
  return {
    asked,
    saved,
    client: {
      metrics: async (request) => {
        asked.push(request)
        return sampleMetrics({
          engine:
            request.engine === 'chatgpt' || request.engine === 'google_aio'
              ? request.engine
              : 'all',
          from: request.from === null ? null : undefined
        })
      },
      download: async (request) => {
        saved.push(request)
        return {
          ok: true,
          filePath: '/tmp/x.html',
          filename: 'textbolt.com-impact-review.html',
          bytes: 10
        }
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

describe('Reports › Ready reports', () => {
  it('opens By goal; By report shows the six reports with Open, Download, Print / PDF and Email', async () => {
    const { client, saved } = fakeClient()
    // An agency: the pitch goal reads "Pitch a new client".
    primeReportSender({ ...NO_SENDER, mode: 'agency', name: 'Northwind SEO' })
    const view = screen(client)
    expect(view.getByRole('tab', { name: /By goal/ }).getAttribute('aria-selected')).toBe('true')
    for (const name of ['Where do we stand?', 'Pitch a new client', 'Us vs one competitor']) {
      expect(view.getByRole('region', { name })).toBeTruthy()
    }
    fireEvent.click(view.getByRole('tab', { name: /By report/ }))
    expect(view.getByRole('tab', { name: 'Ready reports' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    for (const name of [
      'Visibility report',
      'What changed',
      'Impact review',
      'Pitch / audit',
      'Content plan',
      'Head-to-head'
    ]) {
      const card = view.getByRole('region', { name })
      expect(within(card).getByRole('button', { name: 'Open' })).toBeTruthy()
      expect(within(card).getByRole('button', { name: /Download/ })).toBeTruthy()
      expect(within(card).getByRole('button', { name: 'Print / PDF' })).toBeTruthy()
      expect(within(card).getByRole('button', { name: 'Email on a schedule' })).toBeTruthy()
    }
    const visibility = view.getByRole('region', { name: 'Visibility report' })
    await waitFor(() => expect(visibility.textContent).toContain('7 of 12'))
    const impact = view.getByRole('region', { name: 'Impact review' })
    await waitFor(() => expect(impact.textContent).toContain('3 pages published'))
    fireEvent.click(within(impact).getByRole('button', { name: 'Print / PDF' }))
    await waitFor(() => expect(saved.at(-1)).toMatchObject({ report: 'impact', format: 'pdf' }))
    await waitFor(() =>
      expect(impact.textContent).toContain('Saved textbolt.com-impact-review.html')
    )
    // Email on a schedule: Scheduled emails, with a new schedule open.
    fireEvent.click(within(impact).getByRole('button', { name: 'Email on a schedule' }))
    expect(window.location.hash).toContain('tab=emails')
    expect(window.location.hash).toContain('drawer=schedule')
    // The card's report is picked: the new schedule sends the Impact review's PDF.
    expect(window.location.hash).toContain('schedule.report=impact')
    const which = (await view.findByLabelText('Which report')) as HTMLSelectElement
    expect(which.value).toBe('impact')
    expect((view.getByLabelText('Report format') as HTMLSelectElement).value).toBe('pdf')
    expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('Impact review')
  })

  it('opens the Impact review: verdict, sections on the URL, and drills in a drawer', async () => {
    window.location.hash = '#/?layout=goals'
    const { client, asked } = fakeClient()
    const view = screen(client)
    fireEvent.click(
      within(view.getByRole('region', { name: 'Did our fixes work?' })).getByRole('button', {
        name: 'Open'
      })
    )
    expect(window.location.hash).toBe('#/?report=impact')
    const verdict = await view.findByRole('region', { name: 'Verdict' })
    expect(asked.at(-1)).toMatchObject({ from: 'first', to: null, engine: 'all' })
    expect(verdict.textContent).toContain('went from 5 to 7')
    expect(view.getByRole('heading', { name: 'Market vs your work' })).toBeTruthy()
    const tabs = view.getByRole('tablist', { name: 'Report sections' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual([
      'Verdict',
      'Published pages',
      'Questions',
      'Competitors',
      'Pages•',
      'Client asks•',
      'More',
      'How we measured'
    ])
    // A KPI opens exactly its questions, over the screen, on the URL.
    fireEvent.click(within(verdict).getByRole('button', { name: /Questions citing your site/ }))
    const drawer = await view.findByRole('dialog', { name: /Questions citing your pages/ })
    expect(window.location.hash).toContain('drawer=report-drill&rd=cite%3Aa')
    expect(within(drawer).getByTestId('rv-dstats').textContent).toContain('7 questions')
    expect(within(drawer).getAllByRole('row').length).toBe(8)
    // One more level: a question opens its answers on each engine.
    fireEvent.click(within(drawer).getAllByRole('row')[1] as HTMLElement)
    await waitFor(() => expect(window.location.hash).toContain('drawer=report-detail'))
    await waitFor(() => expect(document.querySelector('[data-rd2^="q:"]')).not.toBeNull())
    const detail = document.querySelector('[data-rd2^="q:"]') as HTMLElement
    expect(within(detail).getByRole('table', { name: 'Each engine' })).toBeTruthy()

    // Sections keep their place on the URL.
    window.location.hash = '#/?report=impact&section=topics&seg=intent'
    await view.findByRole('table', { name: 'Results by Intent' })
    window.location.hash = '#/?report=impact&section=questions&show=lost'
    const table = await view.findByRole('table', { name: 'Every question' })
    expect(within(table).getAllByRole('row').length).toBe(1 + 3)
  })

  it('header tools are icons; search sits at the end of the pickers row', async () => {
    window.location.hash = '#/?report=impact'
    const { client } = fakeClient()
    const view = screen(client)
    await view.findByRole('region', { name: 'Verdict' })
    const tools = view.getByRole('group', { name: 'Report tools' })
    for (const name of ['Download', 'Print / PDF', 'Email on a schedule']) {
      const button = within(tools).getByRole('button', { name })
      expect(button.textContent?.trim()).toBe('')
      expect(button.getAttribute('data-tip')).toBe(name)
    }
    const filters = view.getByRole('group', { name: 'Report filters' })
    expect(within(filters).getByRole('searchbox', { name: 'Search this report' })).toBeTruthy()
    expect(within(filters).getByRole('combobox', { name: 'From' })).toBeTruthy()
  })

  it('reads the engine filter and From check from the URL', async () => {
    window.location.hash = '#/?report=changed&engine=chatgpt&from=c2'
    const { client, asked } = fakeClient()
    const view = screen(client)
    await view.findByRole('region', { name: 'Verdict' })
    expect(asked.at(-1)).toMatchObject({ engine: 'chatgpt', from: 'c2' })
    const from = view.getByRole('combobox', { name: 'From' }) as HTMLSelectElement
    expect([...from.options].map((option) => option.text)).toContain('From the first check')
  })

  it('Visibility report reads the latest check only and downloads one table as CSV', async () => {
    window.location.hash = '#/?report=visibility'
    const { client, asked, saved } = fakeClient()
    const view = screen(client)
    await view.findByRole('heading', { name: 'Where visibility falls away' })
    expect(asked.at(-1)).toMatchObject({ from: null })
    expect(view.queryByRole('combobox', { name: 'From' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Download/ }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Topics (CSV)' }))
    await waitFor(() =>
      expect(saved.at(-1)).toMatchObject({ format: 'csv', table: 'topics', report: 'visibility' })
    )
  })

  it('keeps the schedules in Scheduled emails', async () => {
    window.location.hash = '#/?tab=emails'
    const { client } = fakeClient()
    const view = screen(client)
    await waitFor(() =>
      expect(view.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    )
    expect(view.getByRole('tab', { name: /^Delivery history/ })).toBeTruthy()
    expect(view.getByRole('button', { name: 'New schedule' })).toBeTruthy()
  })
})

describe('Reports › By goal', () => {
  it('a goal opens its report on the right tab', async () => {
    window.location.hash = '#/?layout=goals'
    const { client } = fakeClient()
    const view = screen(client)
    fireEvent.click(
      within(view.getByRole('region', { name: 'What should we write next?' })).getByRole('button', {
        name: 'Open'
      })
    )
    await waitFor(() => expect(window.location.hash).toContain('report=content'))
  })
})
