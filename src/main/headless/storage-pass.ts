import { randomUUID } from 'node:crypto'
import type { FixFollowUpInput } from '@shared/domain'
import { queueKeysFromApiKeys } from '../queue/ipc'
import { recordingCheckRunner, unavailableCheckRunner } from '../queue/runner'
import { shouldRecordTrayCheck } from '../tray/record'
import type { QueueKeyInput, QueueProjectInput, RunningJob } from '../queue/types'
import { persistCommittedSearch, usageSeedFromStorage } from '../queue/usage'
import type { Clock } from '../scheduler/clock'
import { formatInstant } from '../scheduler/clock-time'
import { localDateKey, monthKey } from '../scheduler/local-time'
import type { ScheduledPageInput, ScheduledProjectInput, TopicBatchInput } from '../scheduler/types'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { getDayPass, setDayPass } from '../storage/day-pass'
import { sqliteQueuePauseStore } from '../storage/queue-pause'
import type { QueuePauseStore } from '../queue/pause-store'
import { StorageError } from '../storage/errors'
import { setFixFollowUpRun } from '../storage/fix-follow-ups'
import { getPage, setPageMarketLastCheckedAt } from '../storage/pages'
import { projectDatabasePool } from '../storage/project-db-pool'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getProject, listApiKeys, listProjects } from '../storage/records'
import { readAppSchedule } from '../storage/settings'
import { appendTrayCheck } from '../storage/tray-history'
import {
  emptyCheckCatalog,
  runCheckDue,
  type CheckCatalog,
  type CheckDueRunInput,
  type DuePassRecord,
  type DuePassStore
} from './check-due'
import { checkCatalogCache } from './catalog-cache'
import { readProjectCheckSlice, type StoredCheckCatalog } from './check-catalog'
import { markTopicBatchStarted } from '../topics/records'
import { deliverDueScheduledReports, type DueReportDelivery } from './due-reports'

/**
 * Longest wait inside a headless pass (a rate-limit retry is capped at 30 s).
 * A later spread batch or a slot after quiet hours is left for the OS job's
 * next hourly run, so the process exits and does not hold the app lock.
 */
export const HEADLESS_MAX_WAIT_MS = 2 * 60_000

/**
 * What `src/main/index.ts` passes for `citefox --check-due`.
 * `userData` opens the real app files. Omit it, and the other fields, to keep
 * the in-memory fakes tests already use.
 */
export interface CheckDueCommandInput extends Partial<CheckDueRunInput> {
  /** Electron `app.getPath('userData')`. Omit when `storage` is already open. */
  userData?: string
  /**
   * App storage the caller already opened, including the storage inside
   * `createCheckRunner`. The pass does not close it.
   */
  storage?: AppStorage
  /**
   * SCH-1. When set with `storage`, due weekly and monthly reports are generated
   * and sent after the page pass. Omit it and the pass only checks pages.
   * The SMTP transport is injected so tests can use the in-process server.
   */
  reports?: DueReportDelivery
  /**
   * Due sitemap syncs and background page setup (FR-19.2, FR-20.6), run after
   * the page checks and before due reports, inside the headless budget. A failure
   * is logged and does not change the exit code.
   */
  background?: () => Promise<unknown>
  /**
   * FR-22.6. Notes each successful scheduled check, then runs the automatic
   * exports once, right after the page checks. A failure is logged inside and
   * does not change the exit code.
   */
  autoExport?: {
    note(check: { projectId: string; pageId: string; reason: string }): void
    flush(): Promise<void>
  }
  /**
   * Alert rules (Alerts & schedules › Alert rules). Each scheduled check already fires its
   * rules through the wrapped engine; after the page checks the pass also sends
   * the daily digests that came due, so a Mac where the window stays closed still
   * gets them. Never throws.
   */
  alerts?: { flushDueDigests(): Promise<number> }
}

export type { DueReportDelivery }

/** App storage loaded for one headless pass. `close` releases every database. */
export interface CheckDueStorage {
  catalog: CheckCatalog
  keys: readonly QueueKeyInput[]
  queueProjects: readonly QueueProjectInput[]
  passStore: DuePassStore
  /** The `queue_pause` row the tray writes (SCH-11). */
  pauseStore: QueuePauseStore
  usageSeedStore: ReturnType<typeof usageSeedFromStorage>
  /** Writes each committed search to this pass's `key_usage` rows. */
  persistSearch: ReturnType<typeof persistCommittedSearch>
  /**
   * Writes `last_checked_at` and one `tray_history` row after a page check succeeds.
   * A follow-up is completed only when the runner also returned `runId`.
   */
  recordChecked(job: RunningJob, finishedAt: string, runId?: string): void
  close(): void
}

