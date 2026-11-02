// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClusterPageRow, ClusterSummary, GroupSummary } from '@shared/domain'
import type { GroupPageRow, StructureView } from '@shared/ipc'
import { DATA, row } from '../../allPages/fixtures.test-helper'
import { DrawerTrailContext, type RouteCrumb } from '../../shell/drawerCrumbs'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, resetDrawersForTests, useDrawerStack } from '../../shell/drawers'
import { ClusterDrawer } from './ClusterDrawer'
import type { PagesDrawerClient } from './client'
import { GroupDrawer } from './GroupDrawer'
import { MovePagesDrawer } from './MovePagesDrawer'
import { PickPagesDrawer } from './PickPagesDrawer'
import { RenamePageDrawer } from './RenamePageDrawer'
import { parsePickFor } from './pickFor'

const ROUTE: RouteCrumb[] = [
  { label: 'TextBolt', href: '#/overview' },
  { label: 'Site structure', href: '#/structure', screen: true }
]

const CLUSTER: ClusterSummary = {
  id: 'cl-email',
  name: 'Email to SMS',
  madeBy: 'rules',
  editedByUser: false,
  pillarPageId: 'alerts',
  pillarTitle: 'Text alerts for business',
  pillarUrl: 'https://textbolt.com/blog/alerts/',
  pageCount: 2,
  trackedCount: 1,
  averageScore: 40,
  scoreChange: null,
  weakestMarket: null,
  themes: ['send texts from email'],
  themePrompts: [
    {
      theme: 'send texts from email',
      prompts: [
        {
          pageId: 'alerts',
          promptId: 'pr-1',
          position: 1,
          label: 'how to send texts from email',
          pageLabel: 'Text alerts for business'
        }
      ]
    }
  ],
  trackWhole: false
}
const OTHER: ClusterSummary = {
  ...CLUSTER,
  id: 'cl-10dlc',
  name: '10DLC',
  pageCount: 0,
  trackedCount: 0,
  themes: [],
  themePrompts: []
}
const GROUP: GroupSummary = {
  id: 'g-1',
  name: 'Money pages',
  note: null,
  pageCount: 1,
  trackedCount: 1,
  averageScore: 40,
  createdAt: '2026-10-19T09:00:00.000Z'
}
const CLUSTER_PAGES: ClusterPageRow[] = [
  {
    pageId: 'alerts',
    url: 'https://textbolt.com/blog/alerts/',
    title: 'Text alerts for business',
    role: 'pillar',
    movedByUser: false,
    status: 'tracked',
    score: 40
  },
  {
    pageId: 'optin',
    url: 'https://textbolt.com/blog/optin/',
    title: 'SMS opt-in rules',
    role: 'supporting',
    movedByUser: true,
    status: 'not_tracked',
    score: null
  }
]

function view(groups: readonly GroupSummary[] = [GROUP]): StructureView {
  return {
    projectId: 'proj-1',
    clusters: [CLUSTER, OTHER],
    silos: [],
    groups,
    insights: [],
    canUndoClusters: false,
    lastClusteredAt: null,
    lastClusterMethod: null,
    availableMethods: ['topic'],
    foundPageCount: 3,
    trackedPageCount: 2,
    markets: DATA.markets
  }
}

