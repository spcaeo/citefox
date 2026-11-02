import type {
  AppSchedule,
  CheckDueResult,
  FixFollowUpInput,
  QueueStatus,
  SerpApiRotationMode,
  TrayLastCheck
} from '@shared/domain'
import {
  memoryDuePassStore,
  runCheckDue,
  type CheckCatalog,
  type DuePassStore
} from '../headless/check-due'
import type { Logger } from '../logging/logger'
import { createCheckQueue, type CheckQueue } from '../queue/check-queue'
import type { QueuePauseStore } from '../queue/pause-store'
import { unavailableCheckRunner, type CheckRunner } from '../queue/runner'
import type {
  CapAlert,
  CommittedSearchWrite,
  QueueKeyInput,
  QueueProjectInput,
  UsageSeedStore
} from '../queue/types'
import { emptyUsageSeed } from '../queue/usage'
import { defaultAppSchedule } from '../storage/settings'
import { memoryOsJobControl, type OsJobControl } from './os-job-control'
import type { Clock } from './clock'
import { planSchedule } from './due'
import type { DuePage, ScheduledPageInput, ScheduledProjectInput, TopicBatchInput } from './types'

/**
 * Schedule, cap, and tray facts the IPC handlers read.
 * `memoryScheduleStore` is the in-process stand-in tests and the handler wiring use.
 * Its app schedule starts as the stored SCH-1 default (`startAtLogin` true, SRS section 8).
 * `citefox --check-due` does not use this store. It reads `readAppSchedule` and
 * `readProjectSchedule`.
 */
export interface ScheduleStore {
  getApp(): AppSchedule
  saveApp(next: AppSchedule): void
  listProjects(): readonly ScheduledProjectInput[]
  getProject(projectId: string): ScheduledProjectInput | null
  saveProject(project: ScheduledProjectInput): void
  listPages(): readonly ScheduledPageInput[]
  savePage(page: ScheduledPageInput): void
  listFollowUps(): readonly FixFollowUpInput[]
  saveFollowUp(fix: FixFollowUpInput): void
  /** Staggered topic batches still waiting. Optional: stores without topics list none. */
  listTopicBatches?(): readonly TopicBatchInput[]
  listQueueProjects(): readonly QueueProjectInput[]
  saveQueueProject(project: QueueProjectInput): void
  listKeys(): readonly QueueKeyInput[]
  saveKeys(keys: readonly QueueKeyInput[]): void
  trayRunning(): boolean
  setTrayRunning(running: boolean): void
  lastChecks(): readonly TrayLastCheck[]
  setLastChecks(checks: readonly TrayLastCheck[]): void
}

export interface CheckSession {
  clock: Clock
  /** The computer's zone, read again on every refresh so a zone change is picked up. */
  readonly timeZone: string
  store: ScheduleStore
  queue: CheckQueue
  runner: CheckRunner
  sleep: (ms: number) => Promise<void>
  secrets: readonly string[]
  estimateSearches?: (page: DuePage) => number
  emitStatus: (status: QueueStatus) => void
  osJob: OsJobControl
  /** Shared with headless `--check-due` so the same local day does not run twice. */
  passStore: DuePassStore
  /** Month-to-date `key_usage`. Empty unless the caller passes `usageSeedFromStorage`. */
  usageSeedStore: UsageSeedStore
  /** Cap alerts the queue emitted. `notify` only, once per project per local month. */
  alerts: CapAlert[]
  /** Runner failures are logged after redaction. Omitted in tests. */
  logger?: Pick<Logger, 'error'>
  /** Current secrets, read when a check fails so the log can redact them. */
  loadSecrets?: () => readonly string[]
  refresh(): void
  catalog(): CheckCatalog
  /**
   * SCH-2. One due pass at a time in this process: the renderer's
   * `queue:checkDue`, the tray, and the wall-clock tick all join the pass that
   * is already running instead of starting a second one.
   */
  runDue(): Promise<CheckDueResult>
  /** Called after each due pass settles. The tray sends its one summary notification here. */
  onPassSettled(listener: () => void): void
}