/**
 * `citefox --check-due`. With `userData` or an already open `storage`, the pass
 * reads the stored app schedule, each project schedule, the day pass, and
 * month-to-date key usage, then writes `last_checked_at` and `tray_history`
 * when a page check succeeds. Caller-owned `storage` stays open.
 * With neither, and no catalog, nothing is due and the exit code is 0.
 * The call never opens a window.
 */
export async function runCheckDueCommand(input: CheckDueCommandInput = {}): Promise<number> {
  const clock = input.clock ?? { now: () => Date.now() }
  const timeZone = input.timeZone ?? systemTimeZone()
  const opened = openCommandStorage(input, clock, timeZone)
  try {
    const runner = input.runner ?? unavailableCheckRunner()
    const checking =
      opened === null
        ? runner
        : recordingCheckRunner(runner, (job, ok) => {
            if (!shouldRecordTrayCheck(ok)) return
            opened.recordChecked(job, formatInstant(clock.now()), ok.runId)
            input.autoExport?.note(job)
          })
    const result = await runCheckDue({
      clock,
      timeZone,
      runner: checking,
      catalog: input.catalog ?? opened?.catalog ?? emptyCheckCatalog(),
      queue: input.queue,
      keys: input.keys ?? opened?.keys,
      queueProjects: input.queueProjects ?? opened?.queueProjects,
      claudeConcurrency: input.claudeConcurrency,
      trayRunning: input.trayRunning ?? false,
      headlessJob: input.headlessJob ?? opened?.catalog.app.checkWhenClosed ?? true,
      sleep: input.sleep,
      estimateSearches: input.estimateSearches,
      secrets: input.secrets,
      logger: input.logger,
      onStatus: input.onStatus,
      onCapAlert: input.onCapAlert,
      passStore: input.passStore ?? opened?.passStore,
      pauseStore: input.pauseStore ?? opened?.pauseStore,
      usageSeedStore: input.usageSeedStore ?? opened?.usageSeedStore,
      persistSearch: input.persistSearch ?? opened?.persistSearch,
      maxWaitMs: input.maxWaitMs ?? HEADLESS_MAX_WAIT_MS,
      shouldStop: input.shouldStop,
      openWindow: input.openWindow
    })
    await input.autoExport?.flush()
    if (input.alerts !== undefined) await input.alerts.flushDueDigests()
    if (input.background !== undefined && input.shouldStop?.() !== true) {
      try {
        await input.background()
      } catch (error: unknown) {
        input.logger?.error('Background setup failed', {
          message: error instanceof Error ? error.message : 'failed'
        })
      }
    }
    if (input.reports !== undefined && input.storage !== undefined) {
      await deliverDueScheduledReports({
        storage: input.storage,
        delivery: input.reports,
        now: () => new Date(clock.now()),
        timeZone
      })
    }
    return result.exitCode
  } finally {
    opened?.close()
  }
}

/**
 * Reads the app database, `settings.json`, and each project database.
 * Caps come from `readProjectScheduleCap`. Each market's stagger hold comes from
 * `getPageMarketFirstCheckNotBefore`. Planned fixes come from `listFixFollowUps`
 * (a row with `followup_run_id` set is already completed and is left out).
 * Key caps come from `api_keys`.
 */
export function openCheckDueStorage(input: {
  userData?: string
  /** When set, the pass uses this database and does not close it. */
  storage?: AppStorage
  clock: Clock
  timeZone: string
}): CheckDueStorage {
  const ownsStorage = input.storage === undefined
  const storage = input.storage ?? openOwnedStorage(input.userData)
  const projectDbs = new Map<string, SqliteDatabase>()
  try {
    const view = readOpenProjects(storage, projectDbs)
    const month = monthKey(input.clock.now(), input.timeZone)
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      for (const db of projectDbs.values()) closeProjectDatabase(db)
      projectDbs.clear()
      if (ownsStorage) storage.close()
    }
    return {
      catalog: view.catalog,
      keys: queueKeysFromApiKeys(listApiKeys(storage.db)),
      queueProjects: view.queueProjects,
      passStore: sqliteDuePassStore(storage.db, () =>
        localDateKey(input.clock.now(), input.timeZone)
      ),
      pauseStore: sqliteQueuePauseStore(storage.db),
      usageSeedStore: usageSeedFromStorage(storage.db, month),
      persistSearch: persistCommittedSearch(storage.db),
      recordChecked(job: RunningJob, finishedAt: string, runId?: string): void {
        const db = projectDbs.get(job.projectId)
        if (db === undefined) throw new StorageError('Unknown project')
        recordCheckedPage(storage.db, db, job, finishedAt, runId)
      },
      close
    }
  } catch (error) {
    for (const db of projectDbs.values()) closeProjectDatabase(db)
    if (ownsStorage) storage.close()
    throw error
  }
}

