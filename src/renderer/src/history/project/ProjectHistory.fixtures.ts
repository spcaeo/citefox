import { vi } from 'vitest'
import type {
  ContentDiff,
  Market,
  PageResults,
  PromptCheckRow,
  PromptCheckStatus
} from '@shared/domain'
import type {
  CheckJob,
  CheckRunIdRequest,
  CompareContentRequest,
  GetResultsRequest,
  GridCsvRequest,
  ProjectCheck,
  ProjectHistory,
  StartCheckRequest
} from '@shared/ipc'
import type { ProjectHistorySource } from '../client'

/** Fixtures for the Check history tests: five checks of one page and a topic. */

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

export function check(patch: Partial<ProjectCheck> & Pick<ProjectCheck, 'runId'>): ProjectCheck {
  return {
    jobId: `job-${patch.runId}`,
    pageId: 'page-1',
    marketId: 'mkt-us',
    snapshotId: 'snap-1',
    kind: 'manual',
    partial: false,
    status: 'finished',
    startedAt: '2026-10-05T12:00:00.000Z',
    finishedAt: '2026-10-05T12:01:30.000Z',
    durationMs: 90_000,
    questionsChecked: 3,
    questionsTotal: 3,
    aiOverviews: 2,
    cited: 1,
    named: 1,
    searchesUsed: 5,
    score: 40,
    scoreChange: null,
    samples: 1,
    promptIds: null,
    failedPromptIds: [],
    ...patch
  }
}

export const NEWEST = check({
  runId: 'run-3',
  startedAt: '2026-10-19T12:00:00.000Z',
  finishedAt: '2026-10-19T12:00:42.000Z',
  durationMs: 42_000,
  snapshotId: 'snap-2',
  cited: 2,
  searchesUsed: 6,
  score: 67,
  scoreChange: 27,
  kind: 'scheduled'
})
export const PARTIAL = check({
  runId: 'run-2',
  startedAt: '2026-10-12T12:00:00.000Z',
  kind: 'follow_up',
  partial: true,
  questionsChecked: 1,
  aiOverviews: 1,
  cited: 1,
  named: 0,
  searchesUsed: 2,
  score: 100,
  promptIds: ['prompt-1']
})
export const OLDEST = check({ runId: 'run-1', kind: 'baseline' })
export const UK_CHECK = check({
  runId: 'run-uk',
  marketId: 'mkt-uk',
  startedAt: '2026-10-05T12:05:00.000Z',
  score: null
})
export const TOPIC = check({
  runId: 'run-topic',
  pageId: 'topic-1',
  snapshotId: 'snap-t',
  startedAt: '2026-10-15T09:00:00.000Z',
  status: 'cancelled',
  questionsTotal: 40,
  questionsChecked: 12,
  score: null,
  failedPromptIds: ['tq-13', 'tq-14']
})

export function history(
  checks: readonly ProjectCheck[] = [NEWEST, TOPIC, PARTIAL, UK_CHECK, OLDEST],
  trackedCount = 2
): ProjectHistory {
  return {
    projectId: 'proj-1',
    builtAt: '2026-10-20T12:00:00.000Z',
    markets: [US, UK],
    subjects: [
      {
        id: 'page-1',
        kind: 'page',
        label: 'Alerts',
        url: 'https://textbolt.com/blog/text-alerts/'
      },
      { id: 'topic-1', kind: 'topic', label: 'Crew alerts', url: null }
    ],
    checks,
    trackedCount
  }
}

export const DIFF: ContentDiff = {
  pageId: 'page-1',
  from: { id: 'snap-1', fetchedAt: '2026-10-05T12:00:00.000Z', wordCount: 9, faqCount: 0 },
  to: { id: 'snap-2', fetchedAt: '2026-10-15T12:00:00.000Z', wordCount: 15, faqCount: 2 },
  summary: 'Added 2 FAQs and 6 words.',
  fields: [],
  outline: [],
  faqs: [],
  body: [],
  bodyTruncated: false
}

