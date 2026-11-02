// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { BuyerPrompt, PageResults, PromptSetView } from '@shared/domain'
import type { CheckJob, CheckProgress, CheckStepSnapshot } from '@shared/ipc'
import { afterEach, describe, expect, it } from 'vitest'
import { pageHash, runningHash } from '../shell/routes'
import { TEXTBOLT_MARKETS, TEXTBOLT_PAGE, textboltJob, textboltResults } from './fixtures'
import { ResultsPanel } from './ResultsPanel'
import { RunningJob } from './RunningPage'
import {
  checkError,
  checkStartMessage,
  jobForPage,
  startCheckRequest,
  type CheckSource
} from './source'

afterEach(() => {
  cleanup()
})

function emptyPromptSet(pageId = 'page-1'): PromptSetView {
  return {
    pageId,
    promptSetId: null,
    version: null,
    savedAt: null,
    icpId: null,
    templateId: null,
    templateName: null,
    templateHash: null,
    templateUpdatedAt: null,
    dirty: false,
    nextVersion: null,
    prompts: [],
    brandsClear: true,
    brandMessage: '',
    nextCheck: { prompts: 0, markets: 0, samples: 1, minSearches: 0, maxSearches: 0 }
  }
}

function source(overrides: Partial<CheckSource> = {}): CheckSource {
  return {
    'checks:start': () => Promise.reject(new Error('not used')),
    'checks:listActive': () => Promise.resolve([]),
    'checks:get': () => Promise.resolve(null),
    'checks:cancel': () => Promise.reject(new Error('no job')),
    'checks:progress': () => () => undefined,
    'checks:finished': () => () => undefined,
    'results:get': () => Promise.reject(new Error('not used')),
    'prompts:list': () => Promise.resolve(emptyPromptSet()),
    ...overrides
  }
}

function buyerPrompt(id: string, position: number, text: string): BuyerPrompt {
  return {
    id,
    position,
    label: `Question ${position}`,
    source: 'written_by_user',
    intentStage: 'problem',
    mappedElement: '',
    enabled: true,
    variants: [{ marketId: 'us-en', language: 'en', text, originalText: null }]
  }
}

function searchStep(
  promptId: string,
  position: number,
  text: string,
  state: 'running' | 'ok'
): CheckStepSnapshot {
  return {
    pageId: 'page-1',
    marketId: 'us-en',
    promptId,
    promptPosition: position,
    label: `Question ${position}`,
    promptText: text,
    sampleNo: 1,
    phase: 'search',
    state,
    detail: state === 'ok' ? 'Loaded' : '',
    errorCode: null,
    error: null,
    retrySearches: 0
  }
}

function progressFor(job: CheckJob): CheckProgress {
  return {
    jobId: job.id,
    projectId: job.projectId,
    pageId: job.pageIds[0] ?? '',
    marketId: job.markets[0]?.marketId ?? null,
    promptId: null,
    sampleNo: null,
    phase: 'search',
    state: 'running',
    detail: '',
    nextStep: null,
    errorCode: null,
    retrySearches: 0,
    done: job.done,
    total: job.total,
    searchesUsed: job.searchesUsed,
    searchesMax: job.searchesMax,
    monthUsed: job.monthUsed,
    monthLimit: job.monthLimit,
    markets: job.markets
  }
}

