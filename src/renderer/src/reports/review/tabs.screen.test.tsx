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

function client(little = false): ReviewClient {
  return {
    metrics: async (request) =>
      little ? littleMetrics() : sampleMetrics({ from: request.from === null ? null : undefined }),
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

function topTabs(view: ReturnType<typeof render>): HTMLElement {
  return view.getByRole('tablist', { name: 'Report sections' })
}

function selected(list: HTMLElement): string | null {
  return (
    within(list)
      .getAllByRole('tab')
      .find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? null
  )
}

describe('Ready reports: grouped tabs', () => {
  it('a group opens its first section and shows its pills', async () => {
    window.location.hash = '#/?report=impact'
    const view = screen(client())
    await view.findByRole('region', { name: 'Verdict' })
    expect(view.queryByRole('tablist', { name: 'Client asks sections' })).toBeNull()
    fireEvent.click(within(topTabs(view)).getByRole('tab', { name: /^Client asks/ }))
    await waitFor(() => expect(window.location.hash).toContain('section=notindexed'))
    const pills = await view.findByRole('tablist', { name: 'Client asks sections' })
    expect(
      within(pills)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['Not indexed•', 'Backlinks', 'Next round'])
    expect(selected(pills)).toBe('Not indexed•')
    fireEvent.click(within(pills).getByRole('tab', { name: 'Next round' }))
    await waitFor(() => expect(window.location.hash).toContain('section=next'))
    expect(selected(topTabs(view))).toBe('Client asks•')
  })

  it('an old section link selects the right group and pill', async () => {
    window.location.hash = '#/?report=visibility&section=topics'
    const view = screen(client())
    await view.findByRole('table', { name: 'Results by Topic group' })
    expect(selected(topTabs(view))).toBe('Content')
    const pills = view.getByRole('tablist', { name: 'Content sections' })
    expect(selected(pills)).toBe('Topics')
    expect(
      within(pills)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['Topics', 'Answer shape', 'Deep dives'])
    const quiet = within(topTabs(view)).getByRole('tab', { name: 'How we measured' })
    expect(quiet.className).toContain('rv-tab-quiet')
  })

  it('hidden sections leave their group; a group left with one section has no pills', async () => {
    window.location.hash = '#/?report=impact&section=pages'
    const view = screen(client(true))
    // Lost ground is hidden with nothing to show, so Pages is a plain tab.
    await waitFor(() => expect(selected(topTabs(view))).toBe('Pages'))
    expect(view.queryByRole('tablist', { name: 'Pages sections' })).toBeNull()
    // Not indexed is hidden too: Client asks opens Backlinks, greyed with what it needs.
    fireEvent.click(within(topTabs(view)).getByRole('tab', { name: /^Client asks/ }))
    await waitFor(() => expect(window.location.hash).toContain('section=backlinks'))
    const pills = await view.findByRole('tablist', { name: 'Client asks sections' })
    const names = within(pills)
      .getAllByRole('tab')
      .map((tab) => tab.textContent)
    expect(names).not.toContain('Not indexed')
    expect(
      within(pills).getByRole('tab', { name: 'Backlinks' }).querySelector('.rv-tab-empty')
    ).not.toBeNull()
  })
})
