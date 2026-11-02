// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClusterSummary,
  GroupSummary,
  Market,
  SitemapSyncReport,
  SitemapSyncRules
} from '@shared/domain'
import type {
  ProjectDetail,
  SitemapOverview,
  SitemapSyncFinished,
  StructureView
} from '@shared/ipc'
import { structureHash } from '../shell/routes'
import type { StructureClient } from './client'
import { StructureScreen } from './harness.test-helper'
import { findStructureToolbar, openPart, partShown, statusLink } from './parts.test-helper'

beforeEach(() => {
  window.location.hash = structureHash('clusters')
})

afterEach(() => {
  cleanup()
})

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

const UK: Market = { ...US, id: 'mkt-uk', country: 'GB' }

const PROJECT: ProjectDetail = {
  id: 'proj-1',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: 'projects/textbolt.sqlite',
  clientName: null,
  status: 'active',
  includeSubdomains: false,
  brandNames: ['TextBolt'],
  competitors: [],
  defaultMarket: US,
  foundPageCount: 2014,
  trackedPageCount: 3
}

const REPORT: SitemapSyncReport = {
  id: 'sync-1',
  trigger: 'manual',
  startedAt: '2026-10-19T09:00:00.000Z',
  finishedAt: '2026-10-19T09:00:05.000Z',
  status: 'ok',
  sitemapsRead: 2,
  sitemapsFailed: 0,
  pageCount: 2014,
  otherDomainCount: 0,
  newCount: 2,
  removedCount: 1,
  changedCount: 3,
  newPages: [
    {
      pageId: 'p-new-1',
      url: 'https://textbolt.com/blog/verizon-vtext-com-shutdown/',
      sitemapUrl: 'https://textbolt.com/post-sitemap.xml',
      lastmod: '2026-10-18',
      wasTracked: false,
      action: 'added_untracked',
      clusterName: 'Email to SMS'
    },
    {
      pageId: 'p-new-2',
      url: 'https://textbolt.com/blog/grafana-sms-alerts/',
      sitemapUrl: 'https://textbolt.com/post-sitemap.xml',
      lastmod: '2026-10-18',
      wasTracked: false,
      action: 'added_untracked',
      clusterName: null
    }
  ],
  removedPages: [
    {
      pageId: 'p-old',
      url: 'https://textbolt.com/blog/carrier-list-2024/',
      sitemapUrl: 'https://textbolt.com/post-sitemap.xml',
      lastmod: null,
      wasTracked: true,
      action: 'paused',
      clusterName: null
    }
  ],
  changedPages: [
    {
      pageId: 'p-1',
      url: 'https://textbolt.com/blog/10dlc-registration-guide/',
      sitemapUrl: 'https://textbolt.com/post-sitemap.xml',
      lastmod: '2026-10-19',
      wasTracked: true,
      action: 'reread_queued',
      clusterName: null
    }
  ],
  problems: [],
  nextStep: null
}

function overview(rules: SitemapSyncRules): SitemapOverview {
  return {
    projectId: 'proj-1',
    sitemaps: [
      {
        id: 'sm-index',
        url: 'https://textbolt.com/sitemap_index.xml',
        parentId: null,
        kind: 'index',
        source: 'robots',
        included: true,
        state: 'read',
        lastReadAt: '2026-10-19T09:00:00.000Z',
        lastChangedAt: '2026-10-19',
        pageCount: 2,
        error: null,
        lowValue: false
      },
      {
        id: 'sm-post',
        url: 'https://textbolt.com/post-sitemap.xml',
        parentId: 'sm-index',
        kind: 'urlset',
        source: 'index',
        included: true,
        state: 'read',
        lastReadAt: '2026-10-19T09:00:00.000Z',
        lastChangedAt: '2026-10-19',
        pageCount: 2014,
        error: null,
        lowValue: false
      },
      {
        id: 'sm-tag',
        url: 'https://textbolt.com/tag-sitemap.xml',
        parentId: 'sm-index',
        kind: 'urlset',
        source: 'index',
        included: false,
        state: 'read',
        lastReadAt: '2026-10-19T09:00:00.000Z',
        lastChangedAt: '2026-10-14',
        pageCount: 312,
        error: null,
        lowValue: true
      }
    ],
    rules,
    foundPageCount: 2014,
    trackedPageCount: 3,
    lastSync: REPORT,
    nextSyncAt: null,
    syncing: false
  }
}

