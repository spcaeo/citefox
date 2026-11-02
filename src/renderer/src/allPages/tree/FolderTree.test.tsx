// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiloSummary } from '@shared/domain'
import type { SitemapOverview, StructureView } from '@shared/ipc'
import { DrillHost } from '../../drill'
import type { StructureClient } from '../../structure/client'
import type { StructureState } from '../../structure/hooks/useStructure'
import { resetScreenViewMemory } from '../../ui/useScreenView'
import { AllPagesScreen } from '..'
import { DATA, fakeSource, PROJECT, row } from '../fixtures.test-helper'
import { FolderTree } from './FolderTree'

const AXE = { rules: { region: { enabled: false } } }

function silo(path: string, parentPath: string | null, depth: number): SiloSummary {
  return {
    path,
    parentPath,
    depth,
    pageCount: 3,
    trackedCount: 2,
    trackAll: false,
    marketIds: null,
    effectiveMarketIds: ['mkt-us']
  }
}

const SILOS = [silo('/', null, 0), silo('/blog/', '/', 1), silo('/blog/guides/', '/blog/', 2)]

const VIEW = {
  projectId: 'proj-1',
  markets: [],
  clusters: [],
  silos: SILOS,
  groups: [],
  insights: []
} as unknown as StructureView

const OVERVIEW = {
  projectId: 'proj-1',
  sitemaps: [
    {
      id: 'sm-post',
      url: 'https://textbolt.com/post-sitemap.xml',
      parentId: null,
      kind: 'urlset',
      source: 'robots',
      included: true,
      state: 'read',
      lastReadAt: '2026-10-19T09:00:00.000Z',
      lastChangedAt: '2026-10-19',
      pageCount: 4,
      error: null,
      lowValue: false
    }
  ],
  lastSync: null,
  rules: { frequency: 'manual', onNew: 'add_untracked', onRemoved: 'pause', onChanged: 'reread' },
  foundPageCount: 4,
  trackedPageCount: 2
} as unknown as SitemapOverview

const ROWS = [
  ...DATA.rows,
  row('setup', {
    url: 'https://textbolt.com/blog/guides/setup',
    title: 'Setup guide',
    status: 'not_tracked',
    pageCited: null,
    aioPrompts: null,
    citations: null
  })
]

function fakeStructureClient(): { client: StructureClient; setSilo: ReturnType<typeof vi.fn> } {
  const setSilo = vi.fn(async () => undefined)
  const client = {
    'sitemaps:get': vi.fn(async () => OVERVIEW),
    'structure:get': vi.fn(async () => VIEW),
    'sitemaps:syncFinished': vi.fn(() => () => undefined),
    'structure:setSilo': setSilo
  } as unknown as StructureClient
  return { client, setSilo }
}

function state(
  run = vi.fn(async (_label: string, call: () => Promise<unknown>) => call())
): StructureState {
  return {
    overview: OVERVIEW,
    view: VIEW,
    loadError: null,
    actionError: null,
    busy: null,
    markets: [
      { id: 'mkt-us', label: 'US · EN', market: null },
      { id: 'mkt-uk', label: 'UK · EN', market: null }
    ],
    reload: async () => undefined,
    run: run as StructureState['run'],
    clearError: () => undefined
  }
}

beforeEach(() => {
  window.location.hash = '#/pages?view=tree'
})

afterEach(() => {
  cleanup()
  resetScreenViewMemory()
  window.location.hash = ''
})

