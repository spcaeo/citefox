import type {
  CommunitiesReport,
  CommunityAio,
  CommunityLink,
  Market,
  SourceMixCheck,
  ThreadCheckResult
} from '@shared/domain'
import type { CommunitiesRequest } from '@shared/ipc'
import type { CommunitiesSource } from './source'

/*
 * One recorded Communities report and a fake source, shared by the page tab
 * and project screen tests: two answers, five citations, one Reddit thread and
 * one YouTube video. The report echoes the request's scope, page and market.
 */

export const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

export function aio(key: string, position: number, named: boolean): CommunityAio {
  const [runId = '', promptId = ''] = key.split('|')
  return {
    key,
    runId,
    pageId: 'page-1',
    pageLabel: 'Alerts',
    marketId: 'mkt-us',
    promptId,
    promptPosition: position,
    label: `Question label ${position}`,
    text: `Question ${position}?`,
    status: 'not_cited',
    named,
    checkedAt: '2026-10-19T12:00:00.000Z',
    latest: true
  }
}

export const KEYS = ['r1|p1', 'r1|p2']
export const THREAD = 'https://reddit.com/r/sysadmin/comments/1abc23x/x'
export const VIDEO = 'https://youtube.com/watch?v=Gr4fanaSMS1'

function link(
  aioKey: string,
  url: string,
  position: number,
  type: CommunityLink['type'],
  owner: CommunityLink['owner']
): CommunityLink {
  return {
    aioKey,
    checkIndex: 0,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: null,
    position,
    type,
    owner
  }
}

/** The five citations `check()` counts, one per distinct URL per answer. */
export const LINKS: readonly CommunityLink[] = [
  link('r1|p1', 'https://textbolt.com/blog/alerts', 1, 'web', 'yours'),
  link('r1|p1', THREAD, 2, 'reddit', 'external'),
  link('r1|p2', THREAD, 1, 'reddit', 'external'),
  link('r1|p2', VIDEO, 2, 'youtube', 'external'),
  link('r1|p2', 'https://simpletexting.com/alerts', 3, 'web', 'competitor')
]

export function check(): SourceMixCheck {
  return {
    index: 0,
    from: '2026-10-19T12:00:00.000Z',
    to: '2026-10-19T12:00:00.000Z',
    aios: 2,
    aioKeys: KEYS,
    citations: 5,
    types: [
      { type: 'web', citations: 2, aios: 2, aioKeys: KEYS },
      { type: 'reddit', citations: 2, aios: 2, aioKeys: KEYS },
      { type: 'youtube', citations: 1, aios: 1, aioKeys: ['r1|p2'] },
      { type: 'linkedin', citations: 0, aios: 0, aioKeys: [] },
      { type: 'review', citations: 0, aios: 0, aioKeys: [] },
      { type: 'forum', citations: 0, aios: 0, aioKeys: [] },
      { type: 'other', citations: 0, aios: 0, aioKeys: [] }
    ],
    owners: [
      { owner: 'yours', citations: 1, aios: 1, aioKeys: ['r1|p1'] },
      { owner: 'competitor', citations: 1, aios: 1, aioKeys: ['r1|p2'] },
      { owner: 'external', citations: 3, aios: 2, aioKeys: KEYS }
    ]
  }
}

export type ThreadState = 'archived' | 'open'

export function report(
  request: CommunitiesRequest,
  checked: boolean,
  state: ThreadState = 'archived'
): CommunitiesReport {
  const base = {
    gap: 1,
    gapKeys: ['r1|p2'],
    promptPositions: [1, 2],
    pageCount: 1,
    marketIds: ['mkt-us'],
    firstSeenAt: '2026-10-05T12:00:00.000Z',
    firstSeenIn: {
      runId: 'r0',
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptId: 'p1',
      promptPosition: 1,
      checkedAt: '2026-10-05T12:00:00.000Z'
    },
    namedInOverview: 1
  }
  return {
    projectId: request.projectId,
    scope: request.scope,
    pageId: request.pageId,
    marketId: request.marketId,
    builtAt: '2026-10-20T09:00:00.000Z',
    checkedAt: '2026-10-19T12:00:00.000Z',
    brandNames: ['TextBolt'],
    domain: 'textbolt.com',
    markets: [US],
    pageCount: 1,
    aios: [aio('r1|p1', 1, true), aio('r1|p2', 2, false)],
    links: LINKS,
    checks: [check()],
    reddit: [
      {
        ...base,
        url: THREAD,
        title: 'vtext.com shutting down',
        timesCited: 2,
        aioKeys: KEYS,
        subreddit: 'r/sysadmin',
        threadId: '1abc23x',
        replyState: checked ? state : 'unchecked',
        comments: checked ? 214 : null,
        upvotes: checked ? 388 : null,
        postedAt: checked ? '2025-10-04T00:00:00.000Z' : null,
        brandInThread: checked ? true : null,
        brandQuote: checked ? 'TextBolt worked for us, took 20 minutes.' : null,
        excerpt: checked
          ? 'vtext.com shutting down\n\nOur alarm panels send to @vtext.com. What now?'
          : null,
        checkedAt: checked ? '2026-10-20T09:00:00.000Z' : null
      }
    ],
    youtube: [
      {
        ...base,
        url: VIDEO,
        title: 'Send SMS Alerts from Grafana in 5 Minutes',
        timesCited: 1,
        aioKeys: ['r1|p2'],
        videoId: 'Gr4fanaSMS1',
        channelTitle: 'Ops Shortcuts',
        channelId: 'UCx',
        views: 48210,
        publishedAt: '2026-03-04T15:00:00Z',
        durationSeconds: 312,
        yours: false
      }
    ],
    linkedin: [],
    forums: [],
    opportunities: [
      {
        rank: 1,
        aioKey: 'r1|p2',
        sourceType: 'reddit',
        sourceUrl: THREAD,
        sourceTitle: 'vtext.com shutting down',
        channel: 'r/sysadmin',
        sourcePosition: 1,
        otherSources: 1,
        gainPoints: 3,
        action: 'Answer the r/sysadmin thread with the steps from your page.',
        why: 'A r/sysadmin thread is source 1 in this answer.'
      }
    ],
    extras: {
      youtubeKey: false,
      ownChannel: null,
      threadsChecked: checked ? 1 : 0,
      videosWithDetails: 1
    }
  }
}

export function fakeSource(
  state: ThreadState = 'archived'
): CommunitiesSource & { requests: CommunitiesRequest[] } {
  const requests: CommunitiesRequest[] = []
  let checked = false
  return {
    requests,
    'communities:get': (request) => {
      requests.push(request)
      return Promise.resolve(report(request, checked, state))
    },
    'communities:checkThreads': (): Promise<ThreadCheckResult> => {
      checked = true
      return Promise.resolve({ checked: 1, cached: 0, failed: 0, skipped: 0, message: null })
    },
    'communities:refreshVideos': () =>
      Promise.resolve({ fetched: 0, missingKey: true, message: 'Add a YouTube key.' }),
    'communities:getSettings': () => Promise.resolve({ youtubeChannel: null })
  }
}
