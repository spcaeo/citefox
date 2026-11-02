import type { IpcHandlerMap, IpcInvokeChannel } from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import {
  closeProjectDatabase,
  getProject,
  openProjectDatabase,
  readProjectSchedule,
  StorageError,
  type SqliteDatabase
} from '../../storage'
import type { EngineEmail } from '../engine-email'
import type { ReportPayload, ReportSchedule } from '../types'
import { EmailError } from '../errors'
import { SmtpTransportError } from '../transport'
import { listDeliveryHistory, resendDelivery, sendScheduleNow, sendScheduleTest } from './deliver'
import type { ProjectSendFacts } from './next-send'
import { deleteSchedule, listSchedules, saveSchedule, setScheduleStatus } from './schedules'

type ReportChannel =
  | 'reports:list'
  | 'reports:save'
  | 'reports:setStatus'
  | 'reports:sendTest'
  | 'reports:delete'
  | 'reports:sendNow'
  | 'deliveries:list'
  | 'deliveries:resend'

/**
 * Scheduled-report invokes. FR-23.9 preview is not a channel: it does not send,
 * and nothing here builds that preview.
 */
export function bindReportIpcHandlers(
  email: EngineEmail,
  guard: <T>(channel: IpcInvokeChannel, run: () => Promise<T> | T) => Promise<T>,
  options: { payloadFor?: (schedule: ReportSchedule) => Promise<ReportPayload> } = {}
): Pick<IpcHandlerMap, ReportChannel> {
  const deps = {
    service: email.service,
    reports: email.reports,
    deliveries: email.deliveries,
    now: () => email.clock.now(),
    ...(options.payloadFor !== undefined ? { payloadFor: options.payloadFor } : {}),
    projectFacts: (projectId: string) => projectFacts(email.db, email.projectsDirectory, projectId)
  }
  const call = <T>(channel: ReportChannel, run: () => Promise<T> | T): Promise<T> =>
    guard(channel, () => settle(channel, run))
  return {
    'reports:list': () => call('reports:list', () => listSchedules(deps)),
    'reports:save': (request) => call('reports:save', () => saveSchedule(deps, request)),
    'reports:setStatus': (request) =>
      call('reports:setStatus', () => setScheduleStatus(deps, request)),
    'reports:sendTest': (request) =>
      call('reports:sendTest', () => sendScheduleTest(deps, request)),
    'reports:delete': (request) => call('reports:delete', () => deleteSchedule(deps, request)),
    'reports:sendNow': (request) => call('reports:sendNow', () => sendScheduleNow(deps, request)),
    'deliveries:list': (request) =>
      call('deliveries:list', () => listDeliveryHistory(deps, request)),
    'deliveries:resend': (request) => call('deliveries:resend', () => resendDelivery(deps, request))
  }
}

function projectFacts(
  db: SqliteDatabase,
  projectsDirectory: string,
  projectId: string
): ProjectSendFacts {
  const project = getProject(db, projectId)
  if (project === null) return { paused: true, nextCheckAt: null }
  const statusPaused = project.status === 'paused' || project.status === 'archived'
  let schedulePaused = false
  let nextCheckAt: string | null = null
  try {
    const projectDb = openProjectDatabase(projectsDirectory, project.slug)
    try {
      const schedule = readProjectSchedule(projectDb, projectId)
      schedulePaused = schedule.paused
      nextCheckAt = schedule.nextCheckAt
    } finally {
      closeProjectDatabase(projectDb)
    }
  } catch (error) {
    if (!(error instanceof StorageError)) throw error
  }
  return { paused: statusPaused || schedulePaused, nextCheckAt }
}

function settle<T>(channel: string, run: () => Promise<T> | T): Promise<T> | T {
  try {
    const result = run()
    if (isPromise(result)) {
      return result.then(
        (value) => value,
        (error: unknown) => {
          throw toIpcError(channel, error)
        }
      )
    }
    return result
  } catch (error: unknown) {
    throw toIpcError(channel, error)
  }
}

function toIpcError(channel: string, error: unknown): unknown {
  if (error instanceof EmailError || error instanceof SmtpTransportError) {
    return new IpcRequestError(channel, error.message)
  }
  return error
}

function isPromise<T>(value: Promise<T> | T): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function'
}
