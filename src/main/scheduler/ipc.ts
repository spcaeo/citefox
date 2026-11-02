import { isIntervalDays } from '@shared/domain'
import type {
  ApiKeyMetadata,
  AppSchedule,
  DueList,
  ProjectSchedule,
  QueueStatus
} from '@shared/domain'
import type {
  AppSchedulePatch,
  DueListRequest,
  ProjectIdRequest,
  UpdateProjectScheduleRequest
} from '@shared/ipc'
import { rotationMode } from '../engine/checks/key-rotation'
import { recordStoredCheck } from '../headless/storage-pass'
import { IpcRequestError } from '../ipc-request'
import type { Logger } from '../logging/logger'
import { createQueueHandlers, queueKeysFromApiKeys } from '../queue/ipc'
import { recordingCheckRunner, type CheckRunner } from '../queue/runner'
import type { CapAlert } from '../queue/types'
import { persistCommittedSearch, usageSeedFromStorage } from '../queue/usage'
import { shouldRecordTrayCheck } from '../tray/record'
import { createTrayHandlers } from '../tray/ipc'
import type { AppStorage } from '../storage/app-storage'
import { getDayPass, setDayPass } from '../storage/day-pass'
import { sqliteQueuePauseStore } from '../storage/queue-pause'
import { formatInstant, parseClockTime } from './clock-time'
import { planSchedule } from './due'
import { ScheduleError } from './errors'
import { OsJobError } from './os-job'
import type { OsJobControl } from './os-job-control'
import { localDateKey, monthKey } from './local-time'
import type { CheckSession } from './session'
import { createCheckSession } from './session'
import { storageScheduleStore } from './storage-store'
import type { ScheduledProjectInput } from './types'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

/**
 * The tray waits inside a pass only for a short gap (a rate-limit retry).
 * A later spread batch is left to the next wall-clock tick, so a pass never
 * sleeps through the computer's sleep with a timer.
 */
export const TRAY_MAX_WAIT_MS = 60_000
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface ScheduleHandlers {
  getApp(): AppSchedule
  updateApp(request: unknown): AppSchedule
  getProject(request: unknown): ProjectSchedule
  updateProject(request: unknown): ProjectSchedule
  listDue(request: unknown): DueList
}

export function createScheduleHandlers(session: CheckSession): ScheduleHandlers {
  return {
    getApp(): AppSchedule {
      return session.store.getApp()
    },
    updateApp(request: unknown): AppSchedule {
      const patch = parseAppPatch(request)
      const next: AppSchedule = { ...session.store.getApp(), ...patch }
      assertSchedule(() => {
        parseClockTime(next.dailyCheckTime, 'daily check time')
      }, 'schedule:updateApp')
      const previous = session.store.getApp()
      applyOsJob(session, previous, next)
      session.store.saveApp({ ...next, checkWhenClosed: session.osJob.registered })
      session.refresh()
      return session.store.getApp()
    },
    getProject(request: unknown): ProjectSchedule {
      const { projectId } = parseProjectId(request, 'schedule:getProject')
      return projectView(session, projectId, 'schedule:getProject')
    },
    updateProject(request: unknown): ProjectSchedule {
      const patch = parseProjectPatch(request)
      const current = session.store.getProject(patch.projectId)
      if (current === null) throw new IpcRequestError('schedule:updateProject', 'Unknown project')
      const next: ScheduledProjectInput = {
        ...current,
        defaultIntervalDays: patch.defaultIntervalDays ?? current.defaultIntervalDays,
        dailyCheckTime: patch.dailyCheckTime ?? current.dailyCheckTime,
        quietFrom: patch.quietFrom === undefined ? current.quietFrom : patch.quietFrom,
        quietUntil: patch.quietUntil === undefined ? current.quietUntil : patch.quietUntil,
        spreadAcrossDay: patch.spreadAcrossDay ?? current.spreadAcrossDay,
        catchUp: patch.catchUp ?? current.catchUp,
        paused: patch.paused ?? current.paused
      }
      const preview = session.catalog()
      assertSchedule(() => {
        planSchedule(
          {
            app: preview.app,
            projects: preview.projects.map((project) =>
              project.projectId === next.projectId ? next : project
            ),
            pages: preview.pages,
            followUps: preview.followUps
          },
          session.clock.now(),
          session.timeZone
        )
      }, 'schedule:updateProject')
      session.store.saveProject(next)
      session.refresh()
      return projectView(session, patch.projectId, 'schedule:updateProject')
    },
    listDue(request: unknown): DueList {
      const { projectId } = parseDueList(request)
      if (projectId !== null && session.store.getProject(projectId) === null) {
        throw new IpcRequestError('schedule:listDue', 'Unknown project')
      }
      const plan = planSchedule(session.catalog(), session.clock.now(), session.timeZone)
      const pages =
        projectId === null
          ? plan.due.pages
          : plan.due.pages.filter((page) => page.projectId === projectId)
      return { day: plan.due.day, pages }
    }
  }
}

