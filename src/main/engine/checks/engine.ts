import type {
  PageResults,
  PageScoreList,
  ProjectScoreList,
  PromptCheckDetail,
  ResultsHistory
} from '@shared/domain'
import type {
  CheckFinishedNotice,
  CheckJob,
  CheckProgress,
  GetPromptCheckRequest,
  GetResultsRequest,
  NotCitedList,
  NotCitedRequest,
  ResultsHistoryRequest,
  StartCheckRequest
} from '@shared/ipc'
import type { HttpTransport } from '../../providers/http'
import { capAllowance } from '../../queue/usage'
import type { CheckRunner, CheckRunResult, CheckSearch } from '../../queue/runner'
import type { RunningJob } from '../../queue/types'
import type { Logger } from '../../logging/logger'
import type { GenerationCallCaps } from '../../pipeline/llm'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import type { SecretStore } from '../../secrets/secret-store'
import type { AppStorage } from '../../storage/app-storage'
import {
  finishStoredCheckJob,
  finishStoredRun,
  insertStoredRun,
  listStoredCheckRuns,
  listStoredCheckSteps,
  listStoredRunsForJob
} from '../../storage/check-records'
import { setPageMarketBaselineRunId, setPageMarketLastCheckedAt } from '../../storage/pages'
import { closeProjectDatabase } from '../../storage/project-files'
import type { SqliteDatabase } from '../../storage/database'
import { classifySample } from './classify'
import { runEngines } from '../../storage/engine-records'
import { unitsCostMicros } from '@shared/domain'
import { jobEnded, jobMix, type LiveDeps } from './live-results'
import {
  createKeyRotation,
  createCapGate,
  projectUsedForMonth,
  type EngineRotation
} from './key-rotation'
import { loadPageScoreList, loadProjectScoreList } from './glance'
import { loadNotCited } from './not-cited'
import {
  CheckInputError,
  filterFor,
  loadPageResults,
  loadPromptDetail,
  loadResultsHistory
} from './results'
import { checkReportsRoot } from './report-files'
import { limitRotation, providerLimiter } from './check-pace'
import { checkMarketQuestions } from './market-questions'
import { reportCapStop, type CapStopEvent } from './cap-stop'
import { createReportRunner, type ReportRunner } from './report-runner'
import {
  bumpMarket,
  emit,
  finishMemory,
  hydrateJob,
  isTerminalStep,
  promptKey,
  rememberRun
} from './job-progress'
import { captureBrandPrompts } from '../sentiment/capture'
import { competitorsOf, prepare, type CheckRequest, type Prepared } from './prepare'
import { resumeInterrupted } from './resume'
import {
  countSearches,
  haltJob,
  keyLabels,
  pageCitedDelta,
  publishPageScore,
  stopForCap,
  systemZone,
  trackedUrls,
  withProject,
  withSpend
} from './engine-helpers'

export interface CheckEngineDeps {
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  now: () => Date
  createId: () => string
  emitProgress: (event: CheckProgress) => void
  emitFinished: (event: CheckFinishedNotice) => void
  emitResultsChanged?: LiveDeps['emitResultsChanged']
  knownSecrets?: () => readonly string[]
  sleep?: (ms: number) => Promise<void>
  timeZone?: string
  /**
   * Claude for `aio_gap.md` and `run_summary.md` (FR-6.6, FR-12.3).
   * When this is omitted, a finished run still scores and stores captures.
   * The report step is skipped and logged, and the two files are not written.
   */
  claude?: ClaudeProvider
  /** FR-11.7. Each job's project connection and fallback for its reports. */
  claudeFor?: (projectId: string) => ClaudeProvider | undefined
  /**
   * Daily and monthly Claude call caps for the report step.
   * The same caps `completeStructured` uses for every other generation.
   * Omit this for the shared default.
   */
  generationCaps?: GenerationCallCaps
  /**
   * FR-16.2. Read each finished full run's overviews for brand sentiment after
   * the reports. Production sets this; tests that count report calls leave it off.
   */
  readSentiment?: boolean
  /**
   * Test seam. Resolves before each SerpApi attempt so cancel can win the race.
   * Production waits one event-loop turn instead, which is enough for `checks:cancel`.
   */
  beforeRequest?: () => Promise<void>
  /** FR-11.4. Called when a check stops at the project's search cap, before or during it. */
  onCapStop?: (event: CapStopEvent) => void
  /** Questions of one market checked at once. Default `CHECK_QUESTIONS_AT_ONCE`. */
  questionsAtOnce?: number
}

