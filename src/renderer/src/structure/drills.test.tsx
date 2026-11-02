// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClusterPageRow,
  ClusterSummary,
  GroupSummary,
  Market,
  SitemapSyncReport
} from '@shared/domain'
import type {
  GroupPageRow,
  ImportCandidate,
  ImportCandidateList,
  ProjectDetail,
  SitemapOverview,
  StructureView
} from '@shared/ipc'
import { drawerHref } from '../shell/drawers'
import { pageHash, pagesHash, promptHash, structureHash } from '../shell/routes'
import type { StructureClient } from './client'
import { StructureScreen } from './harness.test-helper'
import { findStructureToolbar, openPart, partShown } from './parts.test-helper'

/**
 * NFR-14 for Site structure: every number opens the shared drill drawer, and
 * the drawer's total equals the number clicked.
 */

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

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
  foundPageCount: 2,
  trackedPageCount: 1
}

const P1 = 'https://textbolt.com/blog/text-alerts/'
const P3 = 'https://textbolt.com/blog/email-to-sms/'

const CLUSTER: ClusterSummary = {
  id: 'cl-email',
  name: 'Email to SMS',
  madeBy: 'rules',
  editedByUser: false,
  pillarPageId: 'p-1',
  pillarTitle: 'Text alerts for business',
  pillarUrl: P1,
  pageCount: 2,
  trackedCount: 1,
  averageScore: 50,
  scoreChange: null,
  weakestMarket: null,
  themes: ['send texts from email'],
  themePrompts: [
    {
      theme: 'send texts from email',
      prompts: [
        {
          pageId: 'p-1',
          promptId: 'pr-1',
          position: 1,
          label: 'how to send texts from email',
          pageLabel: 'Text alerts for business'
        },
        {
          pageId: 'p-3',
          promptId: 'pr-7',
          position: 7,
          label: 'send texts from email free',
          pageLabel: 'Email to SMS'
        }
      ]
    }
  ],
  trackWhole: false
}

const CLUSTER_PAGES: ClusterPageRow[] = [
  {
    pageId: 'p-1',
    url: P1,
    title: 'Text alerts for business',
    role: 'pillar',
    movedByUser: false,
    status: 'tracked',
    score: 50
  },
  {
    pageId: 'p-3',
    url: P3,
    title: 'Email to SMS',
    role: 'supporting',
    movedByUser: false,
    status: 'not_tracked',
    score: null
  }
]

const GROUP: GroupSummary = {
  id: 'g-1',
  name: 'Money pages',
  note: null,
  pageCount: 1,
  trackedCount: 1,
  averageScore: 50,
  createdAt: '2026-10-19T09:00:00.000Z'
}

const GROUP_PAGES: GroupPageRow[] = [
  { pageId: 'p-1', url: P1, title: 'Text alerts for business', status: 'tracked', score: 50 }
]

function candidate(
  patch: Partial<ImportCandidate> & { pageId: string; url: string }
): ImportCandidate {
  return {
    path: new URL(patch.url).pathname,
    title: null,
    folder: '/blog/',
    clusterId: 'cl-email',
    clusterName: 'Email to SMS',
    lastmod: null,
    internalLinks: null,
    moneyPage: false,
    alreadyTracked: false,
    status: 'not_tracked',
    needsSetup: true,
    sitemapIds: ['sm-post'],
    siloPath: '/blog/',
    ...patch
  }
}

const CANDIDATES: ImportCandidateList = {
  projectId: 'proj-1',
  rows: [
    candidate({
      pageId: 'p-1',
      url: P1,
      title: 'Text alerts for business',
      alreadyTracked: true,
      status: 'tracked',
      needsSetup: false
    }),
    candidate({ pageId: 'p-3', url: P3, title: 'Email to SMS' })
  ],
  folders: [{ folder: '/blog/', pageCount: 2, trackedCount: 1 }],
  clusters: [{ id: 'cl-email', name: 'Email to SMS', pageCount: 2 }],
  hasLinkData: false,
  sitemapCount: 1,
  skippedSitemaps: [],
  trackedCount: 1,
  markets: [US]
}

const REPORT: SitemapSyncReport = {
  id: 'sync-1',
  trigger: 'manual',
  startedAt: '2026-10-19T09:00:00.000Z',
  finishedAt: '2026-10-19T09:00:05.000Z',
  status: 'ok',
  sitemapsRead: 1,
  sitemapsFailed: 0,
  pageCount: 2,
  otherDomainCount: 0,
  newCount: 3,
  removedCount: 0,
  changedCount: 0,
  newPages: [
    {
      pageId: 'p-3',
      url: P3,
      sitemapUrl: 'https://textbolt.com/post-sitemap.xml',
      lastmod: null,
      wasTracked: false,
      action: 'added_untracked',
      clusterName: 'Email to SMS'
    }
  ],
  removedPages: [],
  changedPages: [],
  problems: [],
  nextStep: null
}