/**
 * Wires schedule, queue, and tray handlers for `src/main/handlers.ts`.
 * One process-lifetime session. The catalog, caps, stagger holds, planned fixes,
 * day pass, and month usage are read from `storage`.
 */
export function bindScheduleQueueTray(input: {
  now: () => Date
  timeZone?: string
  emit: (status: QueueStatus) => void
  claudeConcurrency: () => number
  keys: () => readonly ApiKeyMetadata[]
  storage: AppStorage
  /**
   * Production passes Engine's `createCheckRunner`.
   * Tests omit it, and a due page fails closed instead of being marked checked.
   */
  runner?: CheckRunner
  logger?: Pick<Logger, 'error'>
  loadSecrets?: () => readonly string[]
  /** Skips a due page whose check job is already running. */
  pageRunning?: (projectId: string, pageId: string) => boolean
  /** SCH-1 OS job. Omitted: an in-memory job (tests, development, e2e). */
  osJob?: OsJobControl
  /** FR-11.4 `notify`: the queue refused a project at its cap (once per project and month). */
  onCapAlert?: (alert: CapAlert) => void
  /**
   * FR-22.6. Each successful check the session ran, after it is stored, and once
   * when each due pass settles. Automatic exports note the first and run on the second.
   */
  autoExport?: {
    note(check: { projectId: string; pageId: string; reason: string }): void
    flush(): Promise<void>
  }
}): {
  schedule: ScheduleHandlers
  queue: ReturnType<typeof createQueueHandlers>
  tray: ReturnType<typeof createTrayHandlers>
} {
  const fixedZone = input.timeZone
  const zone = (): string => fixedZone ?? systemTimeZone()
  const clock = { now: () => input.now().getTime() }
  const session = createCheckSession({
    clock,
    timeZone: zone,
    maxWaitMs: TRAY_MAX_WAIT_MS,
    emitStatus: input.emit,
    loadClaudeConcurrency: input.claudeConcurrency,
    loadKeys: () => queueKeysFromApiKeys(input.keys()),
    loadRotation: () => rotationMode(input.storage),
    store: storageScheduleStore(input.storage),
    runner: input.runner,
    logger: input.logger,
    loadSecrets: input.loadSecrets,
    pageRunning: input.pageRunning,
    osJob: input.osJob,
    onCapAlert: input.onCapAlert,
    pauseStore: sqliteQueuePauseStore(input.storage.db),
    passStore: {
      read: () => getDayPass(input.storage.db, localDateKey(clock.now(), zone())),
      write(record) {
        setDayPass(input.storage.db, record.day, {
          jobIds: [...record.jobIds],
          pages: record.pages
        })
      }
    },
    // The month is read on every call, so a session that runs past midnight on the 1st moves on.
    usageSeedStore: usageSeedFromStorage(input.storage.db, () => monthKey(clock.now(), zone())),
    persistSearch: persistCommittedSearch(input.storage.db)
  })
  const inner = session.runner
  session.runner = recordingCheckRunner(inner, (job, ok) => {
    if (!shouldRecordTrayCheck(ok)) return
    recordStoredCheck(input.storage, job, formatInstant(clock.now()), ok.runId)
    input.autoExport?.note(job)
  })
  const autoExport = input.autoExport
  if (autoExport !== undefined) {
    session.onPassSettled(() => {
      void autoExport.flush()
    })
  }
  return {
    schedule: createScheduleHandlers(session),
    queue: createQueueHandlers(session),
    tray: createTrayHandlers(session)
  }
}

/**
 * SCH-1. Turning the option on installs the OS job; a new daily check time
 * reinstalls it with the new minute; turning it off removes it. A failure is
 * reported with the installer's sentence and the option stays as the OS has it.
 */