export interface CheckRunOptions {
  /**
   * Write each SerpApi search to `key_usage` from the capture, as it happens.
   * Default true. Scheduled runs keep it on too and report each search with
   * its key, so the queue counts it without storing it twice.
   */
  chargeUsage?: boolean
}

export interface CheckEngine {
  start(request: CheckRequest, options?: CheckRunOptions): Promise<CheckJob>
  /** Stops later provider calls. The in-flight HTTP call may finish and is stored. */
  cancel(jobId: string): Promise<CheckJob>
  /**
   * Continues jobs left `running` by a quit or crash (NFR-3).
   * A `cancelled` job is terminal and is not resumed.
   */
  resumeInterrupted(): Promise<readonly CheckJob[]>
  get(jobId: string): CheckJob
  listActive(projectId: string | null): CheckJob[]
  /** True while this process is running a check of this page. Stored rows do not count. */
  pageRunning(projectId: string, pageId: string): boolean
  getPrompt(request: GetPromptCheckRequest): PromptCheckDetail
  results(request: GetResultsRequest): PageResults
  history(request: ResultsHistoryRequest): ResultsHistory
  /** `checks:notCited`: each page's questions not cited last time. */
  notCited(request: NotCitedRequest): NotCitedList
  listProjectScores(): ProjectScoreList
  listPageScores(projectId: string): PageScoreList
  searchesFor(jobId: string): readonly CheckSearch[]
  /**
   * Resolves when the reports queued by finished jobs are written or stopped.
   * Reports run after a job's searches, so `start` does not wait for Claude.
   * The headless pass awaits this before it closes storage.
   */
  reportsIdle(): Promise<void>
}

interface CancelControl {
  requested: boolean
  settled: boolean
  resolve: (job: CheckJob) => void
  promise: Promise<CheckJob>
}

