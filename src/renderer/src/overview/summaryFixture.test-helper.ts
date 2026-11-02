import type { OverviewQuestion, OverviewWeek, VisibilityOverview } from '@shared/ipc'

/** A small Summary for the drill tests: five questions, four weeks with their searches. */

const BEFORE_AT = '2026-10-15T09:00:00.000Z'

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
    source: { kind: 'topic', name: 'Gateway' },
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
  key: 't1|q1',
  you: 'cited',
  ownPage: 'target',
  position: 2,
  change: 'gained',
  before: { you: 'not_cited', ownPage: null, position: null, checkedAt: BEFORE_AT }
})
export const LOST = question({
  key: 't1|q2',
  you: 'named',
  citedInstead: ['reddit.com', 'TextUs'],
  change: 'lost',
  before: { you: 'cited', ownPage: 'target', position: 1, checkedAt: BEFORE_AT }
})
export const KEPT = question({
  key: 't1|q3',
  you: 'cited',
  ownPage: 'other',
  position: 4,
  change: 'kept',
  before: { you: 'cited', ownPage: 'other', position: 3, checkedAt: BEFORE_AT }
})
// No AI Overview before, one now (not cited): the AI Overview tile gained it.
export const NEW_AIO = question({
  key: 't1|q4',
  citedInstead: ['reddit.com'],
  change: 'never',
  before: { you: 'no_aio', ownPage: null, position: null, checkedAt: BEFORE_AT }
})
export const NO_AIO = question({ key: 't1|q5', you: 'no_aio' })

function week(endsAt: string, cited: readonly string[], shown: readonly string[]): OverviewWeek {
  return {
    endsAt,
    cited: cited.length,
    withAio: shown.length,
    searches: shown.map((key) => {
      const [pageId = '', promptId = ''] = key.split('|')
      return {
        key,
        pageId,
        promptId,
        marketId: 'mkt-us',
        runId: `run-${endsAt.slice(8, 10)}`,
        text: `text of ${promptId}`,
        cited: cited.includes(key)
      }
    })
  }
}

export const WEEKS: OverviewWeek[] = [
  { endsAt: '2026-10-02T12:00:00.000Z', cited: null, withAio: null },
  week('2026-10-09T12:00:00.000Z', [LOST.key, KEPT.key], [LOST.key, KEPT.key, GAINED.key]),
  week('2026-10-16T12:00:00.000Z', [LOST.key, KEPT.key], [LOST.key, KEPT.key, GAINED.key]),
  week(
    '2026-10-23T12:00:00.000Z',
    [GAINED.key, KEPT.key],
    [GAINED.key, LOST.key, KEPT.key, NEW_AIO.key]
  )
]

export function overview(patch: Partial<VisibilityOverview> = {}): VisibilityOverview {
  const keys = [GAINED, LOST, KEPT, NEW_AIO, NO_AIO].map((item) => item.key)
  return {
    projectId: 'p1',
    domain: 'textbolt.com',
    brand: 'TextBolt',
    period: '30d',
    marketId: null,
    builtAt: '2026-10-23T12:00:00.000Z',
    periodStart: '2026-09-23T12:00:00.000Z',
    trackedPages: 0,
    trackedTopics: 1,
    hasChecks: true,
    lastCheckedAt: '2026-10-22T09:00:00.000Z',
    checkSearches: { min: 5, max: 5 },
    kpis: {
      tracked: { value: 5, before: null, delta: null },
      keywords: 0,
      withAio: { value: 4, before: 3, delta: 1 },
      cited: { value: 2, before: 2, delta: 0 },
      named: { value: 1, before: 0, delta: 1 },
      share: { value: 10, before: 10, delta: 0, ownCitations: 1, allCitations: 10, questions: 4 }
    },
    weeks: WEEKS,
    questions: [GAINED, LOST, KEPT, NEW_AIO, NO_AIO],
    tracked: [],
    compare: { vs: null, mode: 'previous', at: null, unknown: false, available: true, options: [] },
    diff: { gained: 1, kept: 1, lost: 1, never: 1, unmatched: 0 },
    verdictSets: {
      tracked: keys,
      aio: [GAINED.key, LOST.key, KEPT.key, NEW_AIO.key],
      cited: [GAINED.key, KEPT.key],
      named: [LOST.key],
      not_visible: [NEW_AIO.key],
      cited_before: [LOST.key, KEPT.key],
      cited_after: [GAINED.key, KEPT.key],
      named_before: [],
      named_after: [LOST.key],
      gained: [GAINED.key],
      kept: [KEPT.key],
      lost: [LOST.key],
      top_site: []
    },
    topSite: null,
    method: { marketIds: [], firstCheckAt: null, lastCheckAt: null, agreement: null },
    markets: [],
    citedSites: [],
    shareLinks: [],
    fixes: [],
    openFixes: 0,
    firstReport: null,
    ...patch
  }
}
