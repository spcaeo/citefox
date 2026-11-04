// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeMetrics, type MetricsResult } from '@shared/metrics'
import { sampleMetrics, sampleRows } from '@shared/report/review/sample.test-helper'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockSchedulesClient } from '../schedulesMock'
import { ReportsScreen } from '../ReportsScreen'
import type { ReviewClient } from './client'
import type { ReviewProject } from './ReviewView'

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const PROJECT: ReviewProject = {
  id: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  brand: 'TextBolt',
  defaultMarket: null,
  markets: []
}

/** Today's real data: one check, no fixes logged. */
function littleMetrics(): MetricsResult {
  return computeMetrics({
    rows: sampleRows().filter((row) => row.checkId === 'c3'),
    pages: [],
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine: 'all',
    window: { from: '2026-10-28T15:00:00.000Z', to: null }
  })
}

function client(metrics: () => MetricsResult): ReviewClient {
  return {
    metrics: async () => metrics(),
    download: async () => ({ ok: true, filePath: '/tmp/x', filename: 'x.html', bytes: 1 })
  }
}

function screen(review: ReviewClient): ReturnType<typeof render> {
  return render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="America/Chicago"
      reviewClient={review}
      project={PROJECT}
      pages={[]}
    />
  )
}

describe('Impact review in the app: little data', () => {
  it('opens on "What this report needs" with Log a fix, Run a check and the next check', async () => {
    window.location.hash = '#/?report=impact'
    const view = screen(client(littleMetrics))
    const needs = await view.findByRole('region', { name: 'What this report needs' })
    expect(needs.textContent).toContain('None are logged yet')
    expect(needs.textContent).toContain('There is 1 check so far')
    expect(within(needs).getByRole('link', { name: 'When the next check runs' })).toBeTruthy()
    fireEvent.click(within(needs).getByRole('button', { name: 'Log a fix' }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=fix'))
    window.location.hash = '#/?report=impact'
    const again = await view.findByRole('region', { name: 'What this report needs' })
    fireEvent.click(within(again).getByRole('button', { name: 'Run a check' }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=check-now'))
  })

  it('hides empty tabs, greys the rest with what they need, and never shows the speed chart', async () => {
    window.location.hash = '#/?report=impact'
    const view = screen(client(littleMetrics))
    await view.findByRole('region', { name: 'Verdict' })
    const names = within(view.getByRole('tablist', { name: 'Report sections' }))
      .getAllByRole('tab')
      .map((tab) => tab.textContent)
    expect(names).not.toContain('Lost ground')
    expect(names).not.toContain('Not indexed')
    expect(view.queryByRole('heading', { name: 'How fast new pages get cited' })).toBeNull()
    expect(view.getByTestId('rv-meta').textContent).toMatch(
      /^12 questions · 0 pages published · measured \S+/
    )
    window.location.hash = '#/?report=impact&section=published'
    const empty = await view.findByRole('region', { name: 'Published pages' })
    expect(empty.textContent).toContain('Nothing to show yet. Needs a logged fix')
  })
})

describe('Impact review in the app: verdict, published pages and the page story', () => {
  it('shows the intro, proofs and top sites, and a next step opens its tab', async () => {
    window.location.hash = '#/?report=impact'
    const view = screen(client(() => sampleMetrics()))
    const intro = await view.findByRole('region', { name: 'About this review' })
    expect(intro.textContent).toContain('About these results: answers vary.')
    expect(within(intro).getByLabelText('At a glance').textContent).toContain('Pages published')
    const verdict = view.getByRole('region', { name: 'Verdict' })
    expect(verdict.textContent).toContain('came through your published pages')
    expect(within(verdict).getByRole('button', { name: /Brand named/ })).toBeTruthy()
    expect(within(verdict).getByRole('button', { name: /Average position/ })).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Most cited sites' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Open Lost ground →' }))
    await waitFor(() => expect(window.location.hash).toContain('section=lost'))
  })

  it('Published pages: kind and days tables, search, sort, and a row opens the page story', async () => {
    window.location.hash = '#/?report=impact&section=published'
    const view = screen(client(() => sampleMetrics()))
    await view.findByRole('table', { name: 'New pages and rewrites' })
    expect(view.getByRole('table', { name: 'By days live' })).toBeTruthy()
    const table = view.getByRole('table', { name: 'Every published page' })
    expect(within(table).getByRole('button', { name: /#1 spots/ })).toBeTruthy()
    fireEvent.change(view.getByRole('searchbox', { name: 'Find a page' }), {
      target: { value: 'schools' }
    })
    expect(
      within(view.getByRole('table', { name: 'Every published page' })).getAllByRole('row').length
    ).toBe(2)
    fireEvent.change(view.getByRole('searchbox', { name: 'Find a page' }), {
      target: { value: '' }
    })
    fireEvent.click(view.getByRole('button', { name: 'Rewrites 1' }))
    await waitFor(() => expect(window.location.hash).toContain('pshow=rewrite'))
    const rows = within(view.getByRole('table', { name: 'Every published page' })).getAllByRole(
      'row'
    )
    fireEvent.click(rows[1] as HTMLElement)
    const story = await view.findByTestId('rv-page-story')
    expect(within(story).getByLabelText('Before and after').textContent).toContain(
      'Average position'
    )
    expect(story.textContent).toContain('Dates')
    expect(within(story).getByRole('group', { name: 'Which questions' }).textContent).toContain(
      'Dropped'
    )
  })

  it('keeps table sorts and the page search on the URL, and reads them from a link', async () => {
    window.location.hash = '#/?report=impact&section=published'
    const view = screen(client(() => sampleMetrics()))
    const table = await view.findByRole('table', { name: 'Every published page' })
    fireEvent.change(view.getByRole('searchbox', { name: 'Find a page' }), {
      target: { value: 'schools' }
    })
    expect(window.location.hash).toContain('pq=schools')
    fireEvent.change(view.getByRole('searchbox', { name: 'Find a page' }), {
      target: { value: '' }
    })
    expect(window.location.hash).not.toContain('pq=')
    fireEvent.click(within(table).getByRole('button', { name: /^Page/ }))
    await waitFor(() => expect(window.location.hash).toContain('psort=page%3Aasc'))
    // Another tab drops the sort; Questions and Competitors have their own.
    fireEvent.click(view.getByRole('tab', { name: 'Questions' }))
    await waitFor(() => expect(window.location.hash).not.toContain('psort'))
    const questions = await view.findByRole('table', { name: 'Every question' })
    fireEvent.click(within(questions).getByRole('button', { name: /^Question/ }))
    await waitFor(() => expect(window.location.hash).toContain('qsort=text%3Aasc'))
    fireEvent.click(view.getByRole('tab', { name: 'Competitors' }))
    await waitFor(() => expect(window.location.hash).not.toContain('qsort'))
    const sites = await view.findByRole('table', { name: /cited site/i })
    fireEvent.click(within(sites).getByRole('button', { name: /^Site/ }))
    await waitFor(() => expect(window.location.hash).toContain('csort=domain%3Aasc'))
    // The same sort in a pasted link.
    cleanup()
    window.location.hash = '#/?report=impact&section=questions&qsort=text%3Adesc'
    const again = screen(client(() => sampleMetrics()))
    const sorted = await again.findByRole('table', { name: 'Every question' })
    const head = within(sorted)
      .getByRole('button', { name: /^Question/ })
      .closest('th')
    expect(head?.getAttribute('aria-sort')).toBe('descending')
  })

  it('Download menu has every table, Backlinks included', async () => {
    window.location.hash = '#/?report=impact'
    const view = screen(client(() => sampleMetrics()))
    await view.findByRole('region', { name: 'Verdict' })
    fireEvent.click(view.getByRole('button', { name: /Download/ }))
    expect(within(document.body).getByRole('menuitem', { name: 'Backlinks (CSV)' })).toBeTruthy()
  })
})