/** Every page drawer channel; `calls` records what each was sent. */
function fakeClient(options: { groupPages?: GroupPageRow[]; pages?: typeof DATA.rows } = {}): {
  client: PagesDrawerClient
  calls: Record<string, unknown[]>
} {
  const calls: Record<string, unknown[]> = {}
  const record = (channel: string, arg: unknown): void => {
    calls[channel] = [...(calls[channel] ?? []), arg]
  }
  const rows = options.pages ?? [
    row('alerts', {
      title: 'Text alerts for business',
      clusters: [{ id: 'cl-email', name: 'Email to SMS' }],
      groups: [{ id: 'g-1', name: 'Money pages' }]
    }),
    row('pricing', { title: 'Bulk SMS pricing', folder: 'pricing' }),
    row('optin', {
      title: 'SMS opt-in rules',
      status: 'not_tracked',
      clusters: [{ id: 'cl-email', name: 'Email to SMS' }]
    })
  ]
  const client = {
    'structure:get': vi.fn(async () => view()),
    'structure:clusterPages': vi.fn(async (arg: { clusterId: string }) => ({
      clusterId: arg.clusterId,
      pages: CLUSTER_PAGES
    })),
    'structure:groupPages': vi.fn(async (arg: { groupId: string }) => ({
      groupId: arg.groupId,
      pages: options.groupPages ?? [
        {
          pageId: 'alerts',
          url: 'https://textbolt.com/blog/alerts/',
          title: 'Text alerts for business',
          status: 'tracked',
          score: 40
        }
      ]
    })),
    'structure:movePages': async (arg: unknown) => {
      record('structure:movePages', arg)
      return view()
    },
    'structure:createCluster': async (arg: { pageIds: readonly string[] }) => {
      record('structure:createCluster', arg)
      return { view: view(), clusterId: 'cl-new', movedCount: arg.pageIds.length }
    },
    'structure:splitCluster': async (arg: { pageIds: readonly string[] }) => {
      record('structure:splitCluster', arg)
      return { view: view(), clusterId: 'cl-new', movedCount: arg.pageIds.length }
    },
    'structure:deleteCluster': async (arg: unknown) => {
      record('structure:deleteCluster', arg)
      return view()
    },
    'structure:setPageRole': async (arg: unknown) => {
      record('structure:setPageRole', arg)
      return view()
    },
    'structure:setGroupPages': async (arg: { add: readonly string[] }) => {
      record('structure:setGroupPages', arg)
      return { ...GROUP, pageCount: GROUP.pageCount + arg.add.length }
    },
    'structure:createGroup': async (arg: { name: string }) => {
      record('structure:createGroup', arg)
      return { ...GROUP, id: 'g-new', name: arg.name, pageCount: 0 }
    },
    'structure:deleteGroup': async (arg: unknown) => {
      record('structure:deleteGroup', arg)
      return view([])
    },
    'structure:trackCluster': async (arg: unknown) => {
      record('structure:trackCluster', arg)
      return { view: view(), trackedCount: 1 }
    },
    'structure:suggestLinks': async (arg: { clusterId: string }) => ({
      clusterId: arg.clusterId,
      links: []
    }),
    'import:track': async (arg: { pageIds: readonly string[] }) => {
      record('import:track', arg)
      return {
        trackedCount: arg.pageIds.length,
        addedCount: 0,
        skippedCount: 0,
        firstCheckFrom: null,
        firstCheckUntil: null
      }
    },
    'allpages:list': async () => ({ ...DATA, rows }),
    'topics:list': async () => ({ projectId: 'proj-1', topics: [] }),
    'grid:listViews': async () => ({ views: [] }),
    'grid:exportCsv': async (arg: { rows: readonly unknown[] }) => {
      record('grid:exportCsv', arg)
      return { ok: true, rowCount: arg.rows.length, fileName: 'money-pages-pages.csv' }
    },
    'pages:get': async (arg: { pageId: string }) => ({
      id: arg.pageId,
      label: null,
      title: 'Bulk SMS pricing',
      url: 'https://textbolt.com/pricing/'
    }),
    'pages:update': async (arg: unknown) => {
      record('pages:update', arg)
      return {}
    }
  } as unknown as PagesDrawerClient
  return { client, calls }
}

const DRAWERS = {
  cluster: ClusterDrawer,
  group: GroupDrawer,
  'pick-pages': PickPagesDrawer,
  'move-pages': MovePagesDrawer,
  'rename-page': RenamePageDrawer
} as const