export interface CreateCheckSessionInput {
  clock: Clock
  /** A fixed zone, or a function read on every refresh (the computer's zone can change). */
  timeZone: string | (() => string)
  store?: ScheduleStore
  runner?: CheckRunner
  sleep?: (ms: number) => Promise<void>
  secrets?: readonly string[]
  emitStatus?: (status: QueueStatus) => void
  claudeConcurrency?: number
  estimateSearches?: (page: DuePage) => number
  onCapAlert?: (alert: CapAlert) => void
  loadKeys?: () => readonly QueueKeyInput[]
  /** FR-11.2. Read on every allocation. Omitted: in order. */
  loadRotation?: () => SerpApiRotationMode
  loadClaudeConcurrency?: () => number
  passStore?: DuePassStore
  usageSeedStore?: UsageSeedStore
  /** Writes each committed search to `key_usage` before the ledger counts it. */
  persistSearch?: (search: CommittedSearchWrite) => void
  logger?: Pick<Logger, 'error'>
  loadSecrets?: () => readonly string[]
  /** Skips a due page whose check job is already running. */
  pageRunning?: (projectId: string, pageId: string) => boolean
  /** Shared pause row (SCH-11). Omitted: the pause lasts only for this session. */
  pauseStore?: QueuePauseStore
  /** Longest in-pass wait for a later slot. Later work is left for the next pass. */
  maxWaitMs?: number
  /** SCH-1 OS job. Omitted: an in-memory job that never touches the OS. */
  osJob?: OsJobControl
}

export function createCheckSession(input: CreateCheckSessionInput): CheckSession {
  const store = input.store ?? memoryScheduleStore()
  const passStore = input.passStore ?? memoryDuePassStore()
  const usageSeedStore = input.usageSeedStore ?? emptyUsageSeed()
  const alerts: CapAlert[] = []
  const zone = (): string =>
    typeof input.timeZone === 'string' ? input.timeZone : input.timeZone()
  let timeZone = zone()
  let inflight: Promise<CheckDueResult> | null = null
  const passListeners: Array<() => void> = []
  const queue = createCheckQueue({
    clock: input.clock,
    timeZone,
    pauseStore: input.pauseStore,
    keys: [],
    projects: [],
    claudeConcurrency: input.claudeConcurrency,
    ...(input.loadRotation !== undefined ? { rotation: input.loadRotation } : {}),
    usageSeed: usageSeedStore.monthToDate(),
    persistSearch: input.persistSearch,
    pageRunning: input.pageRunning,
    onCapAlert: (alert) => {
      alerts.push(alert)
      input.onCapAlert?.(alert)
    }
  })
  const osJob = input.osJob ?? memoryOsJobControl()
  // The stored option follows what the OS really has (a removed plist or task reads as off).
  const stored = store.getApp()
  if (stored.checkWhenClosed !== osJob.registered) {
    store.saveApp({ ...stored, checkWhenClosed: osJob.registered })
  }
  const session: CheckSession = {
    clock: input.clock,
    get timeZone(): string {
      return timeZone
    },
    store,
    queue,
    runner: input.runner ?? unavailableCheckRunner(),
    sleep: input.sleep ?? delay,
    secrets: input.secrets ?? [],
    estimateSearches: input.estimateSearches,
    emitStatus: input.emitStatus ?? ((): void => undefined),
    osJob,
    passStore,
    usageSeedStore,
    alerts,
    logger: input.logger,
    loadSecrets: input.loadSecrets,
    refresh(): void {
      timeZone = zone()
      queue.setTimeZone(timeZone)
      const concurrency = input.loadClaudeConcurrency?.() ?? input.claudeConcurrency
      if (concurrency !== undefined) queue.setClaudeConcurrency(concurrency)
      const loaded = input.loadKeys?.()
      if (loaded !== undefined) store.saveKeys(loaded)
      queue.setKeys(store.listKeys())
      queue.setProjects(syncQueueProjects(store))
      queue.syncUsage(usageSeedStore.monthToDate())
      queue.setTrayRunning(store.trayRunning())
      queue.setHeadlessJob(osJob.registered)
      const plan = planSchedule(session.catalog(), input.clock.now(), timeZone)
      const due = plan.projects.reduce((sum, project) => sum + project.pagesDueToday, 0)
      queue.setPagesDue(due)
    },
    catalog(): CheckCatalog {
      return {
        app: store.getApp(),
        projects: store.listProjects(),
        pages: store.listPages(),
        followUps: store.listFollowUps(),
        topicBatches: store.listTopicBatches?.() ?? []
      }
    },
    runDue(): Promise<CheckDueResult> {
      if (inflight !== null) return inflight
      inflight = runPass().finally(() => {
        inflight = null
        for (const listener of passListeners) {
          try {
            listener()
          } catch (error: unknown) {
            session.logger?.error('CiteFox could not finish a due pass', error)
          }
        }
      })
      return inflight
    },
    onPassSettled(listener: () => void): void {
      passListeners.push(listener)
    }
  }

  async function runPass(): Promise<CheckDueResult> {
    session.refresh()
    const result = await runCheckDue({
      clock: session.clock,
      timeZone: session.timeZone,
      runner: session.runner,
      catalog: session.catalog(),
      queue: session.queue,
      sleep: session.sleep,
      estimateSearches: session.estimateSearches,
      secrets: session.loadSecrets?.() ?? session.secrets,
      logger: session.logger,
      passStore: session.passStore,
      usageSeedStore: session.usageSeedStore,
      maxWaitMs: input.maxWaitMs,
      onStatus: (status) => {
        session.emitStatus(status)
      }
    })
    return result.pass
  }
  session.refresh()
  return session
}