function applyOsJob(session: CheckSession, previous: AppSchedule, next: AppSchedule): void {
  const channel = 'schedule:updateApp'
  try {
    if (next.checkWhenClosed) {
      const timeChanged = previous.dailyCheckTime !== next.dailyCheckTime
      if (!session.osJob.registered || timeChanged) session.osJob.register(next.dailyCheckTime)
    } else if (session.osJob.registered) {
      session.osJob.remove()
    }
  } catch (error: unknown) {
    if (error instanceof OsJobError) {
      session.store.saveApp({ ...next, checkWhenClosed: session.osJob.registered })
      session.refresh()
      throw new IpcRequestError(channel, error.message)
    }
    throw error
  }
}

function projectView(session: CheckSession, projectId: string, channel: string): ProjectSchedule {
  const plan = planSchedule(session.catalog(), session.clock.now(), session.timeZone)
  const project = plan.projects.find((item) => item.projectId === projectId)
  if (project === undefined) throw new IpcRequestError(channel, 'Unknown project')
  return project
}

function parseAppPatch(value: unknown): AppSchedulePatch {
  const channel = 'schedule:updateApp'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    ['startAtLogin', 'catchUpAfterSleep', 'checkWhenClosed', 'dailyCheckTime'],
    ['startAtLogin', 'catchUpAfterSleep', 'checkWhenClosed', 'dailyCheckTime']
  )
  const patch: AppSchedulePatch = {}
  if (has(record, 'startAtLogin')) patch.startAtLogin = readBoolean(record.startAtLogin, channel)
  if (has(record, 'catchUpAfterSleep')) {
    patch.catchUpAfterSleep = readBoolean(record.catchUpAfterSleep, channel)
  }
  if (has(record, 'checkWhenClosed')) {
    patch.checkWhenClosed = readBoolean(record.checkWhenClosed, channel)
  }
  if (has(record, 'dailyCheckTime'))
    patch.dailyCheckTime = readClock(record.dailyCheckTime, channel)
  return patch
}

function parseProjectPatch(value: unknown): UpdateProjectScheduleRequest {
  const channel = 'schedule:updateProject'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    [
      'projectId',
      'defaultIntervalDays',
      'dailyCheckTime',
      'quietFrom',
      'quietUntil',
      'spreadAcrossDay',
      'catchUp',
      'paused'
    ],
    [
      'defaultIntervalDays',
      'dailyCheckTime',
      'quietFrom',
      'quietUntil',
      'spreadAcrossDay',
      'catchUp',
      'paused'
    ]
  )
  const request: UpdateProjectScheduleRequest = { projectId: readId(record.projectId, channel) }
  if (has(record, 'defaultIntervalDays')) {
    request.defaultIntervalDays = readInterval(record.defaultIntervalDays, channel)
  }
  if (has(record, 'dailyCheckTime'))
    request.dailyCheckTime = readClock(record.dailyCheckTime, channel)
  if (has(record, 'quietFrom')) request.quietFrom = readNullableClock(record.quietFrom, channel)
  if (has(record, 'quietUntil')) request.quietUntil = readNullableClock(record.quietUntil, channel)
  if (has(record, 'spreadAcrossDay')) {
    request.spreadAcrossDay = readBoolean(record.spreadAcrossDay, channel)
  }
  if (has(record, 'catchUp')) request.catchUp = readBoolean(record.catchUp, channel)
  if (has(record, 'paused')) request.paused = readBoolean(record.paused, channel)
  return request
}

function parseProjectId(value: unknown, channel: string): ProjectIdRequest {
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

function parseDueList(value: unknown): DueListRequest {
  const channel = 'schedule:listDue'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId'])
  const projectId = record.projectId
  if (projectId === null) return { projectId: null }
  return { projectId: readId(projectId, channel) }
}

function assertSchedule(run: () => void, channel: string): void {
  try {
    run()
  } catch (error: unknown) {
    if (error instanceof ScheduleError) throw new IpcRequestError(channel, 'Invalid schedule')
    throw error
  }
}

function plainObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function requireKeys(
  record: Record<string, unknown>,
  channel: string,
  allowed: readonly string[],
  optional: readonly string[] = []
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of allowed) {
    if (optional.includes(key)) continue
    if (!has(record, key)) throw new IpcRequestError(channel)
  }
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function readBoolean(value: unknown, channel: string): boolean {
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function readClock(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !HH_MM.test(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableClock(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readClock(value, channel)
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readInterval(
  value: unknown,
  channel: string
): UpdateProjectScheduleRequest['defaultIntervalDays'] {
  if (typeof value !== 'number' || !isIntervalDays(value)) throw new IpcRequestError(channel)
  return value
}

function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length > 0 ? zone : 'UTC'
}
