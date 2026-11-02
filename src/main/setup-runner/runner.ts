import { CLAUDE_ASK_NOTICE } from '@shared/domain'
import type {
  PagePipeline,
  SetupProgress,
  SetupRateRequest,
  SetupRetryRequest,
  SetupRunStep,
  SetupStatus
} from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { runWithProgress, type AssistProgressEmit } from '../assist/progress'
import { pageSetupDeps } from '../engine/setup-deps'
import { IpcRequestError } from '../ipc-request'
import { redactString } from '../logging/redact'
import { CLAUDE_RETRY } from '../notices/claude-ask'
import { onNoticeResolved } from '../notices/service'
import type { PageSetupDeps } from '../pipeline/setup'
import { inQuiet } from '../scheduler/release'
import type { SqliteDatabase } from '../storage/database'
import {
  clearFirstCheckWaits,
  firstCheckWaits,
  markCheckWhenReady,
  pageCheckWhenReady,
  readCheckWhenReady
} from '../storage/first-check-waits'
import {
  deletePageSetupJob,
  getPageSetupJob,
  getSetupCandidate,
  listSetupCandidates,
  listSetupStartsSince,
  resetPageSetupJobs,
  writePageSetupJob,
  type PageSetupJob,
  type SetupCandidate
} from '../storage/page-setup-jobs'
import { readProjectSchedule } from '../storage/project-schedule'
import { listProjects, type ProjectRecord } from '../storage/records'
import { readSetupRunnerSettings, writeSetupRunnerSettings } from '../storage/setup-runner-settings'
import {
  ASK_RETRY_MS,
  MAX_SETUP_ATTEMPTS,
  MISSING_CONNECTION_RETRY_MS,
  SETUP_BACKOFF_MS,
  SETUP_FIRST_TICK_MS,
  SETUP_TICK_MS,
  THROTTLE_WINDOW_MS
} from './constants'
import { SETUP_FAILED_NOTICE, SETUP_RETRY } from './notice'
import { buildPagePipeline, needsConnection, STOPPED_BY_USER } from './pipeline'
import { runSetupSteps, type SetupRunOutcome } from './run-page'
import { compareCandidates, holdFor } from './select'
import { computeSetupStatus, openPooled, runKey } from './status'
import { pluralize } from '@shared/pluralize'
import { SETUP_PROGRESS_CHANNEL } from '@shared/ipc'

export interface SetupRunnerTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export interface SetupRunnerDeps {
  host: EngineHost
  /** `setup:progress`. Omitted headless. */
  emit?: (progress: SetupProgress) => void
  /** The computer's zone, read on every use. */
  timeZone?: () => string
  timers?: SetupRunnerTimers
  /** Test seam: the pipeline dependencies for one page. Production uses `pageSetupDeps`. */
  setupDeps?: (db: SqliteDatabase, projectId: string) => PageSetupDeps
  /**
   * Setup finished on a page whose project checks automatically when ready: start
   * its first check (the same path as "Start first check"). Omitted: nothing starts.
   */
  startFirstCheck?: (projectId: string, pageId: string) => void
  /** Live steps (page reads, Claude calls) for the page tabs' setup panel. Omitted headless. */
  emitAssistProgress?: AssistProgressEmit
  /** A page gave up after its retries: record the "ask me" notice. Omitted headless. */
  onGaveUp?: (failure: {
    projectId: string
    pageId: string
    pageName: string
    reason: string
    nextStep: string | null
  }) => void
}

/**
 * The background page setup runner (FR-20.6, SCH-12). The window and the tray
 * run it on a wall-clock tick; `citefox --check-due` runs it inside its budget.
 */