/** The shell's DrawerHost, for the page drawers only, with a fake client. */
function Host({ client }: { client: PagesDrawerClient }): JSX.Element {
  const { stack } = useDrawerStack()
  return (
    <DrawerTrailContext.Provider value={ROUTE}>
      {stack.map((entry, depth) => {
        const Component = DRAWERS[entry.id as keyof typeof DRAWERS]
        return Component ? (
          <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
            <Component context={{ entry, depth, projectId: 'proj-1' }} client={client} />
          </DrawerLevel>
        ) : null
      })}
    </DrawerTrailContext.Provider>
  )
}

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)))
}

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

function crumbs(dialog: HTMLElement): string[] {
  const nav = within(dialog).getByRole('navigation', { name: 'Drawer breadcrumb' })
  return within(nav)
    .getAllByRole('listitem')
    .map((item) => (item.textContent ?? '').replace('›', '').trim())
}

async function openIn(
  client: PagesDrawerClient,
  id: keyof typeof DRAWERS,
  values: Record<string, string>
): Promise<HTMLElement> {
  render(<Host client={client} />)
  act(() => openDrawer(id, values))
  await settle()
  return screen.findByRole('dialog')
}

beforeEach(async () => {
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  window.location.hash = '#/structure/clusters'
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

describe('pick.for', () => {
  it('reads group, cluster, pillar and new cluster targets', () => {
    expect(parsePickFor('group:g-1')).toEqual({ kind: 'group', id: 'g-1' })
    expect(parsePickFor('cluster:cl-email')).toEqual({ kind: 'cluster', id: 'cl-email' })
    expect(parsePickFor('pillar:cl-email')).toEqual({ kind: 'pillar', id: 'cl-email' })
    expect(parsePickFor('cluster:new')).toEqual({ kind: 'new-cluster' })
    expect(parsePickFor('nope')).toBeNull()
    expect(parsePickFor('topic:t1')).toBeNull()
  })
})

describe('ClusterDrawer', { timeout: 20_000 }, () => {
  it('shows the pages with the trail, the counts and the Themes tab on the URL', async () => {
    const { client } = fakeClient()
    const dialog = await openIn(client, 'cluster', { 'cluster.id': 'cl-email' })
    await within(dialog).findByRole('grid', { name: 'Pages in Email to SMS' })
    expect(crumbs(dialog)).toEqual(['TextBolt', 'Site structure', 'Clusters'])
    expect(dialog.textContent).toContain('2 pages · 1 tracked')
    fireEvent.click(within(dialog).getByRole('tab', { name: /Themes/ }))
    expect(hashParams().get('cluster.tab')).toBe('themes')
    expect(await within(dialog).findByText(/how to send texts from email/)).toBeTruthy()
  })

  it('bulk: picked rows live on the URL; Move to new cluster opens a split over it', async () => {
    const { client } = fakeClient()
    const dialog = await openIn(client, 'cluster', { 'cluster.id': 'cl-email' })
    const grid = await within(dialog).findByRole('grid', { name: 'Pages in Email to SMS' })
    fireEvent.click(within(grid).getByRole('checkbox', { name: /SMS opt-in rules/ }))
    expect(hashParams().get('cluster.pick')).toBe('optin')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to new cluster' }))
    await settle()
    const params = hashParams()
    expect(params.getAll('drawer')).toEqual(['cluster', 'move-pages'])
    expect(params.get('move.ids')).toBe('optin')
    expect(params.get('move.pick')).toBe('new')
    expect(params.get('move.from')).toBe('cl-email')
  })

  it('tracks the untracked picked pages and the whole cluster', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'cluster', { 'cluster.id': 'cl-email' })
    const grid = await within(dialog).findByRole('grid', { name: 'Pages in Email to SMS' })
    fireEvent.click(within(grid).getByRole('checkbox', { name: /SMS opt-in rules/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Track 1 page' }))
    await waitFor(() => expect(calls['import:track']?.[0]).toMatchObject({ pageIds: ['optin'] }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Track cluster' }))
    await waitFor(() =>
      expect(calls['structure:trackCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email',
        track: true
      })
    )
  })

  it('Delete cluster asks first, then deletes and closes', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'cluster', { 'cluster.id': 'cl-email' })
    await within(dialog).findByRole('grid', { name: 'Pages in Email to SMS' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete cluster' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm.textContent).toContain('become unclustered')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete cluster' }))
    await waitFor(() =>
      expect(calls['structure:deleteCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email'
      })
    )
    await settle()
    expect(hashParams().get('drawer')).toBeNull()
  })

  it('an unknown cluster says it is not available', async () => {
    const { client } = fakeClient()
    const dialog = await openIn(client, 'cluster', { 'cluster.id': 'cl-gone' })
    expect(await within(dialog).findByText(/isn’t available any more/)).toBeTruthy()
  })
})

describe('GroupDrawer', { timeout: 20_000 }, () => {
  it('lists the pages; bulk Remove from group and Export; Add pages stacks the picker', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'group', { 'group.id': 'g-1' })
    const grid = await within(dialog).findByRole('grid', { name: 'Pages in Money pages' })
    expect(crumbs(dialog)).toEqual(['TextBolt', 'Site structure', 'Groups'])
    fireEvent.click(within(grid).getByRole('checkbox', { name: /Text alerts for business/ }))
    expect(hashParams().get('group.pick')).toBe('alerts')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(calls['grid:exportCsv']).toHaveLength(1))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from group' }))
    await waitFor(() =>
      expect(calls['structure:setGroupPages']?.[0]).toEqual({
        projectId: 'proj-1',
        groupId: 'g-1',
        add: [],
        remove: ['alerts']
      })
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add pages' }))
    await settle()
    expect(hashParams().getAll('drawer')).toEqual(['group', 'pick-pages'])
    expect(hashParams().get('pick.for')).toBe('group:g-1')
    // The stacked picker names the group under it in its trail.
    const picker = await screen.findByRole('dialog', { name: 'Add pages to Money pages' })
    await waitFor(() =>
      expect(crumbs(picker)).toEqual(['TextBolt', 'Site structure', 'Money pages'])
    )
  })

  it('an empty group says so and offers Add pages', async () => {
    const { client } = fakeClient({ groupPages: [] })
    const dialog = await openIn(client, 'group', { 'group.id': 'g-1' })
    expect(await within(dialog).findByText('No pages yet')).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: 'Add pages' }).length).toBe(2)
  })

  it('bulk Check now opens the check drawer with the picked pages', async () => {
    const { client } = fakeClient()
    const dialog = await openIn(client, 'group', { 'group.id': 'g-1' })
    const grid = await within(dialog).findByRole('grid', { name: 'Pages in Money pages' })
    fireEvent.click(within(grid).getByRole('checkbox', { name: /Text alerts for business/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check now' }))
    await settle()
    expect(hashParams().get('check.scope')).toBe('pages')
    expect(hashParams().get('check.ids')).toBe('alerts')
  })
})

describe('PickPagesDrawer', { timeout: 20_000 }, () => {
  it('adds picked pages to a group; pages already in it cannot be picked', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'pick-pages', { 'pick.for': 'group:g-1' })
    const already = await within(dialog).findByRole('checkbox', { name: /Text alerts/ })
    expect(already).toHaveProperty('disabled', true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bulk SMS pricing/ }))
    expect(hashParams().get('pick.ids')).toBe('pricing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 page' }))
    await waitFor(() =>
      expect(calls['structure:setGroupPages']?.[0]).toEqual({
        projectId: 'proj-1',
        groupId: 'g-1',
        add: ['pricing'],
        remove: []
      })
    )
  })

  it('search and folder filter live on the URL', async () => {
    const { client } = fakeClient()
    const dialog = await openIn(client, 'pick-pages', { 'pick.for': 'group:g-1' })
    const search = await within(dialog).findByRole('searchbox')
    fireEvent.change(search, { target: { value: 'pricing' } })
    expect(hashParams().get('pick.q')).toBe('pricing')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Folder' }), {
      target: { value: 'pricing' }
    })
    expect(hashParams().get('pick.folder')).toBe('pricing')
  })

  it('New cluster: a name and pages make the cluster', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'pick-pages', { 'pick.for': 'cluster:new' })
    fireEvent.change(await within(dialog).findByLabelText(/Cluster name/), {
      target: { value: 'Pricing pages' }
    })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bulk SMS pricing/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create cluster with 1 page' }))
    await waitFor(() =>
      expect(calls['structure:createCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        name: 'Pricing pages',
        pageIds: ['pricing']
      })
    )
  })

  it('Set pillar picks one page of the cluster', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'pick-pages', { 'pick.for': 'pillar:cl-email' })
    const radios = await within(dialog).findAllByRole('radio')
    expect(radios).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('radio', { name: /SMS opt-in rules/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set as pillar' }))
    await waitFor(() =>
      expect(calls['structure:setPageRole']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email',
        pageId: 'optin',
        role: 'pillar'
      })
    )
  })

  it('picks all 2,014 pages at once', async () => {
    const pages = Array.from({ length: 2014 }, (_, index) =>
      row(`p${index}`, { title: `Page ${index}` })
    )
    const { client } = fakeClient({ pages })
    const dialog = await openIn(client, 'pick-pages', { 'pick.for': 'cluster:cl-10dlc' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Pick all 2,014' }))
    expect(within(dialog).getByRole('button', { name: 'Move 2,014 pages here' })).toBeTruthy()
  })
})

