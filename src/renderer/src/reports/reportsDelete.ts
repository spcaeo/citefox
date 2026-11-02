/**
 * Renderer adapter for `reports:delete`.
 * Request, result, and `ReportContractError` come from the shared IPC contract.
 * The in-memory list is only for unit tests. The screen calls `window.citefox`.
 */
import {
  REPORT_ERROR_MESSAGES,
  type CiteFoxApi,
  type DeleteReportScheduleRequest,
  type DeleteReportScheduleResult,
  type ReportContractError
} from '@shared/ipc'

export function reportNotFound(): ReportContractError {
  return {
    channel: 'reports:delete',
    code: 'not_found',
    message: REPORT_ERROR_MESSAGES.not_found
  }
}

export function isReportNotFound(value: unknown): value is ReportContractError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === 'not_found' &&
    'channel' in value &&
    value.channel === 'reports:delete'
  )
}

/** An all-projects schedule keeps a null project id. Null is not coerced to a string. */
export function toReportsDeleteRequest(schedule: {
  id: string
  projectId: string | null
}): DeleteReportScheduleRequest {
  return {
    projectId: schedule.projectId,
    scheduleId: schedule.id
  }
}

/**
 * Drop one schedule from a list. Past deliveries are not in this list.
 * A missing row, a project mismatch, or a second delete is `not_found`.
 */
export function applyReportsDelete<T extends { id: string; projectId: string | null }>(
  schedules: T[],
  request: DeleteReportScheduleRequest,
  deletedAt: string
): DeleteReportScheduleResult {
  const index = schedules.findIndex((item) => item.id === request.scheduleId)
  const found = index >= 0 ? schedules[index] : undefined
  if (!found || found.projectId !== request.projectId) return reportNotFound()
  schedules.splice(index, 1)
  return { ok: true, deletedAt }
}

interface MockSchedule {
  id: string
  projectId: string | null
}

let mockSchedules: MockSchedule[] = []

export function resetReportsDeleteMock(): void {
  mockSchedules = []
}

export function rememberScheduleForDelete(schedule: MockSchedule): void {
  mockSchedules.push({ id: schedule.id, projectId: schedule.projectId })
}

export function listedScheduleIds(): readonly string[] {
  return mockSchedules.map((item) => item.id)
}

/** In-memory stand-in used by unit tests. The screen does not call this. */
export function reportsDeleteMock(
  request: DeleteReportScheduleRequest,
  now: () => string = () => new Date().toISOString()
): Promise<DeleteReportScheduleResult> {
  return Promise.resolve(applyReportsDelete(mockSchedules, request, now()))
}

function citefoxDelete(): CiteFoxApi['reports:delete'] | null {
  if (typeof window === 'undefined') return null
  const channel = (window as Partial<Window>).citefox?.['reports:delete']
  return typeof channel === 'function' ? channel : null
}

export function deleteScheduledReport(
  request: DeleteReportScheduleRequest
): Promise<DeleteReportScheduleResult> {
  const channel = citefoxDelete()
  if (channel) return channel(request)
  return Promise.resolve(reportNotFound())
}
