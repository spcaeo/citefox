import type {
  AppSchedule,
  CapRule,
  CheckDueResult,
  FixFollowUpInput,
  QueueStatus
} from '@shared/domain'
import { defaultAppSchedule } from '../storage/settings'
import { redactString } from '../logging/redact'
import { createCheckQueue, dueJobId, type CheckQueue } from '../queue/check-queue'
import type { QueuePauseStore } from '../queue/pause-store'
import { applyCheckResult, type CheckRunner } from '../queue/runner'
import type {
  CapAlert,
  CommittedSearchWrite,
  QueueKeyInput,
  QueueProjectInput,
  UsageSeedStore
} from '../queue/types'
import type { Logger } from '../logging/logger'
import type { Clock } from '../scheduler/clock'
import { planSchedule } from '../scheduler/due'
import { scheduledCheckDisposition } from '../scheduler/outcome'
import { localDateKey } from '../scheduler/local-time'
import type {
  DuePage,
  ScheduledPageInput,
  ScheduledProjectInput,
  TopicBatchInput
} from '../scheduler/types'

/**
 * Exit codes for `citefox --check-due` (decision 18, decision 26).
 * 0 is success, including when nothing was due, when the queue is paused,
 * and when the only unfinished pages were cancelled by the user.
 * 1 means at least one page check failed. A cancel is not a failure.
 * 2 is a project cap stop (`pause`, `notify`, or `allow_10` past its allowance).
 * When a page check fails and a cap also stops the run, the exit code is 2.
 */
export const CHECK_DUE_EXIT_OK = 0
export const CHECK_DUE_EXIT_ERROR = 1
export const CHECK_DUE_EXIT_CAP = 2

/** The OS job's flag. Not an IPC channel (decision 18). */
export const CHECK_DUE_FLAG = '--check-due'

/**
 * How the SCH-1 job is described to people. The installed command is the app
 * executable with `--check-due` (see `scheduler/os-job`).
 */
export const CHECK_DUE_COMMAND = 'citefox --check-due'

export function isCheckDueFlag(argv: readonly string[]): boolean {
  return argv.includes(CHECK_DUE_FLAG)
}

/** The piece of Electron `app` this decision needs. Tests pass a fake. */
export interface SingleInstanceLock {
  requestSingleInstanceLock(): boolean
}

/**
 * Decision 26b. True when another CiteFox process already holds the lock.
 * `--check-due` then exits 0 and does not run the pass.
 */
export function shouldSkipForRunningInstance(lock: SingleInstanceLock): boolean {
  return !lock.requestSingleInstanceLock()
}

/** Projects, pages, and follow-ups the due list is built from. Callers own persistence. */
export interface CheckCatalog {
  app: AppSchedule
  projects: readonly ScheduledProjectInput[]
  pages: readonly ScheduledPageInput[]
  followUps?: readonly FixFollowUpInput[]
  /** Staggered topic batches still waiting (`topic_check_batches`). */
  topicBatches?: readonly TopicBatchInput[]
}

export type CheckDueStop =
  'finished' | 'nothing_due' | 'already_ran' | 'paused' | 'cap' | 'error' | 'handoff'

export interface CheckDueRunInput {
  clock: Clock
  timeZone: string
  runner: CheckRunner
  catalog: CheckCatalog
  /** Shared with `queue:checkDue` so the tray and this pass cannot double-run (SCH-2). */
  queue?: CheckQueue
  keys?: readonly QueueKeyInput[]
  queueProjects?: readonly QueueProjectInput[]
  claudeConcurrency?: number
  trayRunning?: boolean
  headlessJob?: boolean
  /** Wait until a rate limit or a later slot. Tests advance `clock` here. */
  sleep?: (ms: number) => Promise<void>
  estimateSearches?: (page: DuePage) => number
  secrets?: readonly string[]
  /** Runner failures are logged here after redaction (NFR-5). Omitted in tests that only read `errorMessage`. */
  logger?: Pick<Logger, 'error'>
  onStatus?: (status: QueueStatus) => void
  onCapAlert?: (alert: CapAlert) => void
  /**
   * Today's due-pass marker (decision 26).
   * The tray and a separate `--check-due` process share one store.
   * Omitted: a fresh in-memory store for this call only.
   * `citefox --check-due` passes a store that calls `getDayPass` / `setDayPass`.
   */
  passStore?: DuePassStore
  /**
   * Month-to-date `key_usage` for a queue this call creates (decision 26).
   * Omitted: the ledger starts empty. A caller-supplied queue keeps its own seed.
   * `citefox --check-due` passes `usageSeedFromStorage` (`getKeyUsageForMonth`).
   */
  usageSeedStore?: UsageSeedStore
  /**
   * Writes each committed search before the ledger counts it.
   * Used when this call creates the queue. A caller-supplied queue keeps its own writer.
   */
  persistSearch?: (search: CommittedSearchWrite) => void
  /**
   * Longest wait for a later slot or a rate-limit retry inside this pass.
   * Omitted: no limit. The headless job passes a short wait so it exits and
   * leaves later batches to the next OS job run, and the tray leaves them to
   * its next wall-clock tick.
   */
  maxWaitMs?: number
  /**
   * Checked before each job starts. True ends the pass after the running job,
   * for example when the user opens CiteFox while the headless job runs.
   * Unstarted jobs are not marked done, so the next pass runs them.
   */
  shouldStop?: () => boolean
  /** Shared pause row for a queue this call creates. A caller-supplied queue keeps its own. */
  pauseStore?: QueuePauseStore
  /**
   * Test seam. The pass never calls it.
   * `citefox --check-due` must not open a window.
   */
  openWindow?: () => void
}

