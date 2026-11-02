import { fireEvent, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  OverviewQuestion,
  OverviewShareLink,
  OverviewTrackedQuestion,
  VisibilityOverview,
  VisibilityOverviewRequest
} from '@shared/ipc'
import type { OverviewClient } from './client'

/** The Overview screen tests' fixture: four questions, a full Summary and a fake client. */
export const PRICING = 'https://textbolt.com/pricing/'
export const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
export const UK: Market = { ...US, id: 'mkt-uk', country: 'UK' }

export const BEFORE_AT = '2026-10-08T09:00:00.000Z'

export function question(
  patch: Partial<OverviewQuestion> & Pick<OverviewQuestion, 'key'>
): OverviewQuestion {
  const [pageId = '', promptId = ''] = patch.key.split('|')
  return {
    pageId,
    promptId,
    marketId: 'mkt-us',
    runId: 'run-9',
    text: promptId,
    source: { kind: 'page', url: PRICING, path: '/pricing/' },
    you: 'not_cited',
    ownPage: null,
    position: null,
    citedUrl: null,
    citedInstead: [],
    change: null,
    before: null,
    checkedAt: '2026-10-22T09:00:00.000Z',
    ...patch
  }
}

export const GAINED = question({
  key: 'topic-1|tq-3',
  text: 'best replacement for a carrier email to text gateway',
  source: { kind: 'topic', name: 'Gateway shutdown' },
  you: 'cited',
  ownPage: 'target',
  position: 3,
  citedInstead: ['TextUs', 'Twilio'],
  change: 'gained',
  before: { you: 'not_cited', ownPage: null, position: null, checkedAt: BEFORE_AT }
})
export const LOST = question({
  key: 'page-pricing|p-2',
  runId: 'run-8',
  text: 'cheapest business texting service',
  you: 'named',
  change: 'lost',
  before: { you: 'cited', ownPage: 'target', position: 2, checkedAt: BEFORE_AT }
})
export const KEPT = question({
  key: 'page-pricing|p-3',
  text: 'texting service with per message pricing',
  you: 'cited',
  ownPage: 'other',
  position: 1,
  change: 'kept',
  before: { you: 'cited', ownPage: 'other', position: 1, checkedAt: BEFORE_AT }
})
export const NEVER = question({
  key: 'page-home|p-4',
  text: 'how to text employees from email',
  change: 'never',
  before: { you: 'not_cited', ownPage: null, position: null, checkedAt: BEFORE_AT }
})

/** The tracked rows behind the tile: the four checked questions, then unchecked ones. */
export function trackedRows(count: number, keywords: number): OverviewTrackedQuestion[] {
  const checked = [GAINED, LOST, KEPT, NEVER].slice(0, count)
  return Array.from({ length: count }, (_, index): OverviewTrackedQuestion => {
    const known = checked[index]
    const key = known?.key ?? `page-home|extra-${index}`
    const [pageId = '', promptId = ''] = key.split('|')
    return {
      key,
      pageId,
      promptId,
      label: promptId,
      text: known?.text ?? `tracked question ${index + 1}`,
      source: known?.source ?? { kind: 'page', url: PRICING, path: '/pricing/' },
      keyword: index >= count - keywords
    }
  })
}

/** The links behind the share: `own` links to textbolt.com first, then the rest. */
export function shareLinks(own: number, all: number): OverviewShareLink[] {
  return Array.from({ length: all }, (_, index): OverviewShareLink => {
    const mine = index < own
    const host = mine ? 'textbolt.com' : index % 2 === 0 ? 'textus.com' : 'reddit.com'
    const asked = [GAINED, LOST, KEPT, NEVER][index % 4] ?? GAINED
    return {
      id: `${asked.key}|run-9|${index}`,
      pageId: asked.pageId,
      promptId: asked.promptId,
      promptText: asked.text,
      marketId: 'mkt-us',
      runId: 'run-9',
      url: `https://${host}/page-${index}/`,
      position: (index % 8) + 1,
      host,
      own: mine
    }
  })
}

export function overview(patch: Partial<VisibilityOverview> = {}): VisibilityOverview {
  const data = overviewBase(patch)
  return {
    ...data,
    tracked: patch.tracked ?? trackedRows(data.kpis.tracked.value, data.kpis.keywords)
  }
}

