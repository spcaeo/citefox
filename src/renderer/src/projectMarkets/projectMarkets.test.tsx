// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market } from '@shared/domain'
import type { PageDetail, ProjectMarketPage, ProjectMarketsView } from '@shared/ipc'
import { UndoToastHost } from '../ui'
import { AddMarketDrawer } from './AddMarketDrawer'
import { MarketsTable } from './MarketsTable'
import { addedSearches, pagesText, untrackedDefault } from './model'
import type { ProjectMarketsSource } from './source'

afterEach(cleanup)

const US: Market = {
  id: 'us-en',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: 'uk-en', country: 'GB' }
const CA: Market = { ...US, id: 'ca-en', country: 'CA' }

function page(
  id: string,
  marketIds: string[],
  extra: Partial<ProjectMarketPage> = {}
): ProjectMarketPage {
  return {
    id,
    kind: 'page',
    name: id,
    url: `https://textbolt.com/${id}`,
    status: 'tracked',
    questions: 10,
    samples: 1,
    marketIds,
    defaultMarketId: marketIds[0] ?? null,
    ...extra
  }
}

const VIEW: ProjectMarketsView = {
  projectId: 'textbolt',
  defaultMarketId: US.id,
  markets: [US, UK],
  pages: [
    page('alerts', [US.id, UK.id]),
    page('pricing', [US.id]),
    page('sms-topic', [US.id], { kind: 'topic', name: 'SMS topic', questions: 4, samples: 2 })
  ],
  searchesLeft: 300
}

function fakeSource(view: ProjectMarketsView = VIEW): ProjectMarketsSource {
  return {
    'projectSettings:markets': vi.fn(async () => view),
    'projectSettings:addMarket': vi.fn(async (request) => ({
      marketId: CA.id,
      added: [...request.pageIds],
      alreadyHad: [],
      view: { ...view, markets: [...view.markets, CA] }
    })),
    'projectSettings:removeMarket': vi.fn(async () => ({
      marketId: UK.id,
      removed: [
        {
          pageId: 'alerts',
          addedAt: '2026-10-01T00:00:00.000Z',
          baselineRunId: 'run-1',
          lastCheckedAt: '2026-10-10T00:00:00.000Z',
          wasDefault: false
        }
      ],
      skipped: [],
      view: { ...view, markets: [US] }
    })),
    'projectSettings:restoreMarket': vi.fn(async () => view),
    'projectSettings:setDefaultMarket': vi.fn(async (request) => ({
      previousDefaultMarketId: view.defaultMarketId,
      changedPages:
        request.pages === 'tracking' ? [{ pageId: 'alerts', previousMarketId: US.id }] : [],
      view: { ...view, defaultMarketId: request.marketId }
    })),
    'pages:update': vi.fn(async () => ({}) as PageDetail)
  }
}

async function rowAction(name: string, item: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}

describe('project markets model', () => {
  it('starts on the first untracked country and counts added searches', () => {
    expect(untrackedDefault([US, UK])).toEqual({ country: 'CA', language: 'en' })
    expect(untrackedDefault([US, { ...UK, device: 'mobile' }])).toEqual({
      country: 'GB',
      language: 'en'
    })
    expect(addedSearches(VIEW.pages, UK.id)).toEqual({ min: 18, max: 36, pages: 2 })
    expect(pagesText(VIEW.pages)).toBe('2 pages and 1 topic')
  })
})