export interface CheckDueRunResult {
  exitCode: number
  pass: CheckDueResult
  stop: CheckDueStop
  capRule?: CapRule
  alerts: readonly CapAlert[]
  /** Redacted. Set when a page check failed. */
  errorMessage: string | null
}

/**
 * The pure `citefox --check-due` pass. The main entry calls this when it sees the flag.
 * It never opens a window. It reads only `clock`.
 * Quiet hours, project pause, page pause, and archived projects come from `planSchedule`
 * (SCH-3, SCH-9, SCH-10, decision 8, decision 20, decision 23).
 * Caps and rate-limit backoff come from the E6a queue (decision 21, decision 22).
 * A paused queue returns `started: false`, enqueues nothing, and does not consume the day
 * (decision 26). The day-pass marker lives in `passStore` so another queue the same local
 * date does not start work again (SCH-2).
 */
export async function runCheckDue(input: CheckDueRunInput): Promise<CheckDueRunResult> {
  const secrets = input.secrets ?? []
  const alerts: CapAlert[] = []
  const passStore = input.passStore ?? memoryDuePassStore()
  const queue =
    input.queue ??
    createCheckQueue({
      clock: input.clock,
      timeZone: input.timeZone,
      keys: input.keys ?? [],
      projects: input.queueProjects ?? queueProjectsFromCatalog(input.catalog),
      claudeConcurrency: input.claudeConcurrency,
      trayRunning: input.trayRunning ?? false,
      headlessJob: input.headlessJob ?? false,
      usageSeed: input.usageSeedStore?.monthToDate(),
      persistSearch: input.persistSearch,
      pauseStore: input.pauseStore,
      onCapAlert: (alert) => {
        alerts.push(alert)
        input.onCapAlert?.(alert)
      }
    })
  const paused = queue.status()
  if (paused.state === 'paused_all' || paused.state === 'paused_today') {
    return {
      exitCode: CHECK_DUE_EXIT_OK,
      pass: { started: false, jobIds: [], pages: 0 },
      stop: 'paused',
      alerts,
      errorMessage: null
    }
  }

  const today = localDateKey(input.clock.now(), input.timeZone)
  const plan = planSchedule(
    {
      app: input.catalog.app,
      projects: input.catalog.projects,
      pages: input.catalog.pages,
      followUps: input.catalog.followUps,
      topicBatches: input.catalog.topicBatches
    },
    input.clock.now(),
    input.timeZone
  )
  // A waiting item a manual check has since covered is no longer due. Drop it.
  const duePages = new Set(plan.due.pages.map((page) => pageKey(page.projectId, page.pageId)))
  queue.pruneDue((work) => duePages.has(pageKey(work.projectId, work.pageId)))
  const recorded = passStore.read()
  const done = new Set(recorded !== null && recorded.day === today ? recorded.jobIds : [])
  const fresh = plan.due.pages.filter((page) => !done.has(dueJobId(today, page)))
  const idle = (): boolean => {
    const status = queue.status()
    return status.waiting === 0 && status.running === 0
  }
  if (done.size > 0 && fresh.length === 0 && idle() && recorded !== null) {
    return {
      exitCode: CHECK_DUE_EXIT_OK,
      pass: { started: false, jobIds: [...recorded.jobIds], pages: recorded.pages },
      stop: 'already_ran',
      alerts,
      errorMessage: null
    }
  }

  let previous = queue.status()
  const pass = queue.checkDue({ day: plan.due.day, pages: fresh }, input.estimateSearches)
  previous = publish(queue, previous, input.onStatus, false)
  if (idle()) {
    return {
      exitCode: CHECK_DUE_EXIT_OK,
      pass,
      stop: pass.started && pass.pages === 0 ? 'nothing_due' : 'already_ran',
      alerts,
      errorMessage: null
    }
  }

  const sleep = input.sleep ?? delay
  const maxWaitMs = input.maxWaitMs ?? Number.POSITIVE_INFINITY
  let stop: CheckDueStop = 'finished'
  let capRule: CapRule | undefined
  let capStopped = false
  let errorMessage: string | null = null
  let sawError = false
  const finished = (jobId: string): void => {
    markJobDone(passStore, today, jobId)
  }
  const noteCap = (rule: CapRule | undefined, projectId: string): void => {
    capStopped = true
    capRule = capRule ?? rule ?? ruleFor(input, projectId)
  }

  for (let guard = 0; guard < 10_000; guard += 1) {
    if (input.shouldStop?.() === true) {
      stop = 'handoff'
      break
    }
    if (input.usageSeedStore !== undefined) queue.syncUsage(input.usageSeedStore.monthToDate())
    const next = queue.dequeue()
    if (next.ok) {
      previous = publish(queue, previous, input.onStatus, false)
      try {
        const result = await input.runner.run(next.job)
        const applied = applyCheckResult(queue, next.job, result, secrets)
        if (applied.outcome !== 'rate_limited') finished(next.job.id)
        previous = publish(queue, previous, input.onStatus, applied.searchesCommitted > 0)
        if (scheduledCheckDisposition(applied.outcome) === 'fail') {
          sawError = true
          errorMessage =
            applied.message === null ? null : redactString(applied.message, { secrets })
          logCheckFailure(input, errorMessage)
        }
        // A search refused at the cap stops this project only. The others keep going.
        if (applied.capBlocked) noteCap(undefined, next.job.projectId)
      } catch (error: unknown) {
        queue.complete(next.job.id)
        finished(next.job.id)
        previous = publish(queue, previous, input.onStatus, false)
        sawError = true
        errorMessage = redactString(messageOf(error), { secrets })
        logCheckFailure(input, errorMessage)
      }
      continue
    }
    if (next.reason === 'paused_all' || next.reason === 'paused_today') {
      stop = 'paused'
      break
    }
    // Held items skip only their own project or page (cap, project pause, busy page).
    const scan = queue.lastScan()
    for (const skipped of scan.skipped) {
      if (skipped.reason === 'project_cap') noteCap(skipped.capRule, skipped.projectId)
      if (skipped.reason === 'keys_exhausted' || skipped.reason === 'dedicated_key_unavailable') {
        sawError = true
        errorMessage = 'A due page could not be started.'
      }
    }
    if (scan.nextRunAt === null) break
    const wait = scan.nextRunAt - input.clock.now()
    // Headless runs only what is due now. The OS job runs again for later batches.
    if (wait > maxWaitMs) break
    if (wait > 0) await sleep(wait)
    if (input.clock.now() < scan.nextRunAt) {
      sawError = true
      errorMessage = 'The clock did not reach the next check.'
      break
    }
  }

  if (stop !== 'paused' && stop !== 'handoff') {
    stop = capStopped ? 'cap' : sawError ? 'error' : 'finished'
  }
  const exitCode = capStopped
    ? CHECK_DUE_EXIT_CAP
    : sawError
      ? CHECK_DUE_EXIT_ERROR
      : CHECK_DUE_EXIT_OK
  return { exitCode, pass, stop, capRule, alerts, errorMessage }
}