const CLUSTERS: ClusterSummary[] = [
  {
    id: 'cl-email',
    name: 'Email to SMS',
    madeBy: 'rules',
    editedByUser: false,
    pillarPageId: 'p-1',
    pillarTitle: 'How to Set Up Text Alerts for Business',
    pillarUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    pageCount: 34,
    trackedCount: 2,
    averageScore: 46,
    scoreChange: 4,
    weakestMarket: null,
    themes: ['send texts from email'],
    trackWhole: false
  },
  {
    id: 'cl-10dlc',
    name: '10DLC & compliance',
    madeBy: 'claude',
    editedByUser: true,
    pillarPageId: null,
    pillarTitle: null,
    pillarUrl: null,
    pageCount: 22,
    trackedCount: 0,
    averageScore: null,
    scoreChange: null,
    weakestMarket: null,
    themes: [],
    trackWhole: false
  }
]

const GROUP: GroupSummary = {
  id: 'g-1',
  name: 'Money pages',
  note: null,
  pageCount: 0,
  trackedCount: 0,
  averageScore: null,
  createdAt: '2026-10-19T09:00:00.000Z'
}

function structureView(groups: GroupSummary[]): StructureView {
  return {
    projectId: 'proj-1',
    markets: [US, UK],
    clusters: CLUSTERS,
    silos: [
      {
        path: '/',
        parentPath: null,
        depth: 0,
        pageCount: 2014,
        trackedCount: 3,
        trackAll: false,
        marketIds: null,
        effectiveMarketIds: ['mkt-us']
      },
      {
        path: '/blog/',
        parentPath: '/',
        depth: 1,
        pageCount: 1420,
        trackedCount: 2,
        trackAll: false,
        marketIds: null,
        effectiveMarketIds: ['mkt-us']
      }
    ],
    groups,
    insights: [
      {
        id: 'ins-1',
        kind: 'cannibalization',
        title: 'Two pages answer the same question',
        body: 'Both pages were cited for “send texts from email”.',
        pageIds: ['p-1', 'p-2'],
        pageCount: 2,
        pages: [
          { id: 'p-1', label: 'Email to SMS: how it works' },
          { id: 'p-2', label: 'How to Set Up Text Alerts for Business' }
        ],
        clusterId: 'cl-email'
      }
    ],
    canUndoClusters: false,
    lastClusteredAt: null,
    lastClusterMethod: null,
    availableMethods: ['topic', 'queries'],
    foundPageCount: 2014,
    trackedPageCount: 3
  }
}

