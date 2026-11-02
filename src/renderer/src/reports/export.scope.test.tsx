// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import type { ExportRequest, ProjectDetail } from '@shared/ipc'
import type { ScopeSource } from '../scope'
import type { ReportsClient } from './client'
import { ExportScreen } from './export'
import { createMockReportsClient } from './mockClient'
import { createMockSchedulesClient } from './schedulesMock'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const MARKET: Market = {
  id: 'us-en',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function row(id: string, title: string, groups: string[]): unknown {
  return {
    id,
    url: `https://harbor.example/${id}`,
    path: `/${id}`,
    title,
    label: title,
    folder: null,
    status: 'tracked',
    groups: groups.map((group) => ({ id: group, name: group })),
    clusters: [],
    marketIds: ['us-en'],
    promptCount: 4,
    samples: 1,
    nextCheckAt: null,
    score: null,
    pageCited: null,
    aioPrompts: null
  }
}

const scopeSource: ScopeSource = {
  'allpages:list': () =>
    Promise.resolve({
      domain: 'harbor.example',
      rows: [
        row('pricing', 'Pricing', ['g-money']),
        row('demo', 'Book a demo', ['g-money']),
        row('blog', 'Blog', [])
      ],
      markets: [MARKET],
      defaultMarketId: 'us-en',
      searchesLeft: null
    } as never),
  'structure:get': () =>
    Promise.resolve({
      groups: [{ id: 'g-money', name: 'Money pages', pageCount: 2 }],
      clusters: []
    } as never),
  'topics:list': () => Promise.resolve({ topics: [] } as never),
  'grid:listViews': () => Promise.resolve({ views: [] } as never)
}

const HARBOR = {
  id: 'harbor',
  name: 'Harbor',
  slug: 'harbor',
  domain: 'harbor.example',
  dbPath: 'projects/harbor.sqlite',
  clientName: null,
  status: 'active',
  includeSubdomains: false,
  brandNames: ['Harbor'],
  competitors: [],
  defaultMarket: MARKET,
  foundPageCount: 3,
  trackedPageCount: 3
} satisfies ProjectDetail

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

function renderExport(requests: ExportRequest[]): ReturnType<typeof within> {
  const view = render(
    <ExportScreen
      client={recording(requests)}
      project={{ id: 'harbor', name: 'Harbor', defaultMarket: MARKET }}
      pages={[
        { id: 'pricing', label: 'Pricing' },
        { id: 'demo', label: 'Book a demo' }
      ]}
      readPage={() => Promise.resolve({ markets: [MARKET] })}
      schedulesClient={createMockSchedulesClient()}
      projects={[HARBOR]}
      scopeSource={scopeSource}
    />
  )
  return within(view.container)
}

describe('Export scope', () => {
  it('exports a group as its pages and keeps the pick on the URL', async () => {
    const requests: ExportRequest[] = []
    const body = renderExport(requests)
    fireEvent.click(await body.findByRole('radio', { name: /A group/ }))
    fireEvent.click(body.getByRole('checkbox', { name: /Money pages/ }))
    expect(window.location.hash).toContain('scope=group')
    expect(window.location.hash).toContain('ids=g-money')
    await waitFor(() =>
      expect(body.getByTestId('xpt-scope-count').textContent).toBe('2 pages in this export.')
    )
    const save = body.getByRole('button', { name: 'Save HTML report' })
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.scope).toBe('selected')
    expect(requests[0]?.pageIds).toEqual(['pricing', 'demo'])
  })

  it('starts from the URL, so a copied link opens the same export', async () => {
    window.location.hash = '#/export?scope=pages&ids=blog&fmt=pdf'
    const requests: ExportRequest[] = []
    const body = renderExport(requests)
    expect(
      ((await body.findByRole('radio', { name: /Pages I pick/ })) as HTMLInputElement).checked
    ).toBe(true)
    expect((body.getByRole('radio', { name: /PDF/ }) as HTMLInputElement).checked).toBe(true)
    await waitFor(() =>
      expect(body.getByTestId('xpt-scope-count').textContent).toBe('1 page in this export.')
    )
  })

  it('opens Schedule this with the same scope in the schedule drawer', async () => {
    const body = renderExport([])
    fireEvent.click(await body.findByRole('radio', { name: /A group/ }))
    fireEvent.click(body.getByRole('checkbox', { name: /Money pages/ }))
    // Schedule this sits under the header's ⋯; the menu opens once the scope is ready.
    const more = body.getByRole('button', { name: 'More actions' })
    await waitFor(() => {
      if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more)
      expect(
        body.getByRole('menuitem', { name: 'Schedule this' }).hasAttribute('aria-disabled')
      ).toBe(false)
    })
    fireEvent.click(body.getByRole('menuitem', { name: 'Schedule this' }))
    const dialog = await body.findByRole('dialog', { name: 'New schedule' })
    expect(window.location.hash).toContain('schedule.scope=group')
    expect(window.location.hash).toContain('schedule.ids=g-money')
    const form = within(dialog)
    expect((form.getByLabelText('Project') as HTMLSelectElement).value).toBe('harbor')
    expect(
      ((await form.findByRole('radio', { name: /A group/ })) as HTMLInputElement).checked
    ).toBe(true)
  })
})