export function createCheckEngine(deps: CheckEngineDeps): CheckEngine {
  const jobs = new Map<string, CheckJob>()
  const slots = new Map<string, CheckSearch[]>()
  const controls = new Map<string, CancelControl>()
  const zone = deps.timeZone ?? systemZone()
  const reports = createReportRunner(deps)
  const engine: CheckEngine = {
    start: (request, options) =>
      start(deps, jobs, slots, controls, zone, reports, request, options),
    cancel(jobId) {
      const job = jobs.get(jobId)
      if (job === undefined) throw new CheckInputError('Unknown job')
      if (job.status !== 'running') {
        // The searches are done. A cancel now stops the job's report.
        reports.abort(jobId)
        return Promise.resolve(job)
      }
      const control = controls.get(jobId)
      if (control === undefined) throw new CheckInputError('Unknown job')
      control.requested = true
      return control.promise
    },
    resumeInterrupted: () =>
      resumeInterrupted(deps, {
        running: (jobId) => jobs.get(jobId)?.status === 'running',
        restart: (target) =>
          start(deps, jobs, slots, controls, zone, reports, {
            projectId: target.projectId,
            pageIds: target.job.pageIds,
            marketIds: target.job.marketIds,
            promptIds: target.job.promptIds,
            reason: target.job.reason,
            jobId: target.job.id,
            resume: true
          }),
        fail(jobId, finishedAt, message) {
          const current = jobs.get(jobId)
          if (current !== undefined && current.status === 'running') {
            jobs.set(jobId, finishMemory(current, 'error', finishedAt, message, null))
          }
          const control = controls.get(jobId)
          const settledJob = jobs.get(jobId)
          if (control !== undefined && settledJob !== undefined) settle(control, settledJob)
        }
      }),
    get(jobId) {
      const job = jobs.get(jobId)
      if (job === undefined) throw new CheckInputError('Unknown job')
      return job
    },
    listActive(projectId) {
      return [...jobs.values()].filter(
        (job) => job.status === 'running' && (projectId === null || job.projectId === projectId)
      )
    },
    pageRunning(projectId, pageId) {
      return [...jobs.values()].some(
        (job) =>
          job.status === 'running' && job.projectId === projectId && job.pageIds.includes(pageId)
      )
    },
    getPrompt(request) {
      return withProject(deps, request.projectId, (db, domain) =>
        loadPromptDetail(db, {
          ...request,
          builtAt: deps.now().toISOString(),
          domain,
          keyLabels: keyLabels(deps),
          reportsRoot: checkReportsRoot(deps.storage.paths.root)
        })
      )
    },
    results(request) {
      return withProject(deps, request.projectId, (db, domain) =>
        loadPageResults(db, {
          ...request,
          builtAt: deps.now().toISOString(),
          domain,
          keyLabels: keyLabels(deps),
          reportsRoot: checkReportsRoot(deps.storage.paths.root)
        })
      )
    },
    history(request) {
      return withProject(deps, request.projectId, (db, domain) =>
        loadResultsHistory(db, {
          projectId: request.projectId,
          pageId: request.pageId,
          marketId: request.marketId,
          builtAt: deps.now().toISOString(),
          domain
        })
      )
    },
    notCited(request) {
      return withProject(deps, request.projectId, (db) => loadNotCited(db, request))
    },
    listProjectScores: () => loadProjectScoreList(deps.storage, deps.now(), zone),
    listPageScores: (projectId) => loadPageScoreList(deps.storage, projectId, deps.now(), zone),
    searchesFor(jobId) {
      return slots.get(jobId) ?? []
    },
    reportsIdle: () => reports.idle()
  }
  return engine
}

/**
 * Startup resume (NFR-3). Pass the engine that also serves `checks:cancel`
 * and the scheduled runner, so one job map is resumed.
 * A stored `running` job this call does not restart is stored as `error`.
 */
export function resumeInterruptedChecks(engine: CheckEngine): Promise<readonly CheckJob[]> {
  return engine.resumeInterrupted()
}

export async function runCheck(
  deps: CheckEngineDeps,
  request: CheckRequest
): Promise<readonly string[]> {
  const job = await createCheckEngine(deps).start(request)
  return job.runIds
}

/**
 * `createCheckRunner` reports a user cancel as an error with this message.
 * Callers match the exact sentence and map it to `cancelled`.
 */
export const CHECK_CANCELLED_MESSAGE = 'Check cancelled.'

