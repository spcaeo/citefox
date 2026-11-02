import type { ReportScheduleListItem, ReportScope, ScheduledReport } from '@shared/domain'
import { REPORT_ERROR_MESSAGES, type DeleteReportScheduleResult } from '@shared/ipc'
import { EmailError } from '../errors'
import type { ReportSchedule, ReportScheduleStore } from '../types'
import { nextSendAt, type ProjectSendFacts } from './next-send'
import { parseDeleteSchedule, parseReportSchedule, parseSetStatus } from './parse'

export interface ScheduleDeps {
  reports: ReportScheduleStore
  now(): Date
  projectFacts(projectId: string): ProjectSendFacts
}

/** FR-23.7. Every schedule, with `nextSendAt`. */
export function listSchedules(deps: ScheduleDeps): ReportScheduleListItem[] {
  return deps.reports.list().map((schedule) => listItem(deps, schedule))
}

/**
 * FR-23.7, FR-23.8, FR-23.12. A new row is `active` even when the request says
 * `paused`. An update keeps the stored status and `createdAt`. `accountId` null
 * stays null and means the default sender at send time.
 */
export function saveSchedule(deps: ScheduleDeps, request: unknown): ReportScheduleListItem {
  const parsed = parseReportSchedule(request)
  const existing = deps.reports.get(parsed.id)
  const schedule: ReportSchedule = {
    ...parsed,
    timing: copyTiming(parsed.timing),
    sections: [...parsed.sections],
    marketIds: [...parsed.marketIds],
    recipients: [...parsed.recipients],
    scope: copyScope(parsed.scope ?? null),
    report: copyReport(parsed.report ?? null),
    status: existing?.status ?? 'active',
    createdAt: existing?.createdAt ?? deps.now().toISOString()
  }
  deps.reports.save(schedule)
  return requireItem(deps, schedule.id)
}

/**
 * Soft-delete. Success is `{ ok: true, deletedAt }`.
 * A missing id, a project mismatch, or an already-deleted row is `not_found`.
 */
export function deleteSchedule(deps: ScheduleDeps, request: unknown): DeleteReportScheduleResult {
  const { projectId, scheduleId } = parseDeleteSchedule(request)
  const deletedAt = deps.reports.delete(projectId, scheduleId)
  if (deletedAt === null) {
    return {
      channel: 'reports:delete',
      code: 'not_found',
      message: REPORT_ERROR_MESSAGES.not_found
    }
  }
  return { ok: true, deletedAt }
}

/** FR-23.12. `paused` sends nothing. `active` resumes. */
export function setScheduleStatus(deps: ScheduleDeps, request: unknown): ReportScheduleListItem {
  const { id, status } = parseSetStatus(request)
  const existing = deps.reports.get(id)
  if (existing === null) throw new EmailError('Unknown report', 'not_found')
  deps.reports.save({ ...existing, status })
  return requireItem(deps, id)
}

function requireItem(deps: ScheduleDeps, id: string): ReportScheduleListItem {
  const stored = deps.reports.get(id)
  if (stored === null) throw new EmailError('Unknown report', 'not_found')
  return listItem(deps, stored)
}

function listItem(deps: ScheduleDeps, schedule: ReportSchedule): ReportScheduleListItem {
  const project = schedule.projectId === null ? null : deps.projectFacts(schedule.projectId)
  return {
    ...schedule,
    timing: copyTiming(schedule.timing),
    sections: [...schedule.sections],
    marketIds: [...schedule.marketIds],
    recipients: [...schedule.recipients],
    scope: copyScope(schedule.scope ?? null),
    report: copyReport(schedule.report ?? null),
    nextSendAt: nextSendAt(schedule, deps.now().getTime(), project)
  }
}

function copyScope(scope: ReportScope | null): ReportScope | null {
  return scope === null ? null : { kind: scope.kind, ids: [...scope.ids] }
}

function copyReport(report: ScheduledReport | null): ScheduledReport | null {
  return report === null ? null : { kind: report.kind, rival: report.rival }
}

function copyTiming(timing: ReportSchedule['timing']): ReportSchedule['timing'] {
  if (timing.kind !== 'on_change') return { ...timing }
  return { kind: 'on_change', scoreDropPoints: timing.scoreDropPoints, events: [...timing.events] }
}