export interface SetupRunner {
  /** Starts the wall-clock loop (the GUI). */
  start(): void
  /** Stops the loop and asks running pages to stop after their current step. Never blocks. */
  stop(): void
  /** One pass: starts as many pages as the slots, the throttle, and the holds allow. */
  pump(): number
  /**
   * Starts this page's setup now (a single add, Retry, Resume, or Write content
   * gaps): no throttle, quiet-hour or stagger hold, and a tracked page fills the
   * steps it is missing. `auto` (a single add) starts only while the loop runs, so
   * CITEFOX_SETUP_RUNNER=off keeps added pages still; a user's Start always runs.
   * Returns the page's state. `checkWhenReady` (Add a page › Add and check now)
   * starts this page's first check once setup is ready, as the project-wide
   * "check automatically when ready" does. The ask is stored with the page's
   * first-check wait (project migration 042), so a restart before then still
   * starts it when setup is ready, and the page shows it as pending meanwhile.
   */
  startPage(
    projectId: string,
    pageId: string,
    options?: { auto?: boolean; checkWhenReady?: boolean }
  ): PagePipeline
  /** Stops this page after its current step; Resume (`startPage`) continues. */
  stopPage(projectId: string, pageId: string): PagePipeline
  /** One page's setup for the page tabs. */
  pagePipeline(projectId: string, pageId: string): PagePipeline
  /** Pages were tracked in bulk: look for work now instead of at the next tick (loop only). */
  nudge(): void
  /** Runs passes until nothing more can start, the budget ends, or `shouldStop` (headless). */
  runFor(budgetMs: number, shouldStop?: () => boolean): Promise<void>
  /** Resolves when no page is running. */
  idle(): Promise<void>
  status(): SetupStatus
  retry(request: SetupRetryRequest): SetupStatus
  setPaused(paused: boolean): SetupStatus
  setRate(request: SetupRateRequest): SetupStatus
}

interface ProjectHold {
  /** Epoch ms, or null until the user answers. */
  until: number | null
  reason: string
  /** True when only Connections can fix it (no Claude connection, a removed key). */
  connection?: boolean
}

interface Active {
  projectId: string
  pageId: string
  stop: boolean
  /** The user chose Stop: the run ends after its step and the page waits for Resume. */
  userStopped: boolean
  done: Promise<void>
}

interface Kicked {
  projectId: string
  pageId: string
}

