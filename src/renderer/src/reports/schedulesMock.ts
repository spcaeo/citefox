import type {
  DeliveryRecord,
  EmailTestResult,
  ReportSchedule,
  ReportScheduleListItem
} from '@shared/domain'
import { sampleAccounts, sampleDeliveries, sampleSchedules } from './scheduleFixtures'
import { applyReportsDelete, isReportNotFound } from './reportsDelete'
import type { SchedulesClient } from './schedulesClient'
import { SCHEDULE_NOT_FOUND, explainReportsError } from './scheduleModel'

/** Sample adapter for the Vite dev harness and unit tests. Not used by the production build. */
export function createMockSchedulesClient(): SchedulesClient {
  const schedules = sampleSchedules()
  const deliveries = sampleDeliveries()
  const accounts = sampleAccounts()
  return {
    listSchedules() {
      return Promise.resolve({ rows: schedules.map(cloneSchedule), unavailable: null })
    },
    saveSchedule(schedule) {
      const next = withNext(schedule, schedules)
      const index = schedules.findIndex((item) => item.id === next.id)
      if (index >= 0) schedules[index] = next
      else schedules.unshift(next)
      return Promise.resolve({ row: cloneSchedule(next), unavailable: null })
    },
    setStatus(request) {
      const found = schedules.find((item) => item.id === request.id)
      if (!found) {
        return Promise.resolve({
          row: null,
          unavailable: { reason: SCHEDULE_NOT_FOUND, nextStep: null }
        })
      }
      found.status = request.status
      return Promise.resolve({ row: cloneSchedule(found), unavailable: null })
    },
    sendTest(request) {
      const account =
        accounts.find((item) => item.id === request.accountId) ??
        accounts.find((item) => item.isDefault)
      const from = account?.fromAddress ?? 'you@example.com'
      const result: EmailTestResult = {
        ok: true,
        host: 'smtp.gmail.com',
        testedAt: '2026-10-20T15:00:00.000Z',
        message: `Sent to ${from} only.`,
        nextStep: null
      }
      return Promise.resolve({ result, unavailable: null })
    },
    sendNow(request) {
      const found = schedules.find((item) => item.id === request.scheduleId)
      if (!found) {
        return Promise.resolve({
          row: null,
          unavailable: { reason: SCHEDULE_NOT_FOUND, nextStep: null }
        })
      }
      const trigger = found.timing.kind
      const row: DeliveryRecord = {
        id: `now-${deliveries.length + 1}`,
        scheduleId: found.id,
        at: '2026-10-20T15:05:00.000Z',
        trigger,
        projectId: found.projectId,
        recipients: [...found.recipients],
        outcome: 'sent',
        ok: true,
        reason: null,
        nextStep: null,
        occurrenceKey: `now:${deliveries.length + 1}`
      }
      deliveries.unshift(row)
      return Promise.resolve({ row: cloneDelivery(row), unavailable: null })
    },
    listDeliveries() {
      return Promise.resolve({ rows: deliveries.map(cloneDelivery), unavailable: null })
    },
    resend(request) {
      const found = deliveries.find((item) => item.id === request.id)
      if (!found) {
        return Promise.resolve({
          row: null,
          unavailable: { reason: 'That delivery is not on this computer.', nextStep: null }
        })
      }
      found.outcome = 'sent'
      found.ok = true
      found.reason = null
      found.nextStep = null
      return Promise.resolve({ row: cloneDelivery(found), unavailable: null })
    },
    deleteSchedule(request) {
      const result = applyReportsDelete(schedules, request, '2026-10-20T15:04:00.000Z')
      if (isReportNotFound(result)) {
        return Promise.resolve({
          result: null,
          unavailable: explainReportsError(result),
          notFound: true
        })
      }
      return Promise.resolve({ result, unavailable: null, notFound: false })
    },
    listAccounts() {
      return Promise.resolve(accounts.map((item) => ({ ...item })))
    }
  }
}

function withNext(
  schedule: ReportSchedule,
  existing: readonly ReportScheduleListItem[]
): ReportScheduleListItem {
  const previous = existing.find((item) => item.id === schedule.id)
  let nextSendAt = previous?.nextSendAt ?? null
  if (schedule.timing.kind === 'on_change') nextSendAt = null
  else if (schedule.status === 'paused') nextSendAt = previous?.nextSendAt ?? null
  else if (nextSendAt === null) nextSendAt = '2026-10-26T13:00:00.000Z'
  return {
    ...schedule,
    sections: [...schedule.sections],
    marketIds: [...schedule.marketIds],
    recipients: [...schedule.recipients],
    timing: cloneTiming(schedule),
    nextSendAt
  }
}

function cloneSchedule(item: ReportScheduleListItem): ReportScheduleListItem {
  return {
    ...item,
    ...(item.scope ? { scope: { kind: item.scope.kind, ids: [...item.scope.ids] } } : {}),
    sections: [...item.sections],
    marketIds: [...item.marketIds],
    recipients: [...item.recipients],
    timing: cloneTiming(item)
  }
}

function cloneTiming(item: ReportSchedule): ReportSchedule['timing'] {
  if (item.timing.kind === 'on_change') {
    return {
      kind: 'on_change',
      events: [...item.timing.events],
      scoreDropPoints: item.timing.scoreDropPoints
    }
  }
  return { ...item.timing }
}

function cloneDelivery(item: DeliveryRecord): DeliveryRecord {
  return { ...item, recipients: [...item.recipients] }
}