function openCommandStorage(
  input: CheckDueCommandInput,
  clock: Clock,
  timeZone: string
): CheckDueStorage | null {
  if (input.storage !== undefined) {
    return openCheckDueStorage({ storage: input.storage, clock, timeZone })
  }
  if (input.userData === undefined) return null
  return openCheckDueStorage({ userData: input.userData, clock, timeZone })
}

function openOwnedStorage(userData: string | undefined): AppStorage {
  if (userData === undefined) throw new StorageError('Check storage needs a user data directory')
  return openAppStorage(userData)
}

function sqliteDuePassStore(db: SqliteDatabase, today: () => string): DuePassStore {
  return {
    read(): DuePassRecord | null {
      return getDayPass(db, today())
    },
    write(record: DuePassRecord): void {
      setDayPass(db, record.day, { jobIds: [...record.jobIds], pages: record.pages })
    }
  }
}

/**
 * Catalog and queue caps for every project. Served from the per-storage cache,
 * which re-reads only when settings, a project row, or a project file changed.
 */
export function readStoredCheckCatalog(storage: AppStorage): StoredCheckCatalog {
  return checkCatalogCache(storage).read()
}

/**
 * Stores a successful page check on the open app database.
 * Opens that project's file for the write and closes it.
 * `setFixFollowUpRun` runs only when the job names a fix and `runId` is set.
 * The verdict is left untouched.
 */
export function recordStoredCheck(
  storage: AppStorage,
  job: RunningJob,
  finishedAt: string,
  runId?: string
): void {
  const project = getProject(storage.db, job.projectId)
  if (project === null) throw new StorageError('Unknown project')
  recordCheckedPage(
    storage.db,
    projectDatabasePool(storage).get(project.slug),
    job,
    finishedAt,
    runId
  )
  checkCatalogCache(storage).invalidate()
}

function readOpenProjects(
  storage: AppStorage,
  projectDbs: Map<string, SqliteDatabase>
): { catalog: CheckCatalog; queueProjects: QueueProjectInput[] } {
  const app = readAppSchedule(storage.paths.settingsFile)
  const projects: ScheduledProjectInput[] = []
  const pages: ScheduledPageInput[] = []
  const followUps: FixFollowUpInput[] = []
  const topicBatches: TopicBatchInput[] = []
  const queueProjects: QueueProjectInput[] = []
  for (const project of listProjects(storage.db)) {
    const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
    projectDbs.set(project.id, db)
    const slice = readProjectCheckSlice(db, project)
    projects.push(slice.scheduledProject)
    queueProjects.push(slice.queueProject)
    pages.push(...slice.pages)
    followUps.push(...slice.followUps)
    topicBatches.push(...slice.topicBatches)
  }
  return { catalog: { app, projects, pages, followUps, topicBatches }, queueProjects }
}

function recordCheckedPage(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  job: RunningJob,
  finishedAt: string,
  runId?: string
): void {
  const writeProject = projectDb.transaction(() => {
    for (const marketId of job.marketIds) {
      setPageMarketLastCheckedAt(projectDb, job.pageId, marketId, finishedAt)
    }
    if (job.reason === 'follow_up' && job.fixId !== undefined && runId !== undefined) {
      setFixFollowUpRun(projectDb, job.fixId, runId)
    }
    if (job.topicBatchId !== undefined) {
      markTopicBatchStarted(projectDb, job.topicBatchId, job.id, finishedAt)
    }
  })
  writeProject()
  const page = getPage(projectDb, job.pageId, job.projectId)
  if (page === null) return
  const label = page.label ?? page.title ?? page.url ?? page.id
  appendTrayCheck(appDb, {
    id: randomUUID(),
    projectId: job.projectId,
    pageId: job.pageId,
    label,
    score: trayScore(page?.score ?? null),
    change: null,
    finishedAt
  })
}

function trayScore(score: number | null): number | null {
  if (score === null || !Number.isInteger(score) || score < 0 || score > 100) return null
  return score
}

function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length > 0 ? zone : 'UTC'
}
