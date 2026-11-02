// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExportPreviewPage, Market } from '@shared/domain'
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

const PAGES: readonly ExportPreviewPage[] = [
  {
    pageId: 'welcome',
    url: 'https://example.com/welcome',
    title: 'Welcome',
    markets: [
      { marketId: 'us-en', code: 'us-en', checks: ['2026-10-05T16:00:00.000Z'] },
      {
        marketId: 'ca-en',
        code: 'ca-en',
        checks: ['2026-10-05T16:00:00.000Z', '2026-10-19T16:00:00.000Z']
      }
    ]
  },
  {
    pageId: 'pricing',
    url: 'https://example.com/pricing',
    title: null,
    markets: [{ marketId: 'us-en', code: 'us-en', checks: ['2026-10-19T16:00:00.000Z'] }]
  }
]

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

/** The sample engine, with counts and the lists behind them as main sends them. */
function withPages(): ReportsClient {
  const base = createMockReportsClient({ paceMs: 0 })
  return {
    ...base,
    previewExport: async (request) => ({
      ...(await base.previewExport(request)),
      pageCount: 2,
      marketCount: 2,
      checkCount: 4,
      pages: PAGES
    })
  }
}

function renderScreen(client: ReportsClient): ReturnType<typeof within> {
  const view = render(
    <ExportScreen
      client={client}
      project={{ id: 'harbor', name: 'Harbor', defaultMarket: MARKET }}
      pages={[{ id: 'welcome', label: 'Welcome' }]}
      readPage={() => Promise.resolve({ markets: [MARKET] })}
    />
  )
  return within(view.container)
}

function drawerRows(dialog: HTMLElement): Element[] {
  return [...dialog.querySelectorAll('[data-drill-row]')]
}

describe('Export summary drill-downs', () => {
  it('opens exactly the pages, markets and checks each count shows', async () => {
    const body = renderScreen(withPages())
    const cases = [
      { id: 'export:pages', count: 2 },
      { id: 'export:markets', count: 2 },
      { id: 'export:checks', count: 4 }
    ]
    for (const { id, count } of cases) {
      const opener = await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>(`[data-nfr-drill="${id}"]`)
        if (!found) throw new Error(`no ${id}`)
        return found
      })
      expect(opener.tagName).toBe('BUTTON')
      expect(opener.querySelector(`[data-nfr-figure="${id}"]`)?.textContent).toBe(String(count))
      fireEvent.click(opener)
      const dialog = await body.findByRole('dialog')
      expect(dialog.getAttribute('data-drill')).toBe(id)
      expect(drawerRows(dialog)).toHaveLength(count)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
    }
  })

  it('opens a page from its row with Enter', async () => {
    const body = renderScreen(withPages())
    const opener = await body.findByRole('button', { name: /^2 pages: Pages in this export/ })
    fireEvent.click(opener)
    const dialog = await body.findByRole('dialog', { name: /Pages in this export/ })
    const grid = within(dialog).getByRole('grid')
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' })
    await waitFor(() => expect(window.location.hash).toBe('#/pages/welcome/results'))
  })

  it('shows plain counts when main sends no lists', async () => {
    const body = renderScreen(createMockReportsClient({ paceMs: 0 }))
    await waitFor(() => expect(body.getByText(/^\d+ pages?$/)).toBeTruthy())
    expect(document.querySelector('[data-nfr-drill^="export:"]')).toBeNull()
  })
})
