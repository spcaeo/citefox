// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import type { ReportsClient } from './client'
import { ExportScreen } from './export'
import { createMockReportsClient } from './mockClient'

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

function recording(requests: ExportRequest[]): ReportsClient {
  const client = createMockReportsClient({ paceMs: 0 })
  return {
    ...client,
    startExport: (request) => {
      requests.push(request)
      return client.startExport(request)
    }
  }
}

describe('Export screen and topic subjects', () => {
  it('offers Topic coverage for a topic, and only says why for a page', async () => {
    const requests: ExportRequest[] = []
    const view = render(
      <ExportScreen
        client={recording(requests)}
        project={{ id: 'textbolt', name: 'TextBolt', defaultMarket: MARKET }}
        pages={[
          { id: 'alerts', label: 'Text alerts for business' },
          { id: 'topic-1', label: 'Text alerts for teams', kind: 'topic' }
        ]}
        initialPageId="alerts"
        readPage={() => Promise.resolve({ markets: [MARKET] })}
      />
    )
    const body = within(view.container)
    const box = (): HTMLInputElement =>
      body.getByRole('checkbox', { name: /^Topic coverage/ }) as HTMLInputElement
    expect(box().disabled).toBe(true)
    expect(body.getByText(/Topic coverage is built for topics\. Pick a topic/)).toBeTruthy()
    expect(body.getByText('New')).toBeTruthy()

    fireEvent.click(
      within(body.getByRole('radiogroup', { name: 'This page: pick' })).getByRole('radio', {
        name: /Text alerts for teams/
      })
    )
    expect(box().disabled).toBe(false)
    expect(box().checked).toBe(true)
    const save = body.getByRole('button', { name: 'Save HTML report' })
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.pageIds).toEqual(['topic-1'])
    expect(requests[0]?.sections).toContain('topic_coverage')
  })
})
