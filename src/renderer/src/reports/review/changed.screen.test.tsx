// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeMetrics } from '@shared/metrics'
import { samplePages, sampleMetrics, sampleRows } from '@shared/report/review/sample.test-helper'
import { EMPTY_EXTRAS } from '@shared/report/review'
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

function client(oneCheck: boolean): ReviewClient {
  const metrics = oneCheck
    ? computeMetrics({
        rows: sampleRows().filter((row) => row.checkId === 'c1'),
        pages: samplePages(),
        ownDomain: 'textbolt.com',
        scope: { kind: 'project' },
        marketId: null,
        engine: 'all',
        window: { from: '2026-09-16T15:00:00.000Z', to: null }
      })
    : sampleMetrics()
  return {
    metrics: async () => metrics,
    review: async () => ({
      metrics,
      extras: { ...EMPTY_EXTRAS, nextCheckAt: oneCheck ? '2026-09-30T15:00:00.000Z' : null }
    }),
    download: async () => ({ ok: true, filePath: '/tmp/x.html', filename: 'x.html', bytes: 1 })
  }
}

function screen(reviewClient: ReviewClient): ReturnType<typeof render> {
  return render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="America/Chicago"
      reviewClient={reviewClient}
      project={PROJECT}
      pages={[]}
    />
  )
}

describe('Reports › What changed', () => {
  it('with one check, shows one panel saying it needs a second check and when it runs', async () => {
    window.location.hash = '#/?report=changed&section=questions'
    const view = screen(client(true))
    const panel = await view.findByRole('region', { name: 'What changed needs a second check' })
    expect(panel.textContent).toContain('Next check on')
    const tabs = view.getByRole('tablist', { name: 'Report sections' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['What changed'])
  })

  it('shows the cover strip, Brand named, and the four movement lists', async () => {
    window.location.hash = '#/?report=changed'
    const view = screen(client(false))
    const verdict = await view.findByRole('region', { name: 'Verdict' })
    expect(verdict.textContent).toContain('Brand named')
    expect(
      view.getByText('Every number covers the 12 questions checked on both dates.')
    ).toBeTruthy()
    expect(view.getByRole('table', { name: 'Before, after and change' })).toBeTruthy()
    window.location.hash = '#/?report=changed&section=changed'
    await view.findByRole('heading', { name: 'Which questions moved' })
    for (const name of ['Gained a citation', 'Lost a citation', 'Newly named', 'No longer named']) {
      expect(view.getByRole('region', { name })).toBeTruthy()
    }
    expect(view.getByText(/Nothing left out\./)).toBeTruthy()
  })
})