const OVERVIEW: SitemapOverview = {
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
      lastChangedAt: null,
      pageCount: 1,
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
      lastChangedAt: null,
      pageCount: 2,
      error: null,
      lowValue: false
    }
  ],
  rules: { frequency: 'manual', onNew: 'add_untracked', onRemoved: 'pause', onChanged: 'reread' },
  foundPageCount: 2,
  trackedPageCount: 1,
  lastSync: REPORT,
  nextSyncAt: null,
  syncing: false
}

const VIEW: StructureView = {
  projectId: 'proj-1',
  markets: [US],
  clusters: [CLUSTER],
  silos: [
    {
      path: '/',
      parentPath: null,
      depth: 0,
      pageCount: 2,
      trackedCount: 1,
      trackAll: false,
      marketIds: null,
      effectiveMarketIds: ['mkt-us']
    },
    {
      path: '/blog/',
      parentPath: '/',
      depth: 1,
      pageCount: 2,
      trackedCount: 1,
      trackAll: false,
      marketIds: null,
      effectiveMarketIds: ['mkt-us']
    }
  ],
  groups: [GROUP],
  insights: [
    {
      id: 'ins-1',
      kind: 'orphan',
      title: 'Three pages have no cluster links',
      body: 'Link them from their pillar.',
      pageIds: ['p-1', 'p-3', 'p-9'],
      pageCount: 3,
      pages: [{ id: 'p-1', label: 'Text alerts for business' }],
      clusterId: null
    }
  ],
  canUndoClusters: false,
  lastClusteredAt: null,
  lastClusterMethod: null,
  availableMethods: ['topic'],
  foundPageCount: 2,
  trackedPageCount: 1
}

function fakeClient(): StructureClient {
  return {
    'sitemaps:get': vi.fn(async () => OVERVIEW),
    'structure:get': vi.fn(async () => VIEW),
    'sitemaps:syncFinished': () => () => undefined,
    'import:candidates': vi.fn(async () => CANDIDATES),
    'structure:clusterPages': vi.fn(async () => ({ clusterId: 'cl-email', pages: CLUSTER_PAGES })),
    'structure:groupPages': vi.fn(async () => ({ groupId: 'g-1', pages: GROUP_PAGES })),
    'structure:suggestLinks': vi.fn(async () => ({ clusterId: 'cl-email', links: [] }))
  } as unknown as StructureClient
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing')
  return value
}

/** Opens a count, then checks the drawer total and row count equal it. */
async function openAndCount(button: HTMLElement): Promise<HTMLElement> {
  expect(button.tagName).toBe('BUTTON')
  const id = required(button.getAttribute('data-nfr-drill'))
  const figure = Number(
    required(button.querySelector(`[data-nfr-figure="${id}"]`)).textContent?.replace(/,/g, '')
  )
  button.focus()
  fireEvent.click(button)
  const dialog = await screen.findByRole('dialog')
  // The rows can arrive a moment after the drawer opens; wait for them instead of
  // reading once (a loaded full run caught the drawer between the two).
  await waitFor(() => {
    const heading = within(dialog).getByRole('heading', { level: 2 })
    expect(heading.textContent).toMatch(new RegExp(`· ${figure} [a-z]+$`))
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(figure)
  })
  return dialog
}

function closeWithEscape(dialog: HTMLElement, opener: HTMLElement): void {
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
}

/** Opens Site structure on Clusters, or on the part or cluster or group id an old link names. */
async function renderScreen(focusId = 'clusters'): Promise<void> {
  window.location.hash = structureHash(focusId)
  render(<StructureScreen client={fakeClient()} project={PROJECT} />)
  await findStructureToolbar()
}

/** The drawer keys in the current hash. */
function drawerParams(): Record<string, string> {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  const out: Record<string, string> = {}
  new URLSearchParams(at < 0 ? '' : hash.slice(at + 1)).forEach((value, key) => {
    if (key === 'drawer' || key.includes('.')) out[key] = value
  })
  return out
}

async function openTab(label: string): Promise<void> {
  openPart(label)
  // The part is in the URL: the screen follows the hash change.
  await waitFor(() => expect(partShown(label)).toBe(true))
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => cleanup())