export function memoryScheduleStore(
  seed: {
    app?: AppSchedule
    projects?: readonly ScheduledProjectInput[]
    pages?: readonly ScheduledPageInput[]
    followUps?: readonly FixFollowUpInput[]
    queueProjects?: readonly QueueProjectInput[]
    keys?: readonly QueueKeyInput[]
    trayRunning?: boolean
    lastChecks?: readonly TrayLastCheck[]
  } = {}
): ScheduleStore {
  let app = seed.app ?? defaultAppSchedule()
  const projects = new Map((seed.projects ?? []).map((project) => [project.projectId, project]))
  const pages = new Map(
    (seed.pages ?? []).map((page) => [pageKey(page.projectId, page.pageId), page])
  )
  const followUps = new Map((seed.followUps ?? []).map((fix) => [fix.id, fix]))
  const queueProjects = new Map(
    (seed.queueProjects ?? []).map((project) => [project.projectId, project])
  )
  let keys = [...(seed.keys ?? [])]
  let trayRunning = seed.trayRunning ?? false
  let lastChecks = [...(seed.lastChecks ?? [])]
  return {
    getApp: () => app,
    saveApp(next: AppSchedule): void {
      app = next
    },
    listProjects: () => [...projects.values()],
    getProject: (projectId: string) => projects.get(projectId) ?? null,
    saveProject(project: ScheduledProjectInput): void {
      projects.set(project.projectId, project)
    },
    listPages: () => [...pages.values()],
    savePage(page: ScheduledPageInput): void {
      pages.set(pageKey(page.projectId, page.pageId), page)
    },
    listFollowUps: () => [...followUps.values()],
    saveFollowUp(fix: FixFollowUpInput): void {
      followUps.set(fix.id, fix)
    },
    listQueueProjects: () => [...queueProjects.values()],
    saveQueueProject(project: QueueProjectInput): void {
      queueProjects.set(project.projectId, project)
    },
    listKeys: () => keys,
    saveKeys(next: readonly QueueKeyInput[]): void {
      keys = [...next]
    },
    trayRunning: () => trayRunning,
    setTrayRunning(running: boolean): void {
      trayRunning = running
    },
    lastChecks: () => lastChecks,
    setLastChecks(checks: readonly TrayLastCheck[]): void {
      lastChecks = [...checks]
    }
  }
}

function syncQueueProjects(store: ScheduleStore): QueueProjectInput[] {
  const byId = new Map(store.listQueueProjects().map((project) => [project.projectId, project]))
  for (const project of store.listProjects()) {
    const existing = byId.get(project.projectId)
    if (existing === undefined) {
      byId.set(project.projectId, {
        projectId: project.projectId,
        name: project.projectId,
        cap: null,
        capRule: 'pause',
        dedicatedKeyId: null,
        paused: project.paused
      })
    } else {
      byId.set(project.projectId, { ...existing, paused: project.paused })
    }
  }
  return [...byId.values()]
}

function pageKey(projectId: string, pageId: string): string {
  return `${projectId}\0${pageId}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
