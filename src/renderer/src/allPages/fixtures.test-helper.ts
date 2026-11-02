import { vi } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  AllPageRow,
  AllPagesData,
  BulkActionRequest,
  CitationReview,
  ProjectDetail
} from '@shared/ipc'
import { textboltResults } from '../m3/fixtures'
import type { AllPagesSource } from './source'

/** Shared fixtures for the All pages tests. Not production code. */
export const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

export function row(id: string, overrides: Partial<AllPageRow> = {}): AllPageRow {
  return {
    id,
    url: `https://textbolt.com/blog/${id}/`,
    title: `Page ${id}`,
    label: null,
    folder: 'blog',
    status: 'tracked',
    setupStep: 'check',
    pinned: false,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    marketIds: ['mkt-us'],
    score: 40,
    change: 2,
    pageCited: 3,
    aioPrompts: 8,
    citations: 3,
    lastCheckedAt: '2026-10-19T12:00:00.000Z',
    nextCheckAt: '2026-11-02T08:00:00.000Z',
    clusters: null,
    groups: null,
    ...overrides
  }
}

export const DATA: AllPagesData = {
  projectId: 'proj-1',
  domain: 'textbolt.com',
  foundPageCount: 3,
  trackedPageCount: 2,
  markets: [US],
  defaultMarketId: 'mkt-us',
  summary: {
    projectId: 'proj-1',
    averageScore: 40,
    change: 2,
    nextCheckAt: null,
    searchesUsed: 1240,
    searchCap: 5000,
    pagesDueToday: 14
  },
  searchesLeft: 3760,
  groups: null,
  rows: [
    row('alerts', { title: 'Text alerts for business', pinned: true }),
    row('pricing', { title: 'Bulk SMS pricing', score: 31, change: -4 }),
    row('optin', {
      title: 'SMS opt-in rules',
      status: 'not_tracked',
      setupStep: 'read',
      score: null,
      change: null,
      pageCited: null,
      aioPrompts: null,
      citations: null,
      marketIds: []
    })
  ]
}

export const REVIEW: CitationReview = {
  wrongPage: [
    {
      id: 'alerts|mkt-us|p1',
      pageId: 'alerts',
      pageUrl: 'https://textbolt.com/blog/alerts/',
      pageLabel: 'Text alerts for business',
      marketId: 'mkt-us',
      promptId: 'p1',
      promptLabel: 'Crew alerts',
      promptText: 'How do I alert the crew?',
      citedUrl: 'https://textbolt.com/pricing/',
      citedPageId: 'pricing',
      citedPageReady: true,
      position: 2,
      runId: 'run-1',
      checkedAt: '2026-10-19T12:00:00.000Z'
    }
  ],
  wrongPagePages: 1,
  untracked: [
    {
      url: 'https://textbolt.com/login/',
      normalizedUrl: 'textbolt.com/login',
      pageId: null,
      citations: 2,
      citedFor: 1,
      noise: 'login',
      ignored: false,
      refs: [
        {
          pageId: 'alerts',
          pageLabel: 'Text alerts for business',
          marketId: 'mkt-us',
          promptId: 'p1',
          promptLabel: 'Crew alerts',
          promptPosition: 1,
          position: 3,
          runId: 'run-1'
        },
        {
          pageId: 'alerts',
          pageLabel: 'Text alerts for business',
          marketId: 'mkt-us',
          promptId: 'p2',
          promptLabel: 'Shift reminders',
          promptPosition: 2,
          position: 5,
          runId: 'run-1'
        }
      ]
    }
  ]
}

export const PROJECT = {
  id: 'proj-1',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  status: 'active'
} as unknown as ProjectDetail

export function fakeSource(): AllPagesSource & { runs: BulkActionRequest[] } {
  const runs: BulkActionRequest[] = []
  return {
    runs,
    list: vi.fn(async () => DATA),
    citations: vi.fn(async () => REVIEW),
    estimate: vi.fn(async (request: BulkActionRequest) => ({
      action: request.action,
      selected: request.pageIds.length,
      eligible: request.pageIds.length,
      skipped: [],
      minSearches: 20,
      maxSearches: 40,
      timing: 'now' as const,
      searchesLeft: 3760,
      summary: `Checking ${request.pageIds.length} pages now uses about 20–40 searches (3,760 left this month).`
    })),
    run: vi.fn(async (request: BulkActionRequest) => {
      runs.push(request)
      return {
        action: request.action,
        changed: request.pageIds.length,
        skipped: 0,
        message: request.action === 'stop' ? 'Stopped tracking 2 pages.' : 'Checking now.',
        jobId: 'job-1',
        ...(request.action === 'stop'
          ? {
              previous: request.pageIds.map((pageId) => ({
                pageId,
                previousStatus: 'tracked' as const
              }))
            }
          : {})
      }
    }),
    updatePage: vi.fn(async () => ({})),
    removePage: vi.fn(async () => ({})),
    setPageRole: vi.fn(async () => ({})),
    pointHere: vi.fn(async () => ({
      ok: true as const,
      message: '“Crew alerts” now belongs to Bulk SMS pricing from its next check.',
      undo: {
        fromPageId: 'alerts',
        toPageId: 'pricing',
        fromPromptSetId: 'pset-1',
        toPromptSetId: 'pset-2'
      }
    })),
    undoPoint: vi.fn(async (request) => request),
    merge: vi.fn(async () => ({ fixId: 'fix-1', fixNumber: 1, message: 'Fix #1 added.' })),
    undoMerge: vi.fn(async (request) => ({ fixId: request.fixId })),
    trackUrl: vi.fn(async () => ({ pageId: 'p-new', message: 'Tracked.', previousStatus: null })),
    undoTrack: vi.fn(async (request) => ({ pageId: request.pageId })),
    ignoreUrl: vi.fn(async (request) => ({ normalizedUrl: request.url, ignored: request.ignored })),
    results: vi.fn(async () => textboltResults()),
    due: vi.fn(async () => ({
      day: '2026-10-20',
      pages: [
        {
          projectId: 'proj-1',
          pageId: 'alerts',
          label: null,
          title: 'Text alerts for business',
          url: 'https://textbolt.com/blog/alerts/',
          marketIds: ['mkt-us'],
          dueAt: '2026-10-20T08:00:00.000Z',
          intervalDays: 14 as const,
          reason: 'scheduled' as const,
          promptIds: null
        },
        {
          projectId: 'proj-1',
          pageId: 'alerts',
          label: null,
          title: 'Text alerts for business',
          url: 'https://textbolt.com/blog/alerts/',
          marketIds: ['mkt-uk'],
          dueAt: '2026-10-20T08:00:00.000Z',
          intervalDays: 14 as const,
          reason: 'scheduled' as const,
          promptIds: null
        },
        {
          projectId: 'proj-1',
          pageId: 'pricing',
          label: null,
          title: 'Bulk SMS pricing',
          url: 'https://textbolt.com/blog/pricing/',
          marketIds: ['mkt-us'],
          dueAt: '2026-10-20T09:00:00.000Z',
          intervalDays: 14 as const,
          reason: 'follow_up' as const,
          promptIds: ['p1']
        }
      ]
    })),
    clusters: vi.fn(async () => ({ clusters: [], totalClusters: 0 })),
    views: () => null,
    exportCsv: null
  }
}