describe('MarketsTable', () => {
  it('makes a market the default, also on its pages, with Undo', async () => {
    const source = fakeSource()
    const onChanged = vi.fn()
    render(
      <>
        <MarketsTable source={source} projectId="textbolt" onChanged={onChanged} />
        <UndoToastHost />
      </>
    )
    await screen.findByTestId('project-markets')
    await rowAction('🇬🇧 GB · EN', 'Make default…')
    const confirm = screen.getByTestId('pmk-confirm-default')
    expect(within(confirm).getByRole('checkbox').closest('label')?.textContent).toContain(
      'Also make it the default market on the 1 page checked in it'
    )
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Make default' }))
    })
    expect(source['projectSettings:setDefaultMarket']).toHaveBeenCalledWith({
      projectId: 'textbolt',
      marketId: UK.id,
      pages: 'tracking'
    })
    expect(onChanged).toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(source['pages:update']).toHaveBeenCalledWith({
      projectId: 'textbolt',
      pageId: 'alerts',
      defaultMarketId: US.id
    })
    expect(source['projectSettings:setDefaultMarket']).toHaveBeenLastCalledWith({
      projectId: 'textbolt',
      marketId: US.id,
      pages: 'none'
    })
  })

  it('removes a market after Confirm and Undo puts its links back', async () => {
    const source = fakeSource()
    render(
      <>
        <MarketsTable source={source} projectId="textbolt" onChanged={() => undefined} />
        <UndoToastHost />
      </>
    )
    await screen.findByTestId('project-markets')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for 🇺🇸 US · EN' }))
    const removeDefault = await screen.findByRole('menuitem', { name: /Remove/ })
    expect(
      removeDefault.getAttribute('aria-disabled') ??
        String((removeDefault as HTMLButtonElement).disabled)
    ).toBe('true')
    fireEvent.keyDown(removeDefault, { key: 'Escape' })

    await rowAction('🇬🇧 GB · EN', 'Remove…')
    const confirm = screen.getByTestId('pmk-confirm-remove')
    expect(confirm.textContent).toContain('1 page stop checking in this market. Its history stays.')
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove market' }))
    })
    expect(screen.getByText(/Removed 🇬🇧 GB · EN from 1 page/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(source['projectSettings:restoreMarket']).toHaveBeenCalledWith({
      projectId: 'textbolt',
      marketId: UK.id,
      links: [
        {
          pageId: 'alerts',
          addedAt: '2026-10-01T00:00:00.000Z',
          baselineRunId: 'run-1',
          lastCheckedAt: '2026-10-10T00:00:00.000Z',
          wasDefault: false
        }
      ]
    })
  })
})

describe('AddMarketDrawer', () => {
  it('starts untracked, marks tracked countries and adds to every page with Undo', async () => {
    const source = fakeSource()
    const onClose = vi.fn()
    render(
      <>
        <AddMarketDrawer source={source} projectId="textbolt" pageId={null} onClose={onClose} />
        <UndoToastHost />
      </>
    )
    const country = (await screen.findByLabelText('Country')) as HTMLSelectElement
    expect(country.value).toBe('CA')
    const labels = [...country.options].map((option) => option.textContent)
    expect(labels).toContain('🇺🇸 US · United States (tracked)')
    expect(labels).toContain('🇨🇦 CA · Canada')
    // 10 + 10 + 4×2 searches, up to twice that.
    expect(screen.getByTestId('add-market-cost').textContent).toContain('About 28–56 more searches')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add market' }))
    })
    expect(source['projectSettings:addMarket']).toHaveBeenCalledWith({
      projectId: 'textbolt',
      market: {
        country: 'CA',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false
      },
      pageIds: ['alerts', 'pricing', 'sms-topic']
    })
    expect(onClose).toHaveBeenCalledWith(CA.id)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(source['pages:update']).toHaveBeenCalledWith({
      projectId: 'textbolt',
      pageId: 'pricing',
      markets: [
        { country: 'US', language: 'en', location: null, device: 'desktop', localWording: false }
      ]
    })
  })

  it('opened from one page, picks it and says when it already has the market', async () => {
    const source = fakeSource()
    render(
      <AddMarketDrawer
        source={source}
        projectId="textbolt"
        pageId="pricing"
        onClose={() => undefined}
      />
    )
    const country = (await screen.findByLabelText('Country')) as HTMLSelectElement
    // The page has only US, so the form starts on GB, which the project tracks.
    expect(country.value).toBe('GB')
    expect(screen.getByTestId('add-market-existing').textContent).toContain(
      'already tracked on 1 page'
    )
    expect(screen.getByRole('checkbox', { name: /pricing/ })).toHaveProperty('checked', true)
    expect(screen.getByTestId('add-market-summary').textContent).toContain('Adds 1 page')
    fireEvent.change(country, { target: { value: 'US' } })
    await waitFor(() =>
      expect(screen.getByTestId('add-market-summary').textContent).toContain('already has')
    )
    expect((screen.getByRole('button', { name: 'Add market' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