export function createSetupRunner(deps: SetupRunnerDeps): SetupRunner {
  const host = deps.host
  const zone = deps.timeZone ?? systemTimeZone
  const timers = deps.timers ?? {
    set: (run: () => void, ms: number) => {
      const handle = setTimeout(run, ms)
      handle.unref()
      return handle
    },
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
  const active = new Map<string, Active>()
  const holds = new Map<string, ProjectHold>()
  /** Pages the user started (a single add, Retry, Resume): they run first and skip the holds. */
  const kicked = new Map<string, Kicked>()
  /**
   * Pages added with "Add and check now" in this run, for a page with no wait
   * row to store the ask on. The stored ask (`markCheckWhenReady`) is the one
   * that survives a restart.
   */
  const checkWhenReady = new Set<string>()
  let starts: number[] | null = null
  let stopped = false
  let looping = false
  let handle: unknown = null
  let idleWaiters: Array<() => void> = []
  const unsubscribe = onNoticeResolved(CLAUDE_ASK_NOTICE, (notice, actionId) => {
    if (actionId !== CLAUDE_RETRY || notice.projectId === null) return
    retryProject(notice.projectId, null)
    pumpSafely()
  })
  const unsubscribeGaveUp = onNoticeResolved(SETUP_FAILED_NOTICE, (notice, actionId) => {
    const pageId = notice.data.pageId
    if (actionId !== SETUP_RETRY || notice.projectId === null || typeof pageId !== 'string') return
    try {
      runner.startPage(notice.projectId, pageId)
    } catch (error) {
      host.logger.warn('setup retry from a notice failed', { message: messageOf(error) })
    }
  })

  const runner: SetupRunner = {
    start() {
      if (looping || stopped) return
      looping = true
      handle = timers.set(tick, SETUP_FIRST_TICK_MS)
    },
    stop() {
      stopped = true
      looping = false
      if (handle !== null) timers.clear(handle)
      handle = null
      unsubscribe()
      unsubscribeGaveUp()
      for (const item of active.values()) item.stop = true
    },
    pump: () => pump(),
    startPage(projectId, pageId, options) {
      const project = requireProject(projectId, 'setup:start')
      const db = openPooled(host.storage, project)
      if (db === null) throw new IpcRequestError('setup:start', 'That project could not be opened')
      if (getSetupCandidate(db, pageId) === null) {
        throw new IpcRequestError('setup:start', 'That page was not found')
      }
      if (options?.checkWhenReady === true) {
        checkWhenReady.add(runKey(projectId, pageId))
        try {
          markCheckWhenReady(db, pageId)
        } catch (error) {
          host.logger.warn('could not save Add and check now', { message: messageOf(error) })
        }
      }
      const live = looping && !stopped
      if (options?.auto === true && !live) return pipelineFor(projectId, pageId, 'setup:start')
      holds.delete(projectId)
      const settings = readSetupRunnerSettings(host.storage.db)
      if (settings.paused) writeSetupRunnerSettings(host.storage.db, { ...settings, paused: false })
      const job = getPageSetupJob(db, pageId)
      if (job !== null && job.state !== 'running') deletePageSetupJob(db, pageId)
      kicked.set(runKey(projectId, pageId), { projectId, pageId })
      pumpSafely(!live)
      return pipelineFor(projectId, pageId, 'setup:start')
    },
    stopPage(projectId, pageId) {
      const project = requireProject(projectId, 'setup:stop')
      const db = openPooled(host.storage, project)
      if (db === null) throw new IpcRequestError('setup:stop', 'That project could not be opened')
      const key = runKey(projectId, pageId)
      kicked.delete(key)
      const item = active.get(key)
      if (item !== undefined) {
        item.stop = true
        item.userStopped = true
      } else {
        const candidate = getSetupCandidate(db, pageId)
        if (candidate === null) throw new IpcRequestError('setup:stop', 'That page was not found')
        writeStopped(db, pageId, candidate.job, firstStep(candidate))
      }
      return pipelineFor(projectId, pageId, 'setup:stop')
    },
    pagePipeline: (projectId, pageId) => pipelineFor(projectId, pageId, 'setup:page'),
    nudge() {
      if (looping && !stopped) pumpSafely()
    },
    async runFor(budgetMs, shouldStop) {
      const deadline = now() + Math.max(0, budgetMs)
      const halt = (): boolean => stopped || now() >= deadline || shouldStop?.() === true
      for (let guard = 0; guard < 10_000 && !halt(); guard += 1) {
        const started = pump()
        if (active.size === 0) break
        if (started === 0 && halt()) break
        await Promise.race([...[...active.values()].map((item) => item.done), sleepUntil(deadline)])
      }
      for (const item of active.values()) item.stop = true
      await runner.idle()
    },
    idle() {
      if (active.size === 0) return Promise.resolve()
      return new Promise((resolve) => {
        idleWaiters.push(resolve)
      })
    },
    status: () => statusNow(),
    retry(request) {
      const pageIds = request.pageIds === undefined ? null : [...request.pageIds]
      if (request.projectId === undefined) {
        for (const project of listProjects(host.storage.db)) retryProject(project.id, pageIds)
      } else {
        retryProject(request.projectId, pageIds)
      }
      pumpSafely()
      return statusNow()
    },
    setPaused(paused) {
      const current = readSetupRunnerSettings(host.storage.db)
      writeSetupRunnerSettings(host.storage.db, { ...current, paused })
      if (paused) for (const item of active.values()) item.stop = true
      else pumpSafely()
      return statusNow()
    },
    setRate(request) {
      const current = readSetupRunnerSettings(host.storage.db)
      try {
        writeSetupRunnerSettings(host.storage.db, {
          ...current,
          pagesPerHour: request.pagesPerHour
        })
      } catch {
        throw new IpcRequestError('setup:setRate', 'Choose 1 to 200 pages an hour.')
      }
      pumpSafely()
      return statusNow()
    }
  }
  return runner

  function now(): number {
    return host.now().getTime()
  }

  function tick(): void {
    if (stopped) return
    pumpSafely()
    if (looping && !stopped) handle = timers.set(tick, SETUP_TICK_MS)
  }

  function pumpSafely(kickedOnly = false): void {
    try {
      pump(kickedOnly)
    } catch (error) {
      host.logger.warn('page setup pass failed', { message: messageOf(error) })
    }
  }

  /** `kickedOnly`: start only pages the user started (the loop is off). */
  function pump(kickedOnly = false): number {
    if (stopped) return 0
    const settings = readSetupRunnerSettings(host.storage.db)
    if (settings.paused) return 0
    const at = now()
    // At most the configured Claude "calls at once" pages run together; the shared
    // provider gate still caps the calls themselves (LLM-7).
    const slots = Math.max(1, host.settings().claudeConcurrency) - active.size
    if (slots <= 0) return 0
    const budget = settings.pagesPerHour - recentStarts(at).length
    let started = 0
    // Pages the user started go first and skip the throttle, quiet hours and stagger.
    for (const [key, item] of [...kicked]) {
      if (started >= slots) break
      if (active.has(key)) continue
      const project = listProjects(host.storage.db).find((entry) => entry.id === item.projectId)
      const db = project === undefined ? null : openPooled(host.storage, project)
      const candidate = db === null ? null : getSetupCandidate(db, item.pageId)
      if (project === undefined || project.status === 'archived' || candidate === null) {
        kicked.delete(key)
        continue
      }
      const hold = holds.get(project.id)
      if (hold !== undefined && (hold.until === null || hold.until > at)) continue
      launch(project, candidate, true)
      started += 1
    }
    if (kickedOnly) return started
    const ready: Array<{ project: ProjectRecord; candidate: SetupCandidate }> = []
    for (const project of listProjects(host.storage.db)) {
      if (!projectOpen(project, at)) continue
      const db = openPooled(host.storage, project)
      if (db === null) continue
      for (const candidate of listSetupCandidates(db)) {
        if (active.has(runKey(project.id, candidate.pageId))) continue
        if (holdFor(candidate, at) !== null) continue
        ready.push({ project, candidate })
      }
    }
    ready.sort((a, b) => compareCandidates(a.candidate, b.candidate))
    let claudeStarts = 0
    for (const item of ready) {
      if (started >= slots) break
      // A page whose prompts exist only needs marking tracked; it costs no Claude call.
      if (item.candidate.promptSetVersion === null) {
        if (claudeStarts >= budget) continue
        claudeStarts += 1
        recentStarts(at).push(at)
      }
      launch(item.project, item.candidate, false)
      started += 1
    }
    return started
  }

  function projectOpen(project: ProjectRecord, at: number): boolean {
    if (project.status !== 'active') return false
    const hold = holds.get(project.id)
    if (hold !== undefined) {
      if (hold.until === null || hold.until > at) return false
      holds.delete(project.id)
    }
    const db = openPooled(host.storage, project)
    if (db === null) return false
    try {
      const schedule = readProjectSchedule(db, project.id)
      return !schedule.paused && !inQuiet(at, schedule, zone())
    } catch {
      return false
    }
  }

  function recentStarts(at: number): number[] {
    if (starts === null) {
      starts = []
      const since = new Date(at - THROTTLE_WINDOW_MS).toISOString()
      for (const project of listProjects(host.storage.db)) {
        const db = openPooled(host.storage, project)
        if (db === null) continue
        for (const started of listSetupStartsSince(db, since)) starts.push(Date.parse(started))
      }
    }
    starts = starts.filter((value) => at - value < THROTTLE_WINDOW_MS)
    return starts
  }

  function launch(project: ProjectRecord, candidate: SetupCandidate, fill: boolean): void {
    const key = runKey(project.id, candidate.pageId)
    kicked.delete(key)
    const item: Active = {
      projectId: project.id,
      pageId: candidate.pageId,
      stop: false,
      userStopped: false,
      done: Promise.resolve()
    }
    active.set(key, item)
    item.done = runOne(project, candidate, item, fill)
      .catch((error: unknown) => {
        host.logger.warn('page setup failed', { message: messageOf(error) })
      })
      .finally(() => {
        active.delete(key)
        if (active.size === 0) {
          const waiters = idleWaiters
          idleWaiters = []
          for (const resolve of waiters) resolve()
        }
        if (!stopped && looping) pumpSafely()
      })
  }

  async function runOne(
    project: ProjectRecord,
    candidate: SetupCandidate,
    item: Active,
    fill: boolean
  ): Promise<void> {
    const db = openPooled(host.storage, project)
    if (db === null) return
    const startedAt = host.now().toISOString()
    const previous = candidate.job
    const attempts = previous?.state === 'done' ? 0 : (previous?.attempts ?? 0)
    let setup: PageSetupDeps
    try {
      setup = deps.setupDeps?.(db, project.id) ?? pageSetupDeps(host, db, project.id, 'setup:run')
    } catch (error) {
      // No Claude connection (no key, or a removed key): hold the project and look again later.
      const reason = plainReason(error)
      holds.set(project.id, {
        until: now() + MISSING_CONNECTION_RETRY_MS,
        reason,
        connection: true
      })
      progress(project.id, candidate.pageId, firstStep(candidate), 'waiting', reason)
      return
    }
    let step: SetupRunStep = firstStep(candidate)
    save(db, {
      pageId: candidate.pageId,
      state: 'running',
      step,
      attempts,
      nextAttemptAt: null,
      lastError: previous?.lastError ?? null,
      nextStep: previous?.nextStep ?? null,
      startedAt,
      finishedAt: null,
      updatedAt: startedAt
    })
    const work = (): Promise<SetupRunOutcome> =>
      runSetupSteps(setup, candidate.pageId, {
        fill,
        shouldStop: () => item.stop || stopped,
        onStep: (next) => {
          step = next
          save(db, {
            pageId: candidate.pageId,
            state: 'running',
            step,
            attempts,
            nextAttemptAt: null,
            lastError: null,
            nextStep: null,
            startedAt,
            finishedAt: null,
            updatedAt: host.now().toISOString()
          })
          progress(project.id, candidate.pageId, step, 'running', runningCopy(step))
        }
      })
    // Owner feedback 1 + 5: the page read and Claude calls inside push live
    // `assist:progress` steps, scoped to the page, for the tab's setup panel.
    const outcome =
      deps.emitAssistProgress === undefined
        ? await work()
        : await runWithProgress(
            {
              channel: SETUP_PROGRESS_CHANNEL,
              scope: candidate.pageId,
              emit: deps.emitAssistProgress
            },
            work
          )
    if (item.userStopped && outcome.kind !== 'done' && outcome.kind !== 'gone') {
      writeStopped(db, candidate.pageId, getPageSetupJob(db, candidate.pageId), step)
      progress(project.id, candidate.pageId, step, 'waiting', STOPPED_BY_USER)
      return
    }
    settle(db, project, candidate.pageId, outcome, { attempts, startedAt, step })
  }

  function writeStopped(
    db: SqliteDatabase,
    pageId: string,
    previous: PageSetupJob | null,
    step: SetupRunStep
  ): void {
    if (previous?.state === 'done') return
    save(db, {
      pageId,
      state: 'failed',
      step,
      attempts: previous?.attempts ?? 0,
      nextAttemptAt: null,
      lastError: STOPPED_BY_USER,
      nextStep: 'Choose Resume setup to continue.',
      startedAt: previous?.startedAt ?? null,
      finishedAt: null,
      updatedAt: host.now().toISOString()
    })
  }

  function requireProject(projectId: string, channel: string): ProjectRecord {
    const project = listProjects(host.storage.db).find((item) => item.id === projectId)
    if (project === undefined) throw new IpcRequestError(channel, 'That project was not found')
    return project
  }

  function pipelineFor(projectId: string, pageId: string, channel: string): PagePipeline {
    const project = requireProject(projectId, channel)
    const db = openPooled(host.storage, project)
    if (db === null) throw new IpcRequestError(channel, 'That project could not be opened')
    const at = now()
    const hold = holds.get(projectId)
    const held = hold !== undefined && (hold.until === null || hold.until > at) ? hold : null
    const pipeline = buildPagePipeline(db, projectId, pageId, getPageSetupJob(db, pageId), {
      running: active.has(runKey(projectId, pageId)),
      looping: looping && !stopped,
      paused: readSetupRunnerSettings(host.storage.db).paused,
      hold:
        held === null
          ? null
          : { reason: held.reason, connection: held.connection ?? needsConnection(held.reason) }
    })
    if (pipeline === null) throw new IpcRequestError(channel, 'That page was not found')
    if (kicked.has(runKey(projectId, pageId)) && pipeline.state === 'queued' && looping) {
      return { ...pipeline, message: 'Starting now. No searches.' }
    }
    return pipeline
  }

  /** Setup finished: a project that checks automatically starts the first check now. */
  function afterReady(db: SqliteDatabase, projectId: string, pageId: string): void {
    try {
      const remembered = checkWhenReady.delete(runKey(projectId, pageId))
      const asked = remembered || pageCheckWhenReady(db, pageId)
      if (!firstCheckWaits(db, pageId) || (!asked && !readCheckWhenReady(db))) return
      clearFirstCheckWaits(db, pageId)
      deps.startFirstCheck?.(projectId, pageId)
    } catch (error) {
      host.logger.warn('could not start the first check', { message: messageOf(error) })
    }
  }

  function settle(
    db: SqliteDatabase,
    project: ProjectRecord,
    pageId: string,
    outcome: SetupRunOutcome,
    run: { attempts: number; startedAt: string; step: SetupRunStep }
  ): void {
    const at = host.now()
    const base = {
      pageId,
      attempts: run.attempts,
      startedAt: run.startedAt,
      updatedAt: at.toISOString()
    }
    if (outcome.kind === 'aborted') return
    if (outcome.kind === 'gone') {
      save(db, {
        ...base,
        state: 'done',
        step: run.step,
        nextAttemptAt: null,
        lastError: null,
        nextStep: null,
        finishedAt: at.toISOString()
      })
      return
    }
    if (outcome.kind === 'done') {
      save(db, {
        ...base,
        state: 'done',
        step: outcome.coverageError === null ? run.step : 'coverage',
        nextAttemptAt: null,
        lastError:
          outcome.coverageError === null
            ? null
            : `Tracked. The coverage matrix was not written: ${outcome.coverageError}`,
        nextStep: outcome.coverageError === null ? null : 'Open Content gaps to run it again.',
        finishedAt: at.toISOString()
      })
      afterReady(db, project.id, pageId)
      progress(project.id, pageId, run.step, 'done', 'Set up and tracked.')
      return
    }
    if (outcome.kind === 'halted') {
      const until =
        outcome.halt.retryAfterMs === null ? null : at.getTime() + outcome.halt.retryAfterMs
      holds.set(project.id, { until, reason: outcome.halt.message })
      save(db, {
        ...base,
        state: 'retry',
        step: outcome.step,
        nextAttemptAt: new Date(until ?? at.getTime() + ASK_RETRY_MS).toISOString(),
        lastError: outcome.halt.message,
        nextStep:
          outcome.halt.rule === 'ask'
            ? 'Answer the Claude notice, or switch to an API key in Project settings.'
            : 'Nothing to do now. CiteFox tries again by itself.',
        finishedAt: null
      })
      progress(project.id, pageId, outcome.step, 'waiting', outcome.halt.message)
      return
    }
    const attempts = outcome.final ? MAX_SETUP_ATTEMPTS : run.attempts + 1
    const giveUp = attempts >= MAX_SETUP_ATTEMPTS
    const wait = SETUP_BACKOFF_MS[Math.min(attempts, SETUP_BACKOFF_MS.length) - 1] ?? 0
    const message = redactString(outcome.message, { secrets: host.knownSecrets(), hexKeys: true })
    save(db, {
      ...base,
      attempts,
      state: giveUp ? 'failed' : 'retry',
      step: outcome.step,
      nextAttemptAt: giveUp ? null : new Date(at.getTime() + wait).toISOString(),
      lastError: message,
      nextStep: giveUp
        ? (outcome.nextStep ?? 'Fix the page, then choose Retry.')
        : outcome.nextStep,
      finishedAt: null
    })
    progress(project.id, pageId, outcome.step, giveUp ? 'failed' : 'waiting', message)
    if (giveUp) {
      const candidate = getSetupCandidate(db, pageId)
      deps.onGaveUp?.({
        projectId: project.id,
        pageId,
        pageName: candidate?.label ?? candidate?.title ?? candidate?.url ?? 'a page',
        reason: message,
        nextStep: outcome.nextStep ?? 'Fix the page, then choose Retry.'
      })
    }
  }

  function retryProject(projectId: string, pageIds: readonly string[] | null): void {
    holds.delete(projectId)
    const project = listProjects(host.storage.db).find((item) => item.id === projectId)
    if (project === undefined)
      throw new IpcRequestError('setup:retry', 'That project was not found')
    const db = openPooled(host.storage, project)
    if (db !== null) resetPageSetupJobs(db, pageIds)
  }

  function save(db: SqliteDatabase, job: PageSetupJob): void {
    try {
      writePageSetupJob(db, job)
    } catch (error) {
      // A quit closes storage under a running step; that page continues on the next start.
      if (!stopped)
        host.logger.warn('could not save page setup progress', { message: messageOf(error) })
    }
  }

  function progress(
    projectId: string,
    pageId: string,
    step: SetupRunStep,
    state: SetupProgress['state'],
    message: string
  ): void {
    if (deps.emit === undefined || stopped) return
    try {
      deps.emit({ projectId, pageId, step, state, message, status: statusNow() })
    } catch (error) {
      host.logger.warn('setup progress failed', { message: messageOf(error) })
    }
  }

  function statusNow(): SetupStatus {
    const at = now()
    return computeSetupStatus({
      storage: host.storage,
      nowMs: at,
      timeZone: zone(),
      running: new Set(active.keys()),
      holdReason: holdReason(at)
    })
  }

  function holdReason(at: number): string | null {
    const settings = readSetupRunnerSettings(host.storage.db)
    if (recentStarts(at).length >= settings.pagesPerHour) {
      const oldest = Math.min(...recentStarts(at))
      const next = new Date(oldest + THROTTLE_WINDOW_MS).toISOString()
      return `${pluralize(settings.pagesPerHour, 'page')} ${settings.pagesPerHour === 1 ? 'was' : 'were'} set up in the last hour, the limit. The next starts after ${next}.`
    }
    for (const hold of holds.values()) {
      if (hold.until === null || hold.until > at) return hold.reason
    }
    return null
  }

  function sleepUntil(deadline: number): Promise<void> {
    return new Promise((resolve) => {
      timers.set(resolve, Math.max(1, Math.min(deadline - now(), SETUP_TICK_MS)))
    })
  }
}

/**
 * Unpackaged builds only: `CITEFOX_SETUP_RUNNER=off` keeps the loop from starting,
 * so Playwright runs with seeded "setting up" pages never reach the network.
 */
export function setupRunnerDisabled(isPackaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return !isPackaged && env.CITEFOX_SETUP_RUNNER === 'off'
}

/** Reads the stored row for a page; used by tests and the status screen. */
export function readSetupJob(db: SqliteDatabase, pageId: string): PageSetupJob | null {
  return getPageSetupJob(db, pageId)
}

function firstStep(candidate: SetupCandidate): SetupRunStep {
  if (!candidate.hasSnapshot) return 'read'
  if (!candidate.hasProfile) return 'profile'
  return candidate.promptSetVersion === null ? 'prompts' : 'coverage'
}

function runningCopy(step: SetupRunStep): string {
  if (step === 'read') return 'Reading the page.'
  if (step === 'profile') return 'Writing the buyer profile.'
  if (step === 'prompts') return 'Writing the buyer prompts.'
  return 'Writing the coverage matrix.'
}

function plainReason(error: unknown): string {
  const message = messageOf(error)
  const colon = message.indexOf(': ')
  return colon > 0 && message.startsWith('setup:run') ? message.slice(colon + 2) : message
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'failed'
}

function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length > 0 ? zone : 'UTC'
}