describe('Site structure drill-downs (NFR-14)', { timeout: 20_000 }, () => {
  it('cluster card counts open their pages, Escape closes and focus returns', async () => {
    await renderScreen()
    const pages = screen.getByRole('button', { name: '2 pages in Email to SMS' })
    let dialog = await openAndCount(pages)
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toContain(
      'Pages in Email to SMS'
    )
    closeWithEscape(dialog, pages)

    const tracked = screen.getByRole('button', { name: '1 tracked page in Email to SMS' })
    dialog = await openAndCount(tracked)
    const row = required(dialog.querySelector<HTMLElement>('[data-drill-row="0"]'))
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(window.location.hash).toBe(pageHash('p-1'))
  })

  it('the average score opens the page scores behind it, each to Progress', async () => {
    await renderScreen()
    fireEvent.click(
      screen.getByRole('button', { name: 'Average score 50: page scores in Email to SMS' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(1)
    fireEvent.click(required(dialog.querySelector<HTMLElement>('[data-drill-row="0"]')))
    expect(window.location.hash).toBe(pageHash('p-1', 'progress'))
  })

  it('a theme tag shows and opens the questions behind it', async () => {
    await renderScreen()
    const theme = screen.getByRole('button', {
      name: 'send texts from email 2 questions in Email to SMS'
    })
    const dialog = await openAndCount(theme)
    fireEvent.click(required(dialog.querySelector<HTMLElement>('[data-drill-row="1"]')))
    expect(window.location.hash).toBe(promptHash('p-3', 'pr-7'))
  })

  it('the pillar links to its page; table numbers drill; Show pages opens the cluster drawer', async () => {
    await renderScreen()
    const table = screen.getByRole('grid', { name: 'Clusters' })
    expect(
      within(table).getByRole('link', { name: 'Text alerts for business' }).getAttribute('href')
    ).toBe(pageHash('p-1'))
    fireEvent.click(within(table).getByRole('button', { name: 'Show pages of Email to SMS' }))
    expect(drawerParams()).toEqual({ drawer: 'cluster', 'cluster.id': 'cl-email' })
    window.location.hash = structureHash('clusters')
    const pages = within(table).getByRole('button', { name: '2 pages in Email to SMS' })
    const dialog = await openAndCount(pages)
    closeWithEscape(dialog, pages)
  })

  it('group numbers drill and Show pages opens the group drawer', async () => {
    await renderScreen()
    await openTab('Groups')
    fireEvent.click(screen.getByRole('button', { name: 'Show pages of Money pages' }))
    expect(drawerParams()).toEqual({ drawer: 'group', 'group.id': 'g-1' })
    await openAndCount(screen.getByRole('button', { name: '1 page in Money pages' }))
  })

  it('an old group link opens the group drawer on Groups', async () => {
    await renderScreen('g-1')
    await waitFor(() =>
      expect(window.location.hash).toBe(
        drawerHref('group', { 'group.id': 'g-1' }, structureHash('groups'))
      )
    )
  })

  it('an old cluster link opens the cluster drawer on Clusters', async () => {
    await renderScreen('cl-email')
    await waitFor(() =>
      expect(window.location.hash).toBe(
        drawerHref('cluster', { 'cluster.id': 'cl-email' }, structureHash('clusters'))
      )
    )
  })

  it('an insight lists every page it counts', async () => {
    await renderScreen()
    await openTab('CiteFox AI noticed')
    const all = screen.getByRole('button', {
      name: 'All 3 pages: Three pages have no cluster links'
    })
    await openAndCount(all)
  })

  it('sitemap counts open the sitemaps and pages they list', async () => {
    await renderScreen()
    await openTab('Sitemaps')
    const index = screen.getByRole('button', { name: 'sitemap_index.xml lists 1 sitemap' })
    const dialog = await openAndCount(index)
    closeWithEscape(dialog, index)
    fireEvent.click(screen.getByRole('button', { name: '2 URLs in post-sitemap.xml' }))
    const pages = await screen.findByRole('dialog')
    expect(pages.querySelectorAll('[data-drill-row]')).toHaveLength(2)
    expect((await axe.run(document.body, RULES)).violations).toEqual([])
  })

  it('sync report paths, cluster tags and the "more" line link on', async () => {
    await renderScreen()
    await openTab('Last sync')
    const report = screen.getByRole('region', { name: /Sync report/ })
    // The path has copy and open; the row itself opens the page in CiteFox.
    expect(
      within(report)
        .getByRole('link', { name: 'Open /blog/email-to-sms/ in a new tab' })
        .getAttribute('href')
    ).toMatch(/^https:\/\/.+\/blog\/email-to-sms\/$/)
    fireEvent.click(within(report).getByText('/blog/email-to-sms/'))
    expect(window.location.hash).toBe(pageHash('p-3'))
    expect(
      within(report)
        .getByRole('link', { name: 'Cluster: Email to SMS. Show its pages' })
        .getAttribute('href')
    ).toBe(structureHash('cl-email'))
    expect(
      within(report)
        .getByRole('link', { name: /And 2 more in All pages/ })
        .getAttribute('href')
    ).toBe(pagesHash({ view: 'untracked' }))
  })
})
