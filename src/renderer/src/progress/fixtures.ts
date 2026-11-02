import type {
  FixMarketOutcome,
  LoggedFix,
  MarketCheckMetrics,
  PageResults,
  PromptCheckRow,
  PromptCheckStatus
} from '@shared/domain'
import { emptyResults } from '../visibility/mocks'

/** Tests and the Vite harness only. Production screens do not import this module. */

export function row(
  n: number,
  status: PromptCheckStatus,
  extra: Partial<PromptCheckRow> = {}
): PromptCheckRow {
  return {
    promptId: `p${n}`,
    promptPosition: n,
    label: `Question ${n} label`,
    text: `Full wording of buyer question ${n}?`,
    source: 'title_meta_h1',
    intentStage: 'problem',
    status,
    frequency: { matching: 1, samples: 1 },
    position: status === 'page_cited' || status === 'other_own_page' ? 2 : null,
    citedUrl: status === 'page_cited' ? 'https://textbolt.com/alerts' : null,
    references: [],
    wrongPageCited: status === 'other_own_page',
    named: status === 'no_aio' || status === 'error' ? null : status !== 'not_cited',
    movement: null,
    previousStatus: null,
    previousPosition: null,
    coverage: null,
    action: null,
    aioSummary: null,
    checkedAt: null,
    ...extra
  }
}

export function results(
  runId: string,
  finishedAt: string,
  prompts: readonly PromptCheckRow[],
  run: Partial<MarketCheckMetrics> = {}
): PageResults {
  const base = emptyResults()
  return {
    ...base,
    scope: {
      ...base.scope,
      promptCount: prompts.length,
      brands: ['TextBolt'],
      pageUrl: 'https://textbolt.com/alerts',
      checkedAt: finishedAt
    },
    prompts,
    run: {
      runId,
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptSetId: 'pset-1',
      promptSetVersion: 1,
      snapshotId: 'snap-1',
      contentHash: 'a'.repeat(64),
      contentChanged: false,
      contentChange: null,
      kind: 'scheduled',
      partial: false,
      status: 'finished',
      startedAt: finishedAt,
      finishedAt,
      promptsChecked: prompts.length,
      promptsWithAio: prompts.filter((item) => item.status !== 'no_aio').length,
      pageCited: prompts.filter((item) => item.status === 'page_cited').length,
      otherOwnPage: 0,
      brandMentioned: 0,
      notCited: 0,
      noAio: 0,
      errors: 0,
      points: 0,
      pointsPossible: 0,
      visibilityScore: 40,
      citationsThisPage: 0,
      citationsOtherOwn: 0,
      citedAndNamed: 0,
      averagePosition: null,
      ...run
    }
  }
}

export function outcome(extra: Partial<FixMarketOutcome> = {}): FixMarketOutcome {
  return {
    marketId: 'mkt-us',
    beforeRunId: 'run-1',
    beforeAt: '2026-10-05T12:00:00.000Z',
    afterRunId: 'run-2',
    afterAt: '2026-10-19T12:00:00.000Z',
    afterPartial: false,
    verdict: 'partly',
    compared: 3,
    worked: 1,
    worse: 1,
    prompts: [
      prompt(6, 'brand_mentioned', 'page_cited', 'worked'),
      prompt(4, 'not_cited', 'not_cited', 'no_change'),
      prompt(9, 'page_cited', 'not_cited', 'got_worse')
    ],
    others: {
      total: 7,
      moved: 3,
      promptIds: ['p1', 'p5', 'p7'],
      fromRunId: 'run-1',
      toRunId: 'run-2'
    },
    ...extra
  }
}

function prompt(
  n: number,
  before: PromptCheckStatus,
  after: PromptCheckStatus,
  result: FixMarketOutcome['prompts'][number]['result']
): FixMarketOutcome['prompts'][number] {
  return {
    promptId: `p${n}`,
    promptPosition: n,
    label: `Question ${n} label`,
    text: `Full wording of buyer question ${n}?`,
    before: { status: before, position: before === 'page_cited' ? 5 : null },
    after: { status: after, position: after === 'page_cited' ? 3 : null },
    result
  }
}

export function fix(extra: Partial<LoggedFix> = {}): LoggedFix {
  return {
    id: 'fix-1',
    pageId: 'page-1',
    number: 1,
    kind: 'fix',
    description: 'Added 5 FAQs',
    goLiveAt: '2026-10-08T12:00:00.000Z',
    rule: 'after_3_days',
    promptIds: ['p4', 'p6', 'p9'],
    marketIds: ['mkt-us'],
    status: 'completed',
    followUpAt: null,
    followUpJobId: 'job-1',
    followUpRunId: 'run-2',
    createdAt: '2026-10-08T09:00:00.000Z',
    verdict: 'Partly worked · 1 of 3 questions',
    markets: [outcome()],
    ...extra
  }
}
