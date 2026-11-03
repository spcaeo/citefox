import { CHECK_SLOWED_NOTICE } from '@shared/domain'
import type { CheckJob, CheckMarketProgress, CheckProgress, CheckStepSnapshot } from '@shared/ipc'
import {
  insertStoredCheckStep,
  type StoredCheckRun,
  type StoredCheckStep
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { checkDomainOf, inFlightItems, lastDoneOf } from './in-flight'
import type { PagePlan, PromptPlan } from './plan'

/**
 * In-memory job state, stored check steps, and `checks:progress` pushes for one
 * check job (FR-5.6, NFR-3). The engine owns the job; these keep its counts,
 * steps, and markets in step with storage.
 */
export interface ProgressDeps {
  emitProgress: (event: CheckProgress) => void
  now: () => Date
}

/** The request fields a job snapshot echoes. */
export interface JobScope {
  projectId: string
  pageIds: readonly string[]
  marketIds: readonly string[] | null
  promptIds: readonly string[] | null
}

/** FR-8.6 skip: the prompt has no wording in the market's language. */
export const SKIPPED_NO_WORDING = "Skipped: this prompt has no wording in this market's language."

export function skipPrompt(
  deps: ProgressDeps,
  db: SqliteDatabase,
  job: CheckJob,
  page: PagePlan,
  marketId: string,
  prompt: PromptPlan
): void {
  rememberStep(
    deps,
    db,
    job,
    page,
    marketId,
    prompt,
    0,
    'analysis',
    'warning',
    SKIPPED_NO_WORDING,
    {
      errorCode: null,
      message: SKIPPED_NO_WORDING,
      nextStep: 'Add wording for this market on the prompts screen.'
    },
    0
  )
  job.done += 1
  bumpMarket(job, marketId)
  emit(
    deps,
    job,
    page.pageId,
    marketId,
    prompt.id,
    null,
    'analysis',
    'warning',
    SKIPPED_NO_WORDING,
    null,
    null,
    0
  )
}

export function hydrateJob(
  job: CheckJob,
  steps: readonly StoredCheckStep[],
  runs: readonly StoredCheckRun[]
): void {
  const analysis = steps.filter((step) => step.phase === 'analysis' && isTerminalStep(step.state))
  job.done = analysis.length
  job.markets = job.markets.map((market) => {
    const done = analysis.filter((step) => step.marketId === market.marketId).length
    const state: CheckMarketProgress['state'] =
      done <= 0 ? 'waiting' : done >= market.total ? 'ok' : 'running'
    return { ...market, done, state }
  })
  job.runIds = runs.map((run) => run.id)
  const phaseRank: Record<CheckStepSnapshot['phase'], number> = {
    reread: 0,
    search: 1,
    aio: 2,
    analysis: 3
  }
  const collapsed: CheckStepSnapshot[] = []
  for (const step of steps) {
    const snapshot = snapshotFromStored(step)
    const kept = collapsed.filter(
      (item) =>
        !(
          item.pageId === snapshot.pageId &&
          item.marketId === snapshot.marketId &&
          item.promptId === snapshot.promptId &&
          item.phase === snapshot.phase
        )
    )
    kept.push(snapshot)
    collapsed.splice(0, collapsed.length, ...kept)
  }
  job.steps = collapsed.sort(
    (left, right) =>
      left.promptPosition - right.promptPosition ||
      (left.sampleNo ?? 0) - (right.sampleNo ?? 0) ||
      phaseRank[left.phase] - phaseRank[right.phase]
  )
}

export function snapshotFromStored(step: StoredCheckStep): CheckStepSnapshot {
  return {
    pageId: step.pageId,
    marketId: step.marketId,
    promptId: step.promptId,
    promptPosition: step.promptPosition,
    label: step.label,
    promptText: step.promptText,
    sampleNo: step.sampleNo === 0 ? null : step.sampleNo,
    phase: step.phase,
    state: step.state,
    detail: step.detail,
    errorCode: step.errorCode,
    error: step.error,
    retrySearches: step.retrySearches
  }
}

export function rememberRun(job: CheckJob, runId: string): void {
  if (job.runIds.includes(runId)) return
  job.runIds = [...job.runIds, runId]
}

export function promptKey(pageId: string, marketId: string, promptId: string): string {
  return `${pageId}\n${marketId}\n${promptId}`
}

export function isTerminalStep(state: CheckStepSnapshot['state']): boolean {
  return state === 'ok' || state === 'warning' || state === 'error'
}

export function rememberStep(
  deps: ProgressDeps,
  db: SqliteDatabase,
  job: CheckJob,
  page: PagePlan,
  marketId: string,
  prompt: PromptPlan,
  sampleNo: number,
  phase: CheckStepSnapshot['phase'],
  state: CheckStepSnapshot['state'],
  detail: string,
  captured: {
    errorCode: CheckProgress['errorCode']
    message: string | null
    nextStep: string | null
  },
  retrySearches: number
): void {
  const step: CheckStepSnapshot = {
    pageId: page.pageId,
    marketId,
    promptId: prompt.id,
    promptPosition: prompt.position,
    label: prompt.label,
    promptText: prompt.textByMarket.get(marketId) ?? '',
    sampleNo: sampleNo === 0 ? null : sampleNo,
    phase,
    state,
    detail,
    errorCode: state === 'ok' ? null : captured.errorCode,
    error: state === 'ok' ? null : captured.message,
    retrySearches
  }
  job.steps = [
    ...job.steps.filter(
      (item) =>
        !(
          item.pageId === step.pageId &&
          item.marketId === step.marketId &&
          item.promptId === step.promptId &&
          item.phase === step.phase
        )
    ),
    step
  ]
  insertStoredCheckStep(db, {
    ...step,
    jobId: job.id,
    sampleNo,
    errorCode: step.errorCode,
    error: step.error,
    updatedAt: deps.now().toISOString()
  })
  if (phase !== 'analysis') {
    emit(
      deps,
      job,
      page.pageId,
      marketId,
      prompt.id,
      step.sampleNo,
      phase,
      state,
      detail,
      state === 'ok' ? null : captured.nextStep,
      step.errorCode,
      retrySearches,
      step.promptText
    )
  }
}

/** Jobs that run slower for now (a rate limit), until this time in milliseconds. */
const slowedUntil = new WeakMap<CheckJob, number>()

/** The check runs slower until `untilMs`; progress events carry the notice meanwhile. */
export function markSlowed(job: CheckJob, untilMs: number): void {
  slowedUntil.set(job, Math.max(untilMs, slowedUntil.get(job) ?? 0))
}

export function emit(
  deps: ProgressDeps,
  job: CheckJob,
  pageId: string,
  marketId: string | null,
  promptId: string | null,
  sampleNo: number | null,
  phase: CheckProgress['phase'],
  state: CheckProgress['state'],
  detail: string,
  nextStep: string | null,
  errorCode: CheckProgress['errorCode'],
  retrySearches: number,
  promptText?: string
): void {
  deps.emitProgress({
    jobId: job.id,
    projectId: job.projectId,
    pageId,
    marketId,
    promptId,
    sampleNo,
    phase,
    state,
    detail,
    nextStep,
    errorCode,
    retrySearches,
    done: job.done,
    total: job.total,
    searchesUsed: job.searchesUsed,
    searchesMax: job.searchesMax,
    monthUsed: job.monthUsed,
    monthLimit: job.monthLimit,
    markets: job.markets,
    // The Check window's words: the question, the questions/keywords split, credits so far.
    ...(promptText ? { promptText } : {}),
    ...(job.mix ? { mix: job.mix } : {}),
    ...(job.creditsUsed !== undefined ? { creditsUsed: job.creditsUsed } : {}),
    ...((slowedUntil.get(job) ?? 0) > deps.now().getTime()
      ? { slowedNotice: CHECK_SLOWED_NOTICE }
      : {}),
    ...inFlightFields(job)
  })
}

/** The questions being checked now, one by one, and the one scored last. */
function inFlightFields(
  job: CheckJob
): Pick<CheckProgress, 'inFlight' | 'inFlightItems' | 'lastDone' | 'domain'> {
  const items = inFlightItems(job)
  const lastDone = lastDoneOf(job)
  const domain = checkDomainOf(job)
  return {
    ...(items.length > 0 ? { inFlight: items.length, inFlightItems: items } : {}),
    ...(lastDone !== null ? { lastDone } : {}),
    ...(domain !== null ? { domain } : {})
  }
}

export function bumpMarket(job: CheckJob, marketId: string): void {
  job.markets = job.markets.map((market) => {
    if (market.marketId !== marketId) return market
    const done = market.done + 1
    const state: CheckMarketProgress['state'] = done >= market.total ? 'ok' : 'running'
    return { ...market, done, state }
  })
}

export function liveJob(
  request: JobScope,
  id: string,
  startedAt: string,
  monthUsed: number,
  monthLimit: number | null,
  total: number,
  searchesMax: number,
  plan: readonly PagePlan[],
  brandSearchesMax = 0
): CheckJob {
  const counts = new Map<string, number>()
  for (const page of plan) {
    for (const market of page.markets) {
      counts.set(market.id, (counts.get(market.id) ?? 0) + page.prompts.length)
    }
  }
  return {
    id,
    projectId: request.projectId,
    pageIds: request.pageIds,
    marketIds: request.marketIds,
    promptIds: request.promptIds,
    status: 'running',
    startedAt,
    finishedAt: null,
    done: 0,
    total,
    searchesUsed: 0,
    searchesMax,
    brandSearchesMax,
    monthUsed,
    monthLimit,
    runIds: [],
    markets: [...counts.entries()].map(([marketId, marketTotal]) => ({
      marketId,
      done: 0,
      total: marketTotal,
      state: 'waiting'
    })),
    steps: [],
    message: null,
    nextStep: null
  }
}

export function errorJob(
  request: JobScope,
  id: string,
  startedAt: string,
  message: string,
  nextStep: string | null,
  monthUsed: number,
  monthLimit: number | null,
  total: number,
  searchesMax: number
): CheckJob {
  return {
    ...liveJob(request, id, startedAt, monthUsed, monthLimit, total, searchesMax, []),
    status: 'error',
    finishedAt: startedAt,
    message,
    nextStep
  }
}

export function finishMemory(
  job: CheckJob,
  status: 'finished' | 'cancelled' | 'error',
  finishedAt: string,
  message: string | null,
  nextStep: string | null
): CheckJob {
  return {
    ...job,
    status,
    finishedAt,
    message: status === 'error' ? message : null,
    nextStep: status === 'error' ? nextStep : null
  }
}
