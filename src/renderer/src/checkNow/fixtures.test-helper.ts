import { vi } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  AllPagesData,
  CheckJob,
  NotCitedRequest,
  PageDetail,
  SetupProgress
} from '@shared/ipc'
import type { ScopeOptions, ScopePage } from '../scope'
import type { CheckNowSource } from './source'

export const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
export const UK: Market = { ...US, id: 'mkt-uk', country: 'GB' }

/** 2026-10-20 12:00 UTC: pages a and d are due, b is due on Nov 2. */
export const NOW = new Date('2026-10-20T12:00:00.000Z')

export function scopePage(id: string, overrides: Partial<ScopePage> = {}): ScopePage {
  return {
    id,
    url: `https://textbolt.com/blog/${id}/`,
    label: `Page ${id}`,
    folder: 'blog',
    status: 'tracked',
    tracked: true,
    groupIds: [],
    clusterIds: [],
    marketIds: ['mkt-us'],
    promptCount: 4,
    samples: 1,
    nextCheckAt: '2026-10-20T00:00:00.000Z',
    score: 40,
    pageCited: 1,
    aioPrompts: 3,
    ...overrides
  }
}

export const OPTIONS: ScopeOptions = {
  projectId: 'p1',
  domain: 'textbolt.com',
  pages: [
    scopePage('a', { groupIds: ['g1'], clusterIds: ['c1'], marketIds: ['mkt-us', 'mkt-uk'] }),
    scopePage('b', { groupIds: ['g1'], nextCheckAt: '2026-11-02T09:00:00.000Z' }),
    scopePage('c', {
      status: 'not_tracked',
      tracked: false,
      nextCheckAt: null,
      clusterIds: ['c1']
    }),
    scopePage('d', { status: 'paused', clusterIds: ['c2'], nextCheckAt: null })
  ],
  groups: [{ id: 'g1', name: 'Money pages', kind: 'group', count: 2 }],
  clusters: [
    { id: 'c1', name: 'Email', kind: 'cluster', count: 2 },
    { id: 'c2', name: 'Reminders', kind: 'cluster', count: 1 }
  ],
  topics: [{ id: 't1', name: '10DLC', kind: 'topic', count: 0, questions: 6 }],
  views: [],
  markets: [US, UK],
  defaultMarketId: 'mkt-us',
  searchesLeft: 500
}

/** `allpages:list` rows for {@link OPTIONS}' pages. */
function allPagesData(options: ScopeOptions): AllPagesData {
  return {
    domain: options.domain,
    markets: options.markets,
    defaultMarketId: options.defaultMarketId,
    searchesLeft: options.searchesLeft,
    rows: options.pages.map((page) => ({
      id: page.id,
      url: page.url,
      label: page.label,
      title: null,
      folder: page.folder,
      status: page.status,
      groups: page.groupIds.map((id) => ({ id, name: id })),
      clusters: page.clusterIds.map((id) => ({ id, name: id })),
      marketIds: page.marketIds,
      promptCount: page.promptCount,
      samples: page.samples,
      nextCheckAt: page.nextCheckAt,
      score: page.score,
      pageCited: page.pageCited,
      aioPrompts: page.aioPrompts
    }))
  } as unknown as AllPagesData
}

export function job(overrides: Partial<CheckJob> = {}): CheckJob {
  return {
    id: 'job-1',
    projectId: 'p1',
    pageIds: ['a'],
    marketIds: null,
    promptIds: null,
    status: 'finished',
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    done: 1,
    total: 1,
    searchesUsed: 2,
    searchesMax: 4,
    brandSearchesMax: 0,
    monthUsed: null,
    monthLimit: null,
    runIds: [],
    markets: [],
    steps: [],
    message: null,
    nextStep: null,
    ...overrides
  }
}

export interface FakeSource extends CheckNowSource {
  progress: (event: SetupProgress) => void
}

/** A Check now source over {@link OPTIONS}; every channel is a spy. */
export function fakeSource(
  options: ScopeOptions = OPTIONS,
  notCited: Readonly<Record<string, readonly string[]>> = { a: ['q2'], b: [] }
): FakeSource {
  const listeners = new Set<(event: SetupProgress) => void>()
  const source = {
    'allpages:list': vi.fn(async () => allPagesData(options)),
    'structure:get': vi.fn(async () => ({
      groups: options.groups.map((group) => ({
        id: group.id,
        name: group.name,
        pageCount: group.count
      })),
      clusters: options.clusters.map((cluster) => ({
        id: cluster.id,
        name: cluster.name,
        pageCount: cluster.count
      }))
    })),
    'topics:list': vi.fn(async () => ({
      topics: options.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        status: 'tracked',
        questions: topic.questions ?? 0,
        keywords: 0
      }))
    })),
    'grid:listViews': vi.fn(async () => ({ views: [] })),
    'checks:start': vi.fn(async () => job()),
    'checks:notCited': vi.fn(async (request: NotCitedRequest) => ({
      pages: request.pageIds.map((pageId) => {
        const promptIds = notCited[pageId] ?? []
        // Missed in the asked markets, else in the US only (cited in the UK).
        const markets = promptIds.length > 0 ? (request.marketIds ?? ['mkt-us']) : []
        return {
          pageId,
          promptIds,
          markets: markets.map((marketId) => ({ marketId, promptIds })),
          checked: pageId in notCited
        }
      })
    })),
    'prompts:list': vi.fn(async ({ pageId }: { pageId: string }) => ({
      pageId,
      prompts: [
        {
          id: 'q1',
          position: 1,
          label: 'Alerts',
          enabled: true,
          variants: [{ marketId: 'mkt-us', language: 'en', text: 'How do I alert the crew?' }]
        },
        {
          id: 'q2',
          position: 2,
          label: 'Plans',
          enabled: true,
          variants: [
            { marketId: 'mkt-us', language: 'en', text: 'Which plan has scheduled texts?' }
          ]
        },
        { id: 'q3', position: 3, label: 'Off', enabled: false, variants: [] }
      ]
    })),
    'pages:add': vi.fn(async () => ({ id: 'new-page', title: null }) as unknown as PageDetail),
    'pages:update': vi.fn(async () => ({ id: 'new-page' }) as unknown as PageDetail),
    'pages:pin': vi.fn(),
    'pages:unpin': vi.fn(),
    'prompts:addQuestions': vi.fn(async () => ({ pageId: 'new-page', promptIds: ['n1'] })),
    'structure:setGroupPages': vi.fn(async () => ({})),
    'start:suggestUrls': vi.fn(async () => ({ suggestions: [], total: 0 })),
    'setup:progress': (listener: (event: SetupProgress) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    progress: (event: SetupProgress) => {
      for (const listener of listeners) listener(event)
    }
  }
  return source as unknown as FakeSource
}