export function promptRow(
  promptId: string,
  position: number,
  status: PromptCheckStatus,
  patch: Partial<PromptCheckRow> = {}
): PromptCheckRow {
  const aio = status !== 'no_aio' && status !== 'error'
  return {
    promptId,
    promptPosition: position,
    label: `Q${position}`,
    text: `Question ${position}?`,
    source: 'generated',
    intentStage: 'consideration',
    status,
    frequency: { hits: 1, samples: 1 },
    position: status === 'page_cited' ? 2 : null,
    citedUrl: status === 'page_cited' ? 'https://textbolt.com/blog/text-alerts/' : null,
    references: aio
      ? [
          {
            id: `${promptId}-r1`,
            position: 1,
            url: 'https://twilio.com/sms',
            normalizedUrl: 'twilio.com/sms',
            domain: 'twilio.com',
            title: 'Twilio SMS',
            classification: 'competitor',
            untracked: false,
            sourceType: 'web'
          }
        ]
      : [],
    wrongPageCited: status === 'other_own_page',
    named: aio ? false : null,
    movement: null,
    previousStatus: null,
    previousPosition: null,
    coverage: null,
    action: null,
    aioSummary: null,
    checkedAt: '2026-10-05T12:00:00.000Z',
    ...patch
  } as PromptCheckRow
}

/** Results of a check: only what Check history reads (prompts, run score, scope date). */
export function results(
  runId: string,
  prompts: readonly PromptCheckRow[],
  score: number | null
): PageResults {
  return {
    scope: {
      checkedAt: '2026-10-05T12:00:00.000Z',
      brands: ['TextBolt'],
      pageUrl: 'https://textbolt.com/blog/text-alerts/'
    },
    run: { runId, marketId: 'mkt-us', visibilityScore: score },
    prompts
  } as unknown as PageResults
}

export const RESULTS: Readonly<Record<string, PageResults>> = {
  'run-1': results(
    'run-1',
    [
      promptRow('prompt-1', 1, 'not_cited'),
      promptRow('prompt-2', 2, 'page_cited'),
      promptRow('prompt-3', 3, 'no_aio')
    ],
    40
  ),
  'run-3': results(
    'run-3',
    [
      promptRow('prompt-1', 1, 'page_cited', { named: true }),
      promptRow('prompt-2', 2, 'page_cited'),
      promptRow('prompt-3', 3, 'not_cited')
    ],
    67
  )
}

export interface FakeSource {
  source: ProjectHistorySource
  compares: CompareContentRequest[]
  deletes: CheckRunIdRequest[]
  starts: StartCheckRequest[]
  cancels: string[]
  csv: GridCsvRequest[]
  resultsCalls: GetResultsRequest[]
  lists: () => number
  /** Ends the started jobs with this status. */
  finishStarts: (status?: CheckJob['status']) => void
}

export function fakeSource(data: ProjectHistory | Error = history()): FakeSource {
  const compares: CompareContentRequest[] = []
  const deletes: CheckRunIdRequest[] = []
  const starts: StartCheckRequest[] = []
  const cancels: string[] = []
  const csv: GridCsvRequest[] = []
  const resultsCalls: GetResultsRequest[] = []
  const pending: ((job: CheckJob) => void)[] = []
  let lists = 0
  let next = data
  const source: ProjectHistorySource = {
    'history:listProject': vi.fn(() => {
      lists += 1
      const current = next
      if (current instanceof Error) {
        next = history()
        return Promise.reject(current)
      }
      return Promise.resolve(current)
    }),
    'history:compare': vi.fn((request: CompareContentRequest) => {
      compares.push(request)
      return Promise.resolve(DIFF)
    }),
    'history:delete': vi.fn((request: CheckRunIdRequest) => {
      deletes.push(request)
      if (!(next instanceof Error)) {
        next = { ...next, checks: next.checks.filter((item) => item.runId !== request.runId) }
      }
      return Promise.resolve({ runId: request.runId, samples: 3 })
    }),
    'results:get': vi.fn((request: GetResultsRequest) => {
      resultsCalls.push(request)
      const found = RESULTS[request.runId ?? '']
      return found ? Promise.resolve(found) : Promise.reject(new Error('No results'))
    }),
    'checks:start': vi.fn((request: StartCheckRequest) => {
      starts.push(request)
      return new Promise<CheckJob>((resolve) => pending.push(resolve))
    }),
    'checks:cancel': vi.fn((request: { jobId: string }) => {
      cancels.push(request.jobId)
      return Promise.resolve({ id: request.jobId, status: 'cancelled' } as CheckJob)
    }),
    'grid:exportCsv': vi.fn((request: GridCsvRequest) => {
      csv.push(request)
      return Promise.resolve({
        ok: true as const,
        rowCount: request.rows.length,
        columnCount: request.header.length,
        fileName: request.fileName
      })
    })
  }
  return {
    source,
    compares,
    deletes,
    starts,
    cancels,
    csv,
    resultsCalls,
    lists: () => lists,
    finishStarts: (status = 'finished') => {
      for (const resolve of pending.splice(0)) {
        resolve({ id: 'job-new', status, message: null, nextStep: null } as CheckJob)
      }
    }
  }
}