/**
 * App schedule used when a caller does not inject a catalog and does not open storage.
 * This is the stored SCH-1 default (`startAtLogin` true). It does not invent pages.
 */
export function emptyCheckCatalog(): CheckCatalog {
  return { app: defaultAppSchedule(), projects: [], pages: [] }
}

/** Today's due-pass marker. The in-memory fake tests inject. Production uses `day_pass`. */
export interface DuePassRecord {
  /** `YYYY-MM-DD` in the computer's timezone. */
  day: string
  jobIds: readonly string[]
  pages: number
}

export interface DuePassStore {
  read(): DuePassRecord | null
  write(record: DuePassRecord): void
}

export function memoryDuePassStore(): DuePassStore {
  let record: DuePassRecord | null = null
  return {
    read: () => record,
    write(next: DuePassRecord): void {
      record = { day: next.day, jobIds: [...next.jobIds], pages: next.pages }
    }
  }
}

/**
 * Records one finished job in today's marker as soon as it finishes (SCH-2).
 * A later pass the same day skips only the jobs listed here, so work stopped by
 * a pause, a cap, an error, or a quit still runs.
 */
function markJobDone(store: DuePassStore, day: string, jobId: string): void {
  const current = store.read()
  const ids = current !== null && current.day === day ? [...current.jobIds] : []
  if (ids.includes(jobId)) return
  ids.push(jobId)
  store.write({ day, jobIds: ids, pages: ids.length })
}

function pageKey(projectId: string, pageId: string): string {
  return `${projectId}\0${pageId}`
}

function queueProjectsFromCatalog(catalog: CheckCatalog): QueueProjectInput[] {
  return catalog.projects.map((project) => ({
    projectId: project.projectId,
    name: project.projectId,
    cap: null,
    capRule: 'pause' as const,
    dedicatedKeyId: null,
    paused: project.paused
  }))
}

function ruleFor(input: CheckDueRunInput, projectId: string): CapRule | undefined {
  return input.queueProjects?.find((project) => project.projectId === projectId)?.capRule
}

function publish(
  queue: CheckQueue,
  previous: QueueStatus,
  onStatus: ((status: QueueStatus) => void) | undefined,
  searchCounted: boolean
): QueueStatus {
  const next = queue.status()
  if (
    onStatus !== undefined &&
    (searchCounted ||
      previous.state !== next.state ||
      previous.running !== next.running ||
      previous.waiting !== next.waiting)
  ) {
    onStatus(next)
  }
  return next
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Page check failed'
}

function logCheckFailure(input: CheckDueRunInput, message: string | null): void {
  input.logger?.error('Page check failed', { message })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