describe('check source helpers', () => {
  it('keeps the running job for this page', () => {
    const job = textboltJob()
    const other: CheckJob = { ...job, id: 'other', pageIds: ['else'], status: 'running' }
    const finished: CheckJob = { ...job, id: 'done', status: 'finished' }
    expect(jobForPage([other, finished, job], job.pageIds[0] ?? '')?.id).toBe(job.id)
    expect(jobForPage([finished], job.pageIds[0] ?? '')).toBeNull()
    expect(checkError(new Error('The engine is busy.'), 'fallback')).toBe('The engine is busy.')
    expect(checkError(new Error('Unknown page'), 'fallback')).toBe('Unknown page')
    expect(
      checkError(
        new Error(
          "Error invoking remote method 'checks:start': Error: checks:start: Add a search key before checking."
        ),
        'fallback'
      )
    ).toBe('Add a search key before checking.')
    expect(startCheckRequest('proj-1', 'page-1')).toEqual({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const refused = textboltJob()
    expect(
      checkStartMessage({
        ...refused,
        status: 'error',
        message: "This check would pass the project's search cap.",
        nextStep: 'Raise the cap or wait until next month.'
      })
    ).toBe(
      "This check would pass the project's search cap. Raise the cap or wait until next month."
    )
    expect(
      checkStartMessage({
        ...refused,
        status: 'error',
        message: 'Save buyer questions before checking this page.',
        nextStep: null
      })
    ).toBe('Save buyer questions before checking this page.')
    expect(
      checkStartMessage({
        ...refused,
        status: 'cancelled',
        message: null,
        nextStep: null
      })
    ).toBe('The check was cancelled.')
  })
})

describe('Running job', () => {
  it('renders the empty state from an empty active list', async () => {
    const seen: unknown[] = []
    const view = render(
      <RunningJob
        source={source({
          'checks:listActive': (request) => {
            seen.push(request)
            return Promise.resolve([])
          }
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
      />
    )
    expect(await view.findByRole('heading', { name: 'First check' })).toBeTruthy()
    expect(view.getByText('No check is running.')).toBeTruthy()
    const start = view.getByRole('button', { name: 'Start first check' })
    expect(start.tagName).toBe('BUTTON')
    expect(start.className).toContain('btn-primary')
    expect(start.hasAttribute('disabled')).toBe(false)
    expect(view.queryByText(/Checking 10 questions/)).toBeNull()
    expect(view.queryByText('Timed out once, retried')).toBeNull()
    expect(seen).toEqual([{ projectId: 'proj-1' }])
  })

  it('cancels the running job from main', async () => {
    const job = textboltJob()
    const cancelled: string[] = []
    const view = render(
      <RunningJob
        source={source({
          'checks:listActive': () => Promise.resolve([job]),
          'checks:cancel': (request) => {
            cancelled.push(request.jobId)
            return Promise.resolve({ ...job, status: 'cancelled' })
          }
        })}
        projectId={job.projectId}
        pageId={job.pageIds[0] ?? ''}
        samples={1}
        markets={TEXTBOLT_MARKETS}
      />
    )
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    fireEvent.click(await view.findByRole('button', { name: 'Cancel check' }))
    expect(await view.findByText('No check is running.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Start first check' })).toBeTruthy()
    expect(cancelled).toEqual([job.id])
  })

  it('calls checks:start with this page and shows progress from checks:get', async () => {
    const job = { ...textboltJob(), projectId: 'proj-1', pageIds: ['page-1'] }
    const seen: unknown[] = []
    let notify: ((event: CheckProgress) => void) | undefined
    let resolveStart: (value: CheckJob) => void = () => undefined
    let current = job
    const view = render(
      <RunningJob
        source={source({
          'checks:start': (request) => {
            seen.push(request)
            return new Promise<CheckJob>((resolve) => {
              resolveStart = resolve
            })
          },
          'checks:get': () => Promise.resolve(current),
          'checks:progress': (listener) => {
            notify = listener
            return () => undefined
          }
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Start first check' }))
    await waitFor(() => {
      expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    })
    expect(view.getByText('Starting the check…')).toBeTruthy()
    expect(view.queryByRole('progressbar')).toBeNull()
    expect(seen).toEqual([
      { projectId: 'proj-1', pageIds: ['page-1'], marketIds: null, promptIds: null }
    ])
    notify?.(progressFor(current))
    const bar = await view.findByRole('progressbar', { name: 'Questions checked' })
    expect(bar.getAttribute('aria-valuenow')).toBe('16')
    expect(view.getByRole('heading', { name: 'Checking 10 questions in 4 markets' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    current = { ...job, done: 17 }
    notify?.(progressFor(current))
    await waitFor(() => {
      expect(
        view.getByRole('progressbar', { name: 'Questions checked' }).getAttribute('aria-valuenow')
      ).toBe('17')
    })
    resolveStart({ ...current, status: 'running' })
    await waitFor(() => {
      expect(view.queryByText('Starting the check…')).toBeNull()
    })
    expect(view.queryByText('No check is running.')).toBeNull()
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    expect(
      view.getByRole('progressbar', { name: 'Questions checked' }).getAttribute('aria-valuenow')
    ).toBe('17')
  })

  it('keeps progress while checks:start is pending, then shows Check finished', async () => {
    const first = 'How can I send text alerts?'
    const second = 'Is there a way to schedule a text?'
    const prompts = [buyerPrompt('p1', 1, first), buyerPrompt('p2', 2, second)]
    const base = {
      ...textboltJob(),
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['us-en'],
      done: 0,
      total: 2,
      markets: [{ marketId: 'us-en', done: 0, total: 2, state: 'running' as const }],
      steps: [] as CheckStepSnapshot[]
    }
    let current: CheckJob = base
    let resolveStart: (value: CheckJob) => void = () => undefined
    let notify: ((event: CheckProgress) => void) | undefined
    const view = render(
      <RunningJob
        source={source({
          'checks:start': () =>
            new Promise<CheckJob>((resolve) => {
              resolveStart = resolve
            }),
          'checks:get': () => Promise.resolve(current),
          'checks:progress': (listener) => {
            notify = listener
            return () => undefined
          },
          'prompts:list': () => Promise.resolve({ ...emptyPromptSet(), prompts })
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Start first check' }))
    await waitFor(() => {
      expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    })
    expect(view.getByText('Starting the check…')).toBeTruthy()
    expect(view.queryByText('No check is running.')).toBeNull()

    notify?.(progressFor(current))
    expect(
      await view.findByRole('heading', { name: 'Checking 2 questions in 1 market' })
    ).toBeTruthy()
    expect(await view.findByText(first)).toBeTruthy()
    expect(view.getByText(second)).toBeTruthy()
    expect(
      view.getByRole('progressbar', { name: 'Questions checked' }).getAttribute('aria-valuenow')
    ).toBe('0')
    const grid = view.getByRole('grid', { name: 'Questions in the market being checked' })
    // Two prompt rows plus the header row.
    expect(grid.getAttribute('aria-rowcount')).toBe('3')
    expect(view.getAllByText('Waiting').length).toBeGreaterThan(0)
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()

    current = { ...base, steps: [searchStep('p1', 1, first, 'running')] }
    notify?.(progressFor(current))
    expect(await view.findByText('Searching…')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()

    current = {
      ...base,
      done: 1,
      markets: [{ marketId: 'us-en', done: 1, total: 2, state: 'running' }],
      steps: [searchStep('p1', 1, first, 'ok')]
    }
    notify?.(progressFor(current))
    await waitFor(() => {
      expect(
        view.getByRole('progressbar', { name: 'Questions checked' }).getAttribute('aria-valuenow')
      ).toBe('1')
    })
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    expect(view.getByText('Market being checked now')).toBeTruthy()
    expect(view.getByText(/searches used/).textContent).toContain(
      '34 searches used so far, up to 80'
    )

    resolveStart({
      ...current,
      status: 'finished',
      finishedAt: current.startedAt,
      done: 99,
      total: 99,
      steps: []
    })
    const finishedHeading = await view.findByRole('heading', { level: 1, name: 'Check finished' })
    expect(finishedHeading.textContent).toBe('Check finished')
    expect(view.queryByText('No check is running.')).toBeNull()
    expect(view.queryByText('Market being checked now')).toBeNull()
    expect(view.getByText('Checked')).toBeTruthy()
    expect(view.getByText(/searches used/).textContent).toBe(
      '34 searches used, up to 80 · 1,274 of 5,000 this month'
    )
    expect(view.queryByText(/so far/)).toBeNull()
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    expect(
      view.getByRole('progressbar', { name: 'Questions checked' }).getAttribute('aria-valuenow')
    ).toBe('1')
    expect(view.getByText(first)).toBeTruthy()
    const results = view.getByRole('link', { name: /^View results$/ })
    expect(results.getAttribute('href')).toBe(pageHash('page-1', 'results'))
    expect(view.queryByRole('button', { name: 'More actions' })).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(results)
    })
  })

  it('shows the finished job’s totals, brand-prompt searches included (live run: 42 vs 52)', async () => {
    const first = 'How can I send text alerts?'
    const prompts = [buyerPrompt('p1', 1, first)]
    const base: CheckJob = {
      ...textboltJob(),
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['us-en'],
      done: 1,
      total: 1,
      searchesUsed: 22,
      searchesMax: 40,
      brandSearchesMax: 10,
      monthUsed: 42,
      monthLimit: 60,
      markets: [{ marketId: 'us-en', done: 1, total: 1, state: 'ok' as const }],
      steps: [searchStep('p1', 1, first, 'ok')]
    }
    let resolveStart: (value: CheckJob) => void = () => undefined
    let notify: ((event: CheckProgress) => void) | undefined
    const view = render(
      <RunningJob
        source={source({
          'checks:start': () =>
            new Promise<CheckJob>((resolve) => {
              resolveStart = resolve
            }),
          'checks:get': () => Promise.resolve(base),
          'checks:progress': (listener) => {
            notify = listener
            return () => undefined
          },
          'prompts:list': () => Promise.resolve({ ...emptyPromptSet(), prompts })
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Start first check' }))
    notify?.(progressFor(base))
    await waitFor(() => {
      expect(view.getByText(/searches used/).textContent).toContain('22 searches used so far')
    })
    // The brand prompts search after the last buyer prompt, with no progress push after.
    resolveStart({
      ...base,
      status: 'finished',
      finishedAt: base.startedAt,
      searchesUsed: 32,
      monthUsed: 52
    })
    await view.findByRole('heading', { level: 1, name: 'Check finished' })
    await waitFor(() => {
      expect(view.getByText(/searches used/).textContent).toBe(
        '32 searches used, up to 40 (incl. up to 10 for brand questions) · 52 of 60 this month'
      )
    })
  })

  it('offers Start again when checks:start resolves failed', async () => {
    const base = {
      ...textboltJob(),
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['us-en'],
      done: 0,
      total: 2,
      markets: [{ marketId: 'us-en', done: 0, total: 2, state: 'running' as const }],
      steps: [] as CheckStepSnapshot[]
    }
    let resolveStart: (value: CheckJob) => void = () => undefined
    let notify: ((event: CheckProgress) => void) | undefined
    const view = render(
      <RunningJob
        source={source({
          'checks:start': () =>
            new Promise<CheckJob>((resolve) => {
              resolveStart = resolve
            }),
          'checks:get': () => Promise.resolve(base),
          'checks:progress': (listener) => {
            notify = listener
            return () => undefined
          }
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Start first check' }))
    notify?.(progressFor(base))
    expect(
      await view.findByRole('heading', { name: 'Checking 2 questions in 1 market' })
    ).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    resolveStart({
      ...base,
      status: 'error',
      message: 'Every search key is out of searches.',
      nextStep: 'Open Connections and add a search key.',
      finishedAt: base.startedAt
    })
    expect((await view.findByRole('alert')).textContent).toBe(
      'Every search key is out of searches. Open Connections and add a search key.'
    )
    const start = view.getByRole('button', { name: 'Start first check' })
    expect(start.hasAttribute('disabled')).toBe(false)
    await waitFor(() => {
      expect(document.activeElement).toBe(start)
    })
    expect(view.queryByRole('heading', { name: 'Check finished' })).toBeNull()
    expect(view.getByText('No check is running.')).toBeTruthy()
    expect(view.queryByRole('progressbar')).toBeNull()
  })

  it('offers Start again when checks:start resolves cancelled', async () => {
    const base = {
      ...textboltJob(),
      projectId: 'proj-1',
      pageIds: ['page-1'],
      done: 1,
      total: 2
    }
    let resolveStart: (value: CheckJob) => void = () => undefined
    let notify: ((event: CheckProgress) => void) | undefined
    const view = render(
      <RunningJob
        source={source({
          'checks:start': () =>
            new Promise<CheckJob>((resolve) => {
              resolveStart = resolve
            }),
          'checks:get': () => Promise.resolve(base),
          'checks:progress': (listener) => {
            notify = listener
            return () => undefined
          }
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Start first check' }))
    notify?.(progressFor(base))
    expect(await view.findByRole('progressbar', { name: 'Questions checked' })).toBeTruthy()
    resolveStart({ ...base, status: 'cancelled', message: null, nextStep: null })
    expect((await view.findByRole('alert')).textContent).toBe('The check was cancelled.')
    expect(view.getByRole('button', { name: 'Start first check' }).hasAttribute('disabled')).toBe(
      false
    )
    expect(view.queryByRole('heading', { name: 'Check finished' })).toBeNull()
    expect(view.getByText('No check is running.')).toBeTruthy()
  })

  it('shows the IPC error and keeps Start first check usable', async () => {
    const refused = {
      ...textboltJob(),
      status: 'error' as const,
      message: "This check would pass the project's search cap.",
      nextStep: 'Raise the cap or wait until next month.'
    }
    let calls = 0
    const view = render(
      <RunningJob
        source={source({
          'checks:start': () => {
            calls += 1
            if (calls === 1) return Promise.resolve(refused)
            return Promise.reject(
              new Error(
                "Error invoking remote method 'checks:start': Error: checks:start: Add a search key before checking."
              )
            )
          }
        })}
        projectId="proj-1"
        pageId="page-1"
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Start first check' }))
    expect((await view.findByRole('alert')).textContent).toBe(
      "This check would pass the project's search cap. Raise the cap or wait until next month."
    )
    const start = view.getByRole('button', { name: 'Start first check' })
    expect(start.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(start)
    expect(view.queryByRole('progressbar')).toBeNull()
    fireEvent.click(start)
    expect((await view.findByRole('alert')).textContent).toBe('Add a search key before checking.')
    expect(view.getByRole('button', { name: 'Start first check' }).hasAttribute('disabled')).toBe(
      false
    )
    expect(view.queryByRole('heading', { name: /Checking/ })).toBeNull()
    expect(calls).toBe(2)
  })
})

describe('Results panel', () => {
  it('renders the empty results payload from results:get', async () => {
    const base = textboltResults()
    const payload: PageResults = {
      ...base,
      run: null,
      scope: { ...base.scope, checkedAt: null, stale: false, brands: ['Harbor'] }
    }
    const seen: unknown[] = []
    const view = render(
      <ResultsPanel
        source={source({
          'results:get': (request) => {
            seen.push(request)
            return Promise.resolve(payload)
          }
        })}
        projectId="proj-1"
        projectName="Harbor"
        page={TEXTBOLT_PAGE}
        pageId="page-1"
        marketId="us-en"
      />
    )
    expect(await view.findByRole('heading', { name: 'What this report covers' })).toBeTruthy()
    expect(view.getByText('No check in this market yet')).toBeTruthy()
    expect(view.getByText('No check yet')).toBeTruthy()
    expect(view.getByRole('link', { name: 'Check now' }).getAttribute('href')).toBe(
      runningHash('page-1')
    )
    expect(view.queryByText('No summary for this check yet.')).toBeNull()
    expect(view.queryByRole('heading', { name: 'Where visibility falls away' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'About this check' }))
    expect(
      within(view.getByRole('dialog', { name: 'About this check' })).getByText('Harbor')
    ).toBeTruthy()
    expect(view.queryByRole('heading', { level: 1, name: TEXTBOLT_PAGE.title })).toBeNull()
    expect(seen).toEqual([
      { projectId: 'proj-1', pageId: 'page-1', marketId: 'us-en', runId: null }
    ])
  })

  it('shows a bridge error without fixture copy', async () => {
    const view = render(
      <ResultsPanel
        source={source({
          'results:get': () => Promise.reject(new Error('The engine is busy.'))
        })}
        projectId="proj-1"
        projectName="Harbor"
        page={TEXTBOLT_PAGE}
        pageId="page-1"
        marketId={null}
      />
    )
    expect(await view.findByRole('alert')).toBeTruthy()
    expect(view.getByText('Could not load results.')).toBeTruthy()
    expect(view.getByText('The engine is busy.')).toBeTruthy()
    expect(view.queryByText('What this report covers')).toBeNull()
    expect(view.queryByText('Text alerts for business')).toBeNull()
  })

  it('loads again after a failed load when Try again is pressed', async () => {
    let calls = 0
    const view = render(
      <ResultsPanel
        source={source({
          'results:get': () => {
            calls += 1
            return calls === 1
              ? Promise.reject(new Error('The engine is busy.'))
              : Promise.resolve(textboltResults())
          }
        })}
        projectId="proj-1"
        projectName="Harbor"
        page={TEXTBOLT_PAGE}
        pageId="page-1"
        marketId={null}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Try again' }))
    expect(await view.findByRole('heading', { name: 'What this report covers' })).toBeTruthy()
    expect(view.queryByRole('alert')).toBeNull()
    expect(calls).toBe(2)
  })
})