export function overviewBase(patch: Partial<VisibilityOverview>): VisibilityOverview {
  const all = [GAINED.key, LOST.key, KEPT.key, NEVER.key]
  return {
    tracked: [],
    projectId: 'proj-1',
    domain: 'textbolt.com',
    brand: 'TextBolt',
    period: '30d',
    marketId: null,
    builtAt: '2026-10-23T12:00:00.000Z',
    periodStart: '2026-09-23T12:00:00.000Z',
    trackedPages: 2,
    trackedTopics: 1,
    hasChecks: true,
    lastCheckedAt: '2026-10-22T09:00:00.000Z',
    checkSearches: { min: 46, max: 92 },
    kpis: {
      tracked: { value: 46, before: 46, delta: 0 },
      keywords: 0,
      withAio: { value: 31, before: 31, delta: 0 },
      cited: { value: 6, before: 4, delta: 2 },
      named: { value: 3, before: 3, delta: 0 },
      share: {
        value: 8,
        before: 9,
        delta: -1,
        ownCitations: 12,
        allCitations: 150,
        questions: 31
      }
    },
    weeks: [
      { endsAt: '2026-09-25T12:00:00.000Z', cited: null, withAio: null },
      { endsAt: '2026-10-02T12:00:00.000Z', cited: 3, withAio: 30 },
      { endsAt: '2026-10-09T12:00:00.000Z', cited: 4, withAio: 30 },
      { endsAt: '2026-10-16T12:00:00.000Z', cited: 4, withAio: 31 },
      { endsAt: '2026-10-23T12:00:00.000Z', cited: 6, withAio: 31 }
    ],
    questions: [GAINED, LOST, KEPT, NEVER],
    compare: {
      vs: null,
      mode: 'previous',
      at: null,
      unknown: false,
      available: true,
      options: [{ value: 'run-5', at: BEFORE_AT }]
    },
    diff: { gained: 1, kept: 1, lost: 1, never: 1, unmatched: 0 },
    verdictSets: {
      tracked: all,
      aio: all,
      cited: [GAINED.key, KEPT.key],
      named: [LOST.key],
      not_visible: [NEVER.key],
      cited_before: [LOST.key, KEPT.key],
      cited_after: [GAINED.key, KEPT.key],
      named_before: [],
      named_after: [LOST.key],
      gained: [GAINED.key],
      kept: [KEPT.key],
      lost: [LOST.key],
      top_site: [GAINED.key, LOST.key, NEVER.key]
    },
    topSite: { name: 'TextUs', count: 3 },
    method: {
      marketIds: ['mkt-us'],
      firstCheckAt: '2026-10-01T09:00:00.000Z',
      lastCheckAt: '2026-10-22T09:00:00.000Z',
      agreement: { total: 2, agree: 1, percent: 50, totalIds: [], agreeIds: [] }
    },
    markets: [US],
    citedSites: [
      {
        name: 'TextUs',
        domain: 'textus.com',
        count: 3,
        own: false,
        competitor: true,
        before: 7,
        keys: [GAINED.key, LOST.key, NEVER.key]
      },
      {
        name: 'TextBolt',
        domain: 'textbolt.com',
        count: 2,
        own: true,
        competitor: false,
        before: 4,
        keys: [GAINED.key, KEPT.key]
      },
      {
        name: 'reddit.com',
        domain: 'reddit.com',
        count: 1,
        own: false,
        competitor: false,
        before: 3,
        keys: [NEVER.key]
      }
    ],
    shareLinks: shareLinks(12, 150),
    fixes: [
      {
        fixId: 'fix-1',
        pageId: 'page-pricing',
        number: 1,
        title: 'Add a per-message price table',
        source: { kind: 'page', url: PRICING, path: '/pricing/' },
        questions: 3,
        goLiveAt: '2026-10-20T00:00:00.000Z'
      }
    ],
    openFixes: 7,
    firstReport: {
      checkedAt: '2026-10-01T09:00:00.000Z',
      topicId: 'topic-1',
      topics: 1,
      questions: 10,
      suggestedPages: 3,
      untrackedSuggested: 3
    },
    ...patch
  }
}

/** No earlier full check: nothing compares. */
export function firstOnly(): Partial<VisibilityOverview> {
  const questions = [GAINED, LOST, KEPT, NEVER].map((item) => ({
    ...item,
    change: null,
    before: null
  }))
  return {
    questions,
    diff: null,
    compare: {
      vs: null,
      mode: 'previous',
      at: null,
      unknown: false,
      available: false,
      options: []
    },
    kpis: {
      tracked: { value: 46, before: null, delta: null },
      keywords: 0,
      withAio: { value: 31, before: null, delta: null },
      cited: { value: 6, before: null, delta: null },
      named: { value: 3, before: null, delta: null },
      share: {
        value: 8,
        before: null,
        delta: null,
        ownCitations: 12,
        allCitations: 150,
        questions: 31
      }
    },
    citedSites: [
      {
        name: 'TextBolt',
        domain: 'textbolt.com',
        count: 2,
        own: true,
        competitor: false,
        before: null,
        keys: [GAINED.key, KEPT.key]
      }
    ]
  }
}

export function fakeClient(
  reply: (request: VisibilityOverviewRequest) => VisibilityOverview | Error
): {
  client: OverviewClient
  calls: VisibilityOverviewRequest[]
} {
  const calls: VisibilityOverviewRequest[] = []
  return {
    calls,
    client: {
      'visibility:overview': (request) => {
        calls.push(request)
        const result = reply(request)
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve({ ...result, period: request.period })
      }
    }
  }
}

/** The rows the open drill drawer lists in all ("Show all" first when it holds more than 100). */
export async function drawerRows(dialog: HTMLElement): Promise<number> {
  const more = within(dialog).queryByRole('button', { name: /^Show all \d/ })
  if (more) fireEvent.click(more)
  const grid = within(dialog).queryByRole('grid')
  if (grid === null) return 0
  await waitFor(() => expect(grid.querySelectorAll('[data-drill-row]').length).toBeGreaterThan(0))
  return Number(grid.getAttribute('aria-rowcount')) - 1
}

export const FIRST_CALL = { projectId: 'proj-1', period: '30d', marketId: null, vs: null }