function fakeClient(): {
  client: StructureClient
  calls: Record<string, unknown[]>
  push: (event: SitemapSyncFinished) => void
} {
  let rules: SitemapSyncRules = {
    frequency: 'manual',
    onNew: 'add_untracked',
    onRemoved: 'pause',
    onChanged: 'reread'
  }
  let groups: GroupSummary[] = []
  const calls: Record<string, unknown[]> = {}
  const listeners: Array<(event: SitemapSyncFinished) => void> = []
  const record = (channel: string, arg: unknown): void => {
    calls[channel] = [...(calls[channel] ?? []), arg]
  }
  const unused = (channel: string) => (arg: unknown) => {
    record(channel, arg)
    return Promise.reject(new Error(`unexpected ${channel}`))
  }
  const client = {
    'sitemaps:get': vi.fn(async () => overview(rules)),
    'structure:get': vi.fn(async () => structureView(groups)),
    'projects:get': vi.fn(async () => PROJECT),
    'status:getCapsule': unused('status:getCapsule'),
    'sitemaps:syncFinished': (listener: (event: SitemapSyncFinished) => void) => {
      listeners.push(listener)
      return () => undefined
    },
    'sitemaps:discover': unused('sitemaps:discover'),
    'sitemaps:add': async (arg: unknown) => {
      record('sitemaps:add', arg)
      return overview(rules)
    },
    'sitemaps:remove': unused('sitemaps:remove'),
    'sitemaps:setIncluded': async (arg: unknown) => {
      record('sitemaps:setIncluded', arg)
      return overview(rules)
    },
    'sitemaps:setRules': async (arg: { rules: SitemapSyncRules }) => {
      record('sitemaps:setRules', arg)
      rules = arg.rules
      return overview(rules)
    },
    'sitemaps:sync': async (arg: unknown) => {
      record('sitemaps:sync', arg)
      return REPORT
    },
    'import:candidates': unused('import:candidates'),
    'import:parseUrls': unused('import:parseUrls'),
    'import:estimate': unused('import:estimate'),
    'import:claudePick': unused('import:claudePick'),
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
    'structure:clusterPages': async (arg: { clusterId: string }) => {
      record('structure:clusterPages', arg)
      return {
        clusterId: arg.clusterId,
        pages: [
          {
            pageId: 'p-1',
            url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
            title: 'How to Set Up Text Alerts for Business',
            role: 'pillar' as const,
            movedByUser: false,
            status: 'tracked' as const,
            score: 50
          },
          {
            pageId: 'p-3',
            url: 'https://textbolt.com/blog/email-to-sms/',
            title: 'Email to SMS: how it works',
            role: 'supporting' as const,
            movedByUser: true,
            status: 'not_tracked' as const,
            score: null
          }
        ]
      }
    },
    'structure:recluster': async (arg: unknown) => {
      record('structure:recluster', arg)
      return { view: structureView(groups), previousCount: 1, changes: ['New cluster "10DLC".'] }
    },
    'structure:undoClusters': unused('structure:undoClusters'),
    'structure:renameCluster': async (arg: unknown) => {
      record('structure:renameCluster', arg)
      return structureView(groups)
    },
    'structure:mergeClusters': unused('structure:mergeClusters'),
    'structure:deleteCluster': async (arg: unknown) => {
      record('structure:deleteCluster', arg)
      return { ...structureView(groups), canUndoClusters: true }
    },
    'structure:movePage': async (arg: unknown) => {
      record('structure:movePage', arg)
      return structureView(groups)
    },
    'structure:setPageRole': unused('structure:setPageRole'),
    'structure:trackCluster': async (arg: unknown) => {
      record('structure:trackCluster', arg)
      return { view: structureView(groups), trackedCount: 32 }
    },
    'structure:setSilo': async (arg: unknown) => {
      record('structure:setSilo', arg)
      return { view: structureView(groups), trackedCount: 0 }
    },
    'structure:createGroup': async (arg: { name: string }) => {
      record('structure:createGroup', arg)
      groups = [{ ...GROUP, name: arg.name }]
      return groups[0] ?? GROUP
    },
    'structure:renameGroup': unused('structure:renameGroup'),
    'structure:deleteGroup': unused('structure:deleteGroup'),
    'structure:setGroupPages': unused('structure:setGroupPages'),
    'structure:groupPages': async () => ({ groupId: 'g-1', pages: [] }),
    'structure:listMemberships': unused('structure:listMemberships'),
    'structure:clusterSummary': unused('structure:clusterSummary'),
    'structure:suggestLinks': async (arg: { clusterId: string }) => ({
      clusterId: arg.clusterId,
      links: [
        {
          fromPageId: 'p-3',
          fromUrl: 'https://textbolt.com/blog/email-to-sms/',
          toPageId: 'p-1',
          toUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
          anchor: 'text alerts for business',
          where: 'First paragraph'
        }
      ]
    })
  } as unknown as StructureClient
  return {
    client,
    calls,
    push: (event) => {
      for (const listener of listeners) listener(event)
    }
  }
}

/** The query of the current hash (`#/pages?view=tree&part=clusters&drawer=…`). */
function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

/** Opens a tab of the screen by its label (the count follows the label). */
async function openTab(label: string): Promise<void> {
  openPart(label)
  // The part is in the URL: the screen follows the hash change.
  await waitFor(() => expect(partShown(label)).toBe(true))
}

