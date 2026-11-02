// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import { axeViolations } from '../ui/axe.test-helper'
import { ExportScreen } from './export'
import { createMockReportsClient } from './mockClient'
import { ReportsScreen } from './ReportsScreen'
import { createMockSchedulesClient } from './schedulesMock'
import { openTab } from './schedules.test-helper'

const MARKET: Market = {
  id: 'us-en',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

afterEach(() => {
  cleanup()
  // The export form lives on the URL: start each test from a clean one.
  window.location.hash = ''
})

describe('v2 reports screens are axe-clean', () => {
  it('Scheduled reports: both tabs and the form panel', async () => {
    const view = render(
      <ReportsScreen
        client={createMockSchedulesClient()}
        timeZone="America/Chicago"
        exportCsv={null}
      />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    expect(await axeViolations(view.container)).toEqual([])
    openTab(body, 'Delivery history')
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(body.getByRole('button', { name: 'New schedule' }))
    expect(body.getByRole('dialog', { name: 'New schedule' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  }, 30_000)

  it('Export a report', async () => {
    const view = render(
      <ExportScreen
        client={createMockReportsClient({ paceMs: 0 })}
        project={{ id: 'p', name: 'TextBolt', defaultMarket: MARKET }}
        pages={[{ id: 'page-1', label: 'Text alerts' }]}
        initialPageId="page-1"
        readPage={() => Promise.resolve({ markets: [MARKET] })}
      />
    )
    await waitFor(() => {
      expect(within(view.container).getByText(/^\d+ checks?$/)).toBeTruthy()
    })
    expect(await axeViolations(view.container)).toEqual([])
  }, 30_000)
})