describe('Pages · Tree · Folders', () => {
  it('lists pages in their folders with totals that add up, and passes axe', async () => {
    const { client } = fakeStructureClient()
    const onOpenPage = vi.fn()
    const view = render(
      <DrillHost>
        <FolderTree
          rows={ROWS}
          domain="textbolt.com"
          client={client}
          projectId="proj-1"
          structure={state()}
          onOpenPage={onOpenPage}
          onCited={() => undefined}
        />
      </DrillHost>
    )
    const grid = view.getByRole('treegrid', { name: 'Folders' })
    // Folders start closed; Expand all shows every page (4 or fewer: no "Show more").
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(within(grid).getByText('Text alerts for business')).toBeTruthy()
    expect(within(grid).getByText('Setup guide')).toBeTruthy()
    expect(within(grid).getByRole('button', { name: '4 pages in /blog/' })).toBeTruthy()
    expect(within(grid).getByRole('button', { name: '1 page in /blog/guides/' })).toBeTruthy()
    expect(within(grid).getByRole('button', { name: '2 tracked pages in /blog/' })).toBeTruthy()
    expect(view.getByText('4 pages')).toBeTruthy()
    const results = await axe.run(view.container, AXE)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('a folder count opens exactly its pages', async () => {
    const { client } = fakeStructureClient()
    const view = render(
      <DrillHost>
        <FolderTree
          rows={ROWS}
          domain="textbolt.com"
          client={client}
          projectId="proj-1"
          structure={state()}
          onOpenPage={() => undefined}
          onCited={() => undefined}
        />
      </DrillHost>
    )
    fireEvent.click(view.getByRole('button', { name: '4 pages in /blog/' }))
    const dialog = await view.findByRole('dialog', { name: /Pages in \/blog\// })
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(4)
  })

  it('a folder row keeps Track all and the markets for new pages (the old Silos)', async () => {
    const { client, setSilo } = fakeStructureClient()
    const view = render(
      <DrillHost>
        <FolderTree
          rows={ROWS}
          domain="textbolt.com"
          client={client}
          projectId="proj-1"
          structure={state()}
          onOpenPage={() => undefined}
          onCited={() => undefined}
        />
      </DrillHost>
    )
    fireEvent.click(view.getByLabelText('Track every page in /blog/'))
    await waitFor(() =>
      expect(setSilo).toHaveBeenCalledWith({ projectId: 'proj-1', path: '/blog/', trackAll: true })
    )
    expect(
      view.getAllByText('Same as parent folder (US · EN)', { selector: '.apt-clip' })
    ).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: 'Actions for /blog/' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'New pages use all 2 markets' }))
    await waitFor(() =>
      expect(setSilo).toHaveBeenCalledWith({
        projectId: 'proj-1',
        path: '/blog/',
        marketIds: ['mkt-us', 'mkt-uk']
      })
    )
    fireEvent.click(view.getByRole('button', { name: 'Actions for /blog/' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Open in the list' }))
    await waitFor(() => expect(window.location.hash).toBe('#/pages?view=list&folder=%2Fblog%2F'))
    // Deeper folders have no list filter of their own.
    fireEvent.click(view.getByRole('button', { name: 'Actions for /blog/guides/' }))
    expect(view.queryByRole('menuitem', { name: 'Open in the list' })).toBeNull()
  })
})

describe('Pages · List and Tree', () => {
  it('the view switch is in the URL; Tree shows the folders, then the rest of Site structure', async () => {
    window.location.hash = '#/pages'
    const { client } = fakeStructureClient()
    const view = render(
      <AllPagesScreen
        source={fakeSource()}
        structureClient={client}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    const views = await view.findByRole('tablist', { name: 'Pages views' })
    expect(await view.findByRole('grid', { name: 'Pages' })).toBeTruthy()
    fireEvent.click(within(views).getByRole('tab', { name: /Tree/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/pages?view=tree'))
    // One row of tabs: Folders, Clusters and Groups are a Group ▾ choice; the rest a status line.
    expect(view.queryByRole('tablist', { name: 'Site structure' })).toBeNull()
    const group = await view.findByRole('combobox', { name: 'Group' })
    fireEvent.click(group)
    expect(
      within(view.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent?.replace(/ \(\d+\)$/, ''))
    ).toEqual(['Folders', 'Clusters', 'Groups'])
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(await view.findByRole('treegrid', { name: 'Folders' })).toBeTruthy()
    expect(view.queryByText(/Folders come from your page addresses/)).toBeNull()
    const status = view.getByLabelText('Site structure status')
    fireEvent.click(within(status).getByRole('link', { name: /sitemaps?$/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/pages?view=tree&part=sitemaps'))
  })

  it('an old preset link moves to ?preset= in place', async () => {
    window.location.hash = '#/pages?view=tracked'
    const { client } = fakeStructureClient()
    render(
      <AllPagesScreen
        source={fakeSource()}
        structureClient={client}
        project={PROJECT}
        params={{ view: 'tracked' }}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    await waitFor(() => expect(window.location.hash).toBe('#/pages?preset=tracked'))
  })
})