export function createCheckRunner(
  deps: CheckEngineDeps,
  engine: CheckEngine = createCheckEngine(deps)
): CheckRunner {
  return {
    async run(job: RunningJob): Promise<CheckRunResult> {
      try {
        const finished = await engine.start(
          {
            projectId: job.projectId,
            pageIds: [job.pageId],
            marketIds: job.marketIds.length > 0 ? job.marketIds : null,
            promptIds: job.promptIds,
            reason: job.reason,
            jobId: job.id
          },
          // Each search is stored as it is made, with the key that made it (SERP-6).
          { chargeUsage: true }
        )
        const searches = engine.searchesFor(finished.id)
        if (finished.status === 'cancelled') {
          return { outcome: 'error', message: CHECK_CANCELLED_MESSAGE, searches }
        }
        if (finished.status === 'error') {
          return { outcome: 'error', message: finished.message ?? 'Check failed.', searches }
        }
        return {
          outcome: 'ok',
          searches,
          ...(finished.runIds[0] ? { runId: finished.runIds[0] } : {})
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Check failed.'
        return { outcome: 'error', message, searches: [] }
      }
    }
  }
}

async function start(
  deps: CheckEngineDeps,
  jobs: Map<string, CheckJob>,
  slots: Map<string, CheckSearch[]>,
  controls: Map<string, CancelControl>,
  zone: string,
  reports: ReportRunner,
  request: CheckRequest,
  options?: CheckRunOptions
): Promise<CheckJob> {
  const prepared = prepare(deps, jobs, slots, zone, request)
  if (prepared.db === null) {
    if (prepared.capBlocked === true) reportCapStop(deps, prepared)
    return prepared.job
  }
  const control = createCancelControl()
  controls.set(prepared.job.id, control)
  try {
    const executed = await execute(
      deps,
      jobs,
      slots,
      prepared,
      control,
      options?.chargeUsage !== false
    )
    const finished = withSpend(jobs, prepared, executed)
    scheduleReports(reports, prepared.db, prepared, finished)
    jobEnded(deps, finished)
    settle(control, finished)
    return finished
  } catch (error) {
    const message = error instanceof CheckInputError ? error.message : 'The check could not finish.'
    deps.logger.error('check failed', { message })
    const stopped = finishMemory(prepared.job, 'error', deps.now().toISOString(), message, null)
    jobs.set(stopped.id, stopped)
    finishStoredCheckJob(
      prepared.db,
      stopped.id,
      stopped.finishedAt ?? stopped.startedAt,
      'error',
      stopped.searchesUsed,
      message,
      null
    )
    const failed = withSpend(jobs, prepared, stopped)
    scheduleReports(reports, prepared.db, prepared, failed)
    jobEnded(deps, failed)
    settle(control, failed)
    return failed
  } finally {
    closeProjectDatabase(prepared.db)
  }
}

/**
 * Reports for every finished run of the job, including runs a resumed job
 * finished before a quit. A cancelled job asks for no report.
 */
function scheduleReports(
  reports: ReportRunner,
  db: SqliteDatabase,
  prepared: Prepared,
  job: CheckJob
): void {
  if (job.status === 'cancelled') return
  // Reports read Google AI Overview samples: a run of other engines alone has none.
  const runIds = listStoredRunsForJob(db, job.projectId, job.id)
    .filter((run) => run.status === 'finished' && runEngines(db, run.id).includes('google_aio'))
    .map((run) => run.id)
  reports.schedule({ id: job.id, projectId: job.projectId, domain: prepared.domain }, runIds)
}

function createCancelControl(): CancelControl {
  let resolve: (job: CheckJob) => void = () => undefined
  const promise = new Promise<CheckJob>((done) => {
    resolve = done
  })
  return { requested: false, settled: false, resolve, promise }
}

function settle(control: CancelControl, job: CheckJob): void {
  if (control.settled) return
  control.settled = true
  control.resolve(job)
}

async function execute(
  deps: CheckEngineDeps,
  jobs: Map<string, CheckJob>,
  slots: Map<string, CheckSearch[]>,
  prepared: Prepared,
  control: CancelControl,
  chargeUsage: boolean
): Promise<CheckJob> {
  const db = prepared.db
  if (db === null) return prepared.job
  const tracked = trackedUrls(db, prepared.job.projectId)
  const rotationContext = {
    project: prepared.queueProject,
    usageProjectId: prepared.job.projectId,
    month: prepared.month,
    chargeUsage,
    onSearch: (keyId: string) => {
      const bag = slots.get(prepared.job.id) ?? []
      // A charged search names its key, so the queue counts it there and does not store it again.
      bag.push(
        chargeUsage
          ? { slotId: `search-${bag.length + 1}`, keyId }
          : { slotId: `search-${bag.length + 1}` }
      )
      slots.set(prepared.job.id, bag)
    }
  }
  // Questions run a few at once; each provider's calls share one app-wide limit
  // (check-pace.ts), and the job's first call to it goes alone.
  const rotation = limitRotation(
    createKeyRotation(deps, { ...rotationContext, provider: prepared.provider }),
    providerLimiter(deps.storage.db, prepared.provider)
  )
  // Answer engines always go through cloro, also when SerpApi runs the Google search.
  const answers: EngineRotation =
    prepared.provider === 'cloro'
      ? rotation
      : limitRotation(
          createKeyRotation(deps, { ...rotationContext, provider: 'cloro' }),
          providerLimiter(deps.storage.db, 'cloro')
        )
  const answersOff = { value: !prepared.withCloro }
  const cap = prepared.queueProject.cap
  const gate = createCapGate({
    allowance: cap === null ? null : capAllowance(cap, prepared.queueProject.capRule),
    // Live usage, so a manual check and a queued check of this project share one cap.
    used: chargeUsage
      ? () => projectUsedForMonth(deps.storage, prepared.job.projectId, prepared.month)
      : prepared.projectUsed,
    cancelled: () => control.requested,
    beforeRequest:
      deps.beforeRequest ?? (() => new Promise<void>((resolve) => setImmediate(resolve)))
  })
  const storedRuns = listStoredRunsForJob(db, prepared.job.projectId, prepared.job.id)
  const storedSteps = listStoredCheckSteps(db, prepared.job.id)
  hydrateJob(prepared.job, storedSteps, storedRuns)
  prepared.job.mix = jobMix(db, prepared.plan)
  const donePrompts = new Set(
    storedSteps
      .filter((step) => step.phase === 'analysis' && isTerminalStep(step.state))
      .map((step) => promptKey(step.pageId, step.marketId, step.promptId))
  )
  for (const page of prepared.plan) {
    if (control.requested) return haltJob(deps, jobs, db, prepared)
    const pageStarted = storedRuns.some((run) => run.pageId === page.pageId)
    if (!pageStarted) {
      emit(
        deps,
        prepared.job,
        page.pageId,
        null,
        null,
        null,
        'reread',
        'running',
        'Reading the saved page.',
        null,
        null,
        0
      )
      emit(
        deps,
        prepared.job,
        page.pageId,
        null,
        null,
        null,
        'reread',
        'ok',
        'Using the saved snapshot.',
        null,
        null,
        0
      )
    }
    for (const market of page.markets) {
      if (control.requested) return haltJob(deps, jobs, db, prepared)
      const existing = storedRuns.find(
        (run) => run.pageId === page.pageId && run.marketId === market.id
      )
      if (existing?.status === 'finished' || existing?.status === 'cancelled') {
        rememberRun(prepared.job, existing.id)
        if (existing.status === 'finished') {
          for (const prompt of page.prompts) {
            const key = promptKey(page.pageId, market.id, prompt.id)
            if (donePrompts.has(key)) continue
            prepared.job.done += 1
            bumpMarket(prepared.job, market.id)
            donePrompts.add(key)
          }
        }
        continue
      }
      const earlier = listStoredCheckRuns(
        db,
        filterFor(prepared.job.projectId, page.pageId, market.id)
      ).filter((run) => run.status === 'finished' && !run.partial)
      const latest = earlier.at(-1) ?? null
      const partial = prepared.job.promptIds !== null
      const fresh =
        latest === null ||
        latest.promptSetId !== page.promptSetId ||
        latest.samples !== page.samples ||
        market.addedAt > (latest.finishedAt ?? latest.startedAt)
      const kind =
        existing?.kind ??
        (partial
          ? 'follow_up'
          : fresh
            ? 'baseline'
            : prepared.reason === 'scheduled' || prepared.reason === 'catch_up'
              ? 'scheduled'
              : 'manual')
      const runId = existing?.id ?? deps.createId()
      if (existing === undefined) {
        insertStoredRun(db, {
          id: runId,
          jobId: prepared.job.id,
          pageId: page.pageId,
          promptSetId: page.promptSetId,
          snapshotId: page.snapshotId,
          marketId: market.id,
          startedAt: deps.now().toISOString(),
          kind,
          partial,
          samples: page.samples,
          contentHash: page.contentHash,
          engines: page.engines
        })
      }
      rememberRun(prepared.job, runId)
      const outcome = await checkMarketQuestions({
        deps,
        db,
        prepared,
        page,
        market,
        runId,
        resumed: existing !== undefined,
        donePrompts,
        tracked,
        rotation,
        answers,
        gate,
        control,
        answersOff,
        ...(deps.questionsAtOnce !== undefined ? { atOnce: deps.questionsAtOnce } : {})
      })
      if (outcome === 'keys' || outcome === 'project') {
        return stopForCap(deps, jobs, db, prepared, outcome)
      }
      if (outcome === 'cancel') return haltJob(deps, jobs, db, prepared)
      const googleOn = page.engines.includes('google_aio')
      // FR-16.1: brand prompts, after the buyer prompts, stored apart from visibility.
      const brand = await captureBrandPrompts({
        db,
        runId,
        market,
        prompts: page.brandPrompts,
        rotation,
        gate,
        createId: deps.createId,
        now: () => deps.now().toISOString(),
        cancelled: () => control.requested,
        classify: (references) =>
          classifySample({
            failed: false,
            hasAio: true,
            aioText: null,
            references,
            targetUrl: page.url,
            targetPage: page.targetPage,
            ownDomain: prepared.domain,
            includeSubdomains: prepared.includeSubdomains,
            brandNames: prepared.brands,
            competitors: competitorsOf(prepared, page.pageId),
            trackedUrls: tracked
          }).references,
        countSearches: (searches) => countSearches(prepared, searches),
        costOf: (keyId, searches, credits) =>
          unitsCostMicros(
            rotation.provider === 'cloro' ? credits : searches,
            prepared.pricing.planFor(keyId, rotation.provider)
          )
      })
      if (brand === 'keys') return stopForCap(deps, jobs, db, prepared, 'keys')
      if (brand === 'cancel') return haltJob(deps, jobs, db, prepared)
      const finishedAt = deps.now().toISOString()
      finishStoredRun(db, runId, finishedAt, 'finished')
      // The baseline and the score are Google AI Overview numbers.
      if (kind === 'baseline' && googleOn) {
        setPageMarketBaselineRunId(db, page.pageId, market.id, runId)
      }
      setPageMarketLastCheckedAt(db, page.pageId, market.id, finishedAt)
      if (market.id === page.defaultMarketId && googleOn) publishPageScore(deps, db, prepared, page)
    }
    if (control.requested) return haltJob(deps, jobs, db, prepared)
    publishPageScore(deps, db, prepared, page)
    const results = loadPageResults(db, {
      projectId: prepared.job.projectId,
      pageId: page.pageId,
      marketId: page.defaultMarketId,
      runId: null,
      builtAt: deps.now().toISOString(),
      domain: prepared.domain,
      keyLabels: keyLabels(deps)
    })
    const noticeMarket = results.run?.marketId ?? page.markets[0]?.id ?? page.defaultMarketId
    // Section 7.4: a follow-up job leaves the headline alone, so it reports no change.
    const followUp = prepared.job.promptIds !== null
    deps.emitFinished({
      jobId: prepared.job.id,
      projectId: prepared.job.projectId,
      pageId: page.pageId,
      pageLabel: page.label,
      marketId: noticeMarket,
      pageCited: results.run?.pageCited ?? 0,
      aiosShown: results.run?.promptsWithAio ?? 0,
      pageCitedChange: followUp ? null : pageCitedDelta(results),
      score: results.run?.visibilityScore ?? null,
      scoreChange: followUp ? null : results.scoreChange.sincePrevious,
      contentChanged: followUp ? false : (results.run?.contentChanged ?? false)
    })
  }
  const finishedAt = deps.now().toISOString()
  const finished = finishMemory(prepared.job, 'finished', finishedAt, null, null)
  jobs.set(finished.id, finished)
  finishStoredCheckJob(db, finished.id, finishedAt, 'finished', finished.searchesUsed, null, null)
  return finished
}

export type { CheckRequest, StartCheckRequest }