/** Opens a row's `⋯` menu and picks an item. */
function pickRowAction(row: string, item: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${row}` }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

const AXE = { rules: { region: { enabled: false } } }

describe('StructureScreen', () => {
  it('shows clusters, sitemaps, sync rules, the report and flags, and passes axe', async () => {
    const { client } = fakeClient()
    const view = render(<StructureScreen client={client} project={PROJECT} />)
    expect(await screen.findByRole('button', { name: 'Show pages of Email to SMS' })).toBeTruthy()
    expect(partShown('Clusters')).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toContain('Clusters')
    expect(
      (await axe.run(view.container, AXE)).violations.map((v) => [v.id, v.nodes.map((n) => n.html)])
    ).toEqual([])
    await openTab('Sitemaps')
    expect(screen.getByRole('region', { name: 'Sitemaps' })).toBeTruthy()
    expect(screen.getByText('Usually low-value')).toBeTruthy()
    expect(screen.getByLabelText('The sitemap index is always read')).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.getByRole('heading', { name: 'Sync rules' })).toBeTruthy()
    expect(
      (await axe.run(view.container, AXE)).violations.map((v) => [v.id, v.nodes.map((n) => n.html)])
    ).toEqual([])
    await openTab('Last sync')
    expect(screen.getByRole('region', { name: /Sync report/ })).toBeTruthy()
    expect(screen.getByText('Tracking paused · history kept')).toBeTruthy()
    expect(
      (await axe.run(view.container, AXE)).violations.map((v) => [v.id, v.nodes.map((n) => n.html)])
    ).toEqual([])
    await openTab('CiteFox AI noticed')
    expect(screen.getByRole('heading', { name: 'CiteFox AI noticed' })).toBeTruthy()
  })

  it('starts on the folders even with no sitemaps; Sitemaps says none yet', async () => {
    window.location.hash = structureHash()
    const { client } = fakeClient()
    const rules: SitemapSyncRules = {
      frequency: 'manual',
      onNew: 'add_untracked',
      onRemoved: 'pause',
      onChanged: 'reread'
    }
    vi.mocked(client['sitemaps:get']).mockImplementation(async () => ({
      ...overview(rules),
      sitemaps: [],
      lastSync: null
    }))
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    expect(partShown('Folders')).toBe(true)
    await openTab('Sitemaps')
    expect(await screen.findByRole('heading', { name: 'No sitemaps yet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Find sitemaps' })).toBeTruthy()
    // Group ▾ picks no grouping here, so Folders goes back to the tree.
    await openTab('Folders')
  })

  it('saves sync rules, syncs, includes sitemaps and reloads on a finished sync', async () => {
    const { client, calls, push } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await openTab('Sitemaps')
    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }))
    await waitFor(() => expect(calls['sitemaps:setRules']).toHaveLength(1))
    expect(calls['sitemaps:setRules']?.[0]).toMatchObject({ rules: { frequency: 'weekly' } })
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Weekly' })).toHaveProperty('checked', true)
    )
    fireEvent.click(screen.getByLabelText('Include tag-sitemap.xml'))
    await waitFor(() =>
      expect(calls['sitemaps:setIncluded']?.[0]).toEqual({
        projectId: 'proj-1',
        sitemapId: 'sm-tag',
        included: true
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(calls['sitemaps:sync']).toHaveLength(1))
    // A finished sync opens its report.
    await waitFor(() => expect(partShown('Last sync')).toBe(true))
    const before = vi.mocked(client['sitemaps:get']).mock.calls.length
    push({ projectId: 'proj-1', report: REPORT })
    await waitFor(() =>
      expect(vi.mocked(client['sitemaps:get']).mock.calls.length).toBeGreaterThan(before)
    )
  })

  it('tracks new pages from the sync report with the project default market', async () => {
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await openTab('Last sync')
    fireEvent.click(screen.getByRole('button', { name: /Track all 2/ }))
    await waitFor(() => expect(calls['import:track']).toHaveLength(1))
    expect(calls['import:track']?.[0]).toMatchObject({
      pageIds: ['p-new-1', 'p-new-2'],
      urls: [],
      markets: [],
      intervalDays: 30,
      stagger: true
    })
    expect(await screen.findAllByText(/Tracked · 🇺🇸 US · EN/)).toHaveLength(2)
  })

  it('tracks one new page from its row menu', async () => {
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await openTab('Last sync')
    pickRowAction('/blog/grafana-sms-alerts/', /^Track ·/)
    await waitFor(() => expect(calls['import:track']?.[0]).toMatchObject({ pageIds: ['p-new-2'] }))
  })

  it('re-clusters by rules and opens a cluster in its drawer', async () => {
    window.location.hash = structureHash('clusters')
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    expect(await screen.findByRole('radio', { name: /Internal links/ })).toHaveProperty(
      'disabled',
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Group by rules (no AI)' }))
    await waitFor(() =>
      expect(calls['structure:recluster']?.[0]).toEqual({
        projectId: 'proj-1',
        method: 'topic',
        useClaude: false,
        instruction: null
      })
    )
    expect(await screen.findByText('New cluster "10DLC".')).toBeTruthy()
    // Rule-based, not Claude: a plain button, out of any AI menu.
    expect(screen.queryByRole('button', { name: 'AI actions for Email to SMS' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show pages of Email to SMS' }))
    const params = hashParams()
    expect(params.get('drawer')).toBe('cluster')
    expect(params.get('cluster.id')).toBe('cl-email')
  })

  it('New cluster opens the page picker; Set pillar and Add pages pick from the cluster', async () => {
    window.location.hash = structureHash('clusters')
    const { client } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New cluster' }))
    expect(hashParams().get('drawer')).toBe('pick-pages')
    expect(hashParams().get('pick.for')).toBe('cluster:new')
    window.location.hash = structureHash('clusters')
    pickRowAction('Email to SMS', /^Add pages/)
    expect(hashParams().get('pick.for')).toBe('cluster:cl-email')
    window.location.hash = structureHash('clusters')
    pickRowAction('Email to SMS', /pillar/)
    expect(hashParams().get('pick.for')).toBe('pillar:cl-email')
  })

  it('deletes a cluster after asking, and offers Undo', async () => {
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await screen.findByRole('button', { name: 'Show pages of Email to SMS' })
    pickRowAction('Email to SMS', 'Delete cluster')
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm.textContent).toContain('become unclustered')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete cluster' }))
    await waitFor(() =>
      expect(calls['structure:deleteCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email'
      })
    )
    expect(await screen.findByText(/Its pages are unclustered now/)).toBeTruthy()
  })

  it('auto-clusters with CiteFox AI from the AI menu, with the instruction', async () => {
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    fireEvent.change(await screen.findByLabelText(/Tell CiteFox AI what to change/), {
      target: { value: 'Keep 10DLC apart' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI actions for clusters' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Auto-cluster with CiteFox AI/ }))
    await waitFor(() =>
      expect(calls['structure:recluster']?.[0]).toEqual({
        projectId: 'proj-1',
        method: 'topic',
        useClaude: true,
        instruction: 'Keep 10DLC apart'
      })
    )
  })

  it('renames and tracks a cluster from its row menu', async () => {
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await screen.findByRole('button', { name: 'Show pages of Email to SMS' })
    pickRowAction('Email to SMS', 'Track cluster')
    await waitFor(() =>
      expect(calls['structure:trackCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email',
        track: true
      })
    )
    pickRowAction('Email to SMS', 'Rename')
    const input = screen.getByLabelText('New name for Email to SMS')
    fireEvent.change(input, { target: { value: 'Email-to-SMS gateways' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(calls['structure:renameCluster']?.[0]).toEqual({
        projectId: 'proj-1',
        clusterId: 'cl-email',
        name: 'Email-to-SMS gateways'
      })
    )
  })

  it('filters clusters by who made them', async () => {
    const { client } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await screen.findByRole('button', { name: 'Show pages of Email to SMS' })
    const makers = screen.getByRole('group', { name: 'Made by' })
    fireEvent.click(within(makers).getByRole('button', { name: /^CiteFox AI/ }))
    expect(screen.queryByRole('button', { name: 'Show pages of Email to SMS' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show pages of 10DLC & compliance' })).toBeTruthy()
  })

  it('creates a group', async () => {
    const { client, calls } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await openTab('Groups')
    expect(screen.getByText(/CiteFox AI never changes them/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'New group' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Money pages' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() =>
      expect(calls['structure:createGroup']?.[0]).toEqual({
        projectId: 'proj-1',
        name: 'Money pages',
        note: null
      })
    )
    expect(await screen.findByRole('button', { name: 'Show pages of Money pages' })).toBeTruthy()
  })

  it('records a choice on a cannibalization flag', async () => {
    const { client } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await openTab('CiteFox AI noticed')
    fireEvent.click(screen.getByRole('button', { name: 'Differentiate them' }))
    expect(screen.getByText(/Noted. Add it as a fix/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open content gaps' }).getAttribute('href')).toBe(
      '#/pages/p-1/gaps'
    )
  })

  it('keeps the part in the URL and opens the part a link names', async () => {
    const { client } = fakeClient()
    const first = render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await openTab('Groups')
    expect(window.location.hash).toBe('#/pages?view=tree&part=groups')
    first.unmount()
    window.location.hash = structureHash('sync')
    render(<StructureScreen client={client} project={PROJECT} />)
    await findStructureToolbar()
    await waitFor(() => expect(partShown('Last sync')).toBe(true))
    expect(statusLink('Last sync').getAttribute('aria-current')).toBe('page')
    expect(statusLink('Sitemaps').getAttribute('href')).toBe('#/pages?view=tree&part=sitemaps')
  })

  it('an old cluster link opens its drawer over Clusters', async () => {
    window.location.hash = structureHash('cl-email')
    const { client } = fakeClient()
    render(<StructureScreen client={client} project={PROJECT} />)
    await waitFor(() => expect(hashParams().get('drawer')).toBe('cluster'))
    expect(hashParams().get('cluster.id')).toBe('cl-email')
    expect(hashParams().get('part')).toBe('clusters')
  })

  it('shows a failed load with a way to try again', async () => {
    const { client } = fakeClient()
    vi.mocked(client['sitemaps:get']).mockRejectedValueOnce(new Error('Request failed'))
    render(<StructureScreen client={client} project={PROJECT} />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('CiteFox could not load the site structure.')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await findStructureToolbar()).toBeTruthy()
  })
})