describe('MovePagesDrawer', { timeout: 20_000 }, () => {
  it('moves pages to a cluster picked from the searchable list', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'move-pages', {
      'move.ids': 'pricing',
      'move.to': 'cluster'
    })
    fireEvent.click(await within(dialog).findByRole('radio', { name: /10DLC/ }))
    expect(hashParams().get('move.pick')).toBe('cl-10dlc')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move 1 page' }))
    await waitFor(() =>
      expect(calls['structure:movePages']?.[0]).toEqual({
        projectId: 'proj-1',
        pageIds: ['pricing'],
        clusterId: 'cl-10dlc'
      })
    )
  })

  it('New group makes the group and adds the pages', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'move-pages', {
      'move.ids': 'alerts,pricing',
      'move.to': 'group',
      'move.pick': 'new'
    })
    fireEvent.change(await within(dialog).findByLabelText(/New group name/), {
      target: { value: 'Launch' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'New group with these 2 pages' }))
    await waitFor(() =>
      expect(calls['structure:setGroupPages']?.[0]).toEqual({
        projectId: 'proj-1',
        groupId: 'g-new',
        add: ['alerts', 'pricing'],
        remove: []
      })
    )
    expect(calls['structure:createGroup']?.[0]).toEqual({
      projectId: 'proj-1',
      name: 'Launch',
      note: null
    })
  })

  it('a split from a cluster makes a new cluster from its pages', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'move-pages', {
      'move.ids': 'optin',
      'move.to': 'cluster',
      'move.pick': 'new',
      'move.from': 'cl-email'
    })
    expect(within(dialog).queryByRole('radiogroup', { name: 'Move to' })).toBeNull()
    fireEvent.change(await within(dialog).findByLabelText(/New cluster name/), {
      target: { value: 'Opt-in' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create cluster with 1 page' }))
    await waitFor(() =>
      expect(calls['structure:splitCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email',
        name: 'Opt-in',
        pageIds: ['optin']
      })
    )
  })
})

describe('RenamePageDrawer', { timeout: 20_000 }, () => {
  it('saves the new label', async () => {
    const { client, calls } = fakeClient()
    const dialog = await openIn(client, 'rename-page', { 'rename.id': 'pricing' })
    const input = await within(dialog).findByRole('textbox')
    fireEvent.change(input, { target: { value: 'Pricing' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))
    await waitFor(() =>
      expect(calls['pages:update']?.[0]).toEqual({
        projectId: 'proj-1',
        pageId: 'pricing',
        label: 'Pricing'
      })
    )
  })
})
