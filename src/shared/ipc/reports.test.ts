import { describe, expect, test } from 'vitest'
import type {
  AutoExport,
  ChangeKind,
  DeliveryRecord,
  ExportSpec,
  ReportSchedule,
  ReportScheduleListItem,
  ReportTiming
} from '../domain'
import {
  AUTO_EXPORT_ERROR_MESSAGES,
  AUTO_EXPORT_UNAVAILABLE_NEXT_STEP,
  callIpcHandler,
  isAutoExportErrorChannel,
  isAutoExportErrorCode,
  isIpcEventChannel,
  isIpcInvokeChannel,
  isReportErrorChannel,
  isReportErrorCode,
  REPORT_ERROR_MESSAGES,
  type AutoExportUnavailable,
  type DeleteReportScheduleRequest,
  type DeleteReportScheduleResult,
  type IpcResult,
  type ListDeliveriesRequest,
  type ResendDeliveryRequest,
  type SendReportTestRequest,
  type SetReportScheduleStatusRequest
} from './index'
import { handlersReturning, type SameKeys } from './test-fixtures'

type ReportListShape = SameKeys<
  keyof ReportScheduleListItem,
  | 'id'
  | 'name'
  | 'projectId'
  | 'scope'
  | 'report'
  | 'timing'
  | 'format'
  | 'sections'
  | 'marketIds'
  | 'recipients'
  | 'accountId'
  | 'timeZone'
  | 'subject'
  | 'summaryStyle'
  | 'status'
  | 'createdAt'
  | 'nextSendAt'
>

type OnChangeTiming = Extract<ReportTiming, { kind: 'on_change' }>

type OnChangeShape = SameKeys<keyof OnChangeTiming, 'kind' | 'events' | 'scoreDropPoints'>

type OnChangeEvents = OnChangeTiming['events'] extends readonly ChangeKind[] ? true : never

type DeliveryShape = SameKeys<
  keyof DeliveryRecord,
  | 'id'
  | 'scheduleId'
  | 'at'
  | 'trigger'
  | 'projectId'
  | 'recipients'
  | 'outcome'
  | 'ok'
  | 'reason'
  | 'nextStep'
  | 'occurrenceKey'
>

type DeleteReportRequestShape = SameKeys<
  keyof DeleteReportScheduleRequest,
  'projectId' | 'scheduleId'
>

type DeleteReportProjectId = null extends DeleteReportScheduleRequest['projectId']
  ? string extends DeleteReportScheduleRequest['projectId']
    ? true
    : never
  : never

type DeleteReportSuccess = Extract<DeleteReportScheduleResult, { ok: true }>

type DeleteReportSuccessShape = SameKeys<keyof DeleteReportSuccess, 'ok' | 'deletedAt'>

type DeleteReportError = Extract<DeleteReportScheduleResult, { code: 'not_found' }>

type DeleteReportErrorShape = SameKeys<keyof DeleteReportError, 'channel' | 'code' | 'message'>

type AutoExportUnavailableShape = SameKeys<
  keyof AutoExportUnavailable,
  'code' | 'message' | 'nextStep'
>

type AutoExportGetResult = [IpcResult<'exports:getAuto'>] extends [
  AutoExport | AutoExportUnavailable
]
  ? [AutoExport | AutoExportUnavailable] extends [IpcResult<'exports:getAuto'>]
    ? true
    : never
  : never

type AutoExportSetResult = [IpcResult<'exports:setAuto'>] extends [
  AutoExport | AutoExportUnavailable
]
  ? [AutoExport | AutoExportUnavailable] extends [IpcResult<'exports:setAuto'>]
    ? true
    : never
  : never

const reportContractShape: ReportListShape &
  OnChangeShape &
  OnChangeEvents &
  DeliveryShape &
  DeleteReportRequestShape &
  DeleteReportProjectId &
  DeleteReportSuccessShape &
  DeleteReportErrorShape &
  AutoExportUnavailableShape &
  AutoExportGetResult &
  AutoExportSetResult = true

describe('IPC contract: scheduled reports', () => {
  test('scheduled report channels forward the request and reject the wrong arity', () => {
    expect(reportContractShape).toBe(true)
    const schedule: ReportSchedule = {
      id: 'sched-1',
      name: 'When the score drops',
      projectId: null,
      timing: {
        kind: 'on_change',
        events: ['lost_citation', 'score_drop'],
        scoreDropPoints: 5
      },
      format: 'summary',
      sections: ['overview'],
      marketIds: ['us-en'],
      recipients: ['ada@textbolt.com'],
      accountId: null,
      timeZone: 'UTC',
      subject: '{project} {score}',
      summaryStyle: 'client_friendly',
      status: 'active',
      createdAt: '2026-10-19T14:00:00.000Z'
    }
    const listed: ReportScheduleListItem = { ...schedule, nextSendAt: null }
    const weekly: ReportSchedule = {
      ...schedule,
      id: 'sched-2',
      timing: { kind: 'weekly', day: 1, time: '09:00' },
      projectId: 'textbolt'
    }
    const pausedProject: ReportScheduleListItem = { ...weekly, nextSendAt: null }
    const delivery: DeliveryRecord = {
      id: 'del-1',
      scheduleId: 'sched-1',
      at: '2026-10-19T15:00:00.000Z',
      trigger: 'on_change',
      projectId: null,
      recipients: ['ada@textbolt.com'],
      outcome: 'failed',
      ok: false,
      reason: 'Connection refused',
      nextStep: 'Fix in Email setup',
      occurrenceKey: null
    }
    const otherDelivery: DeliveryRecord = { ...delivery, id: 'del-2', scheduleId: 'sched-2' }
    const status: SetReportScheduleStatusRequest = { id: 'sched-1', status: 'paused' }
    const testSend: SendReportTestRequest = { scheduleId: 'sched-1', accountId: null }
    const listAll: ListDeliveriesRequest = {}
    const listOne: ListDeliveriesRequest = { scheduleId: 'sched-1' }
    const resend: ResendDeliveryRequest = { id: 'del-1' }
    const remove: DeleteReportScheduleRequest = { projectId: 'textbolt', scheduleId: 'sched-1' }
    const removeAll: DeleteReportScheduleRequest = { projectId: null, scheduleId: 'sched-all' }
    const missing: DeleteReportScheduleRequest = { projectId: 'textbolt', scheduleId: 'missing' }
    let saved: ReportSchedule | undefined
    const handlers = handlersReturning({
      'reports:list': () => [listed, pausedProject],
      'reports:save': (request) => {
        saved = request
        return {
          ...request,
          nextSendAt: request.timing.kind === 'on_change' ? null : '2026-10-26T09:00:00.000Z'
        }
      },
      'reports:setStatus': (request) => ({
        ...listed,
        status: request.status,
        nextSendAt: null
      }),
      'reports:sendTest': () => ({
        ok: true,
        host: 'smtp.gmail.com',
        testedAt: '2026-10-19T15:01:00.000Z',
        message: 'Sent.',
        nextStep: null
      }),
      'reports:delete': (request) =>
        request.scheduleId === 'missing'
          ? {
              channel: 'reports:delete',
              code: 'not_found',
              message: REPORT_ERROR_MESSAGES.not_found
            }
          : { ok: true, deletedAt: '2026-10-20T15:00:00.000Z' },
      'deliveries:list': (request) =>
        request.scheduleId === undefined ? [delivery, otherDelivery] : [delivery],
      'deliveries:resend': (request) => ({ ...delivery, id: request.id, outcome: 'sent', ok: true })
    })

    expect(isIpcInvokeChannel('reports:list')).toBe(true)
    expect(isIpcInvokeChannel('reports:save')).toBe(true)
    expect(isIpcInvokeChannel('reports:setStatus')).toBe(true)
    expect(isIpcInvokeChannel('reports:sendTest')).toBe(true)
    expect(isIpcInvokeChannel('reports:delete')).toBe(true)
    expect(isIpcInvokeChannel('deliveries:list')).toBe(true)
    expect(isIpcInvokeChannel('deliveries:resend')).toBe(true)
    expect(isIpcEventChannel('reports:list')).toBe(false)
    expect(isIpcEventChannel('deliveries:list')).toBe(false)
    expect(callIpcHandler(handlers, 'reports:list', [])).toEqual([listed, pausedProject])
    expect(listed.nextSendAt).toBeNull()
    expect(pausedProject.nextSendAt).toBeNull()
    expect(pausedProject.projectId).toBe('textbolt')
    expect(listed.timing).toEqual({
      kind: 'on_change',
      events: ['lost_citation', 'score_drop'],
      scoreDropPoints: 5
    })
    expect(callIpcHandler(handlers, 'reports:save', [schedule])).toMatchObject({
      id: 'sched-1',
      nextSendAt: null
    })
    expect(callIpcHandler(handlers, 'reports:save', [weekly])).toMatchObject({
      id: 'sched-2',
      nextSendAt: '2026-10-26T09:00:00.000Z'
    })
    expect(saved).toEqual(weekly)
    expect(callIpcHandler(handlers, 'reports:setStatus', [status])).toMatchObject({
      status: 'paused'
    })
    expect(callIpcHandler(handlers, 'reports:sendTest', [testSend])).toMatchObject({ ok: true })
    expect(isReportErrorCode('not_found')).toBe(true)
    expect(isReportErrorCode('deleted')).toBe(false)
    expect(isReportErrorChannel('reports:delete')).toBe(true)
    expect(isReportErrorChannel('reports:list')).toBe(false)
    expect(REPORT_ERROR_MESSAGES.not_found).toBe(
      'That schedule does not exist or is already deleted.'
    )
    expect(callIpcHandler(handlers, 'reports:delete', [remove])).toEqual({
      ok: true,
      deletedAt: '2026-10-20T15:00:00.000Z'
    })
    expect(removeAll.projectId).toBeNull()
    expect(callIpcHandler(handlers, 'reports:delete', [removeAll])).toEqual({
      ok: true,
      deletedAt: '2026-10-20T15:00:00.000Z'
    })
    expect(callIpcHandler(handlers, 'reports:delete', [missing])).toEqual({
      channel: 'reports:delete',
      code: 'not_found',
      message: REPORT_ERROR_MESSAGES.not_found
    })
    const unavailable: AutoExportUnavailable = {
      code: 'unavailable',
      message: AUTO_EXPORT_ERROR_MESSAGES.unavailable,
      nextStep: AUTO_EXPORT_UNAVAILABLE_NEXT_STEP
    }
    const autoHandlers = handlersReturning({
      'exports:getAuto': () => unavailable,
      'exports:setAuto': () => unavailable
    })
    const autoSpec: ExportSpec = {
      projectId: 'proj-1',
      scope: 'project',
      pageIds: [],
      viewId: null,
      marketIds: [],
      checks: 'latest',
      from: null,
      to: null,
      sections: ['overview'],
      format: 'csv',
      pdf: null,
      xlsx: null,
      csv: { delimiter: 'comma', bom: true },
      filenamePattern: '{project}-{page}-{date}.{ext}',
      timeZone: 'UTC'
    }
    expect(isAutoExportErrorCode('unavailable')).toBe(true)
    expect(isAutoExportErrorCode('no_folder')).toBe(true)
    expect(isAutoExportErrorCode('folder')).toBe(true)
    expect(isAutoExportErrorCode('not_found')).toBe(false)
    expect(isAutoExportErrorChannel('exports:chooseAutoFolder')).toBe(true)
    expect(isAutoExportErrorChannel('exports:getAuto')).toBe(true)
    expect(isAutoExportErrorChannel('exports:setAuto')).toBe(true)
    expect(isAutoExportErrorChannel('exports:preview')).toBe(false)
    expect(
      callIpcHandler(autoHandlers, 'exports:getAuto', [{ projectId: 'proj-1', pageId: null }])
    ).toEqual(unavailable)
    expect(
      callIpcHandler(autoHandlers, 'exports:setAuto', [
        {
          projectId: 'proj-1',
          pageId: null,
          enabled: false,
          destination: 'folder',
          folder: null,
          emailTo: null,
          spec: autoSpec
        }
      ])
    ).toEqual(unavailable)
    expect(callIpcHandler(handlers, 'deliveries:list', [listAll])).toEqual([
      delivery,
      otherDelivery
    ])
    expect(callIpcHandler(handlers, 'deliveries:list', [listOne])).toEqual([delivery])
    expect(callIpcHandler(handlers, 'deliveries:resend', [resend])).toMatchObject({
      id: 'del-1',
      outcome: 'sent',
      ok: true
    })
    expect(() => callIpcHandler(handlers, 'reports:list', [schedule])).toThrow(
      'Blocked IPC channel: reports:list received unexpected arguments'
    )
    expect(() => callIpcHandler(handlers, 'reports:save', [])).toThrow(/unexpected arguments/)
    expect(() => callIpcHandler(handlers, 'reports:setStatus', [])).toThrow(/unexpected arguments/)
    expect(() => callIpcHandler(handlers, 'reports:sendTest', [])).toThrow(/unexpected arguments/)
    expect(() => callIpcHandler(handlers, 'reports:delete', [])).toThrow(/unexpected arguments/)
    expect(() => callIpcHandler(handlers, 'deliveries:list', [])).toThrow(/unexpected arguments/)
    expect(() => callIpcHandler(handlers, 'deliveries:resend', [])).toThrow(/unexpected arguments/)
    const serialized = JSON.stringify({ listed, delivery })
    expect(serialized).not.toMatch(/secret|password|api[_-]?key|token/i)
    expect(Object.hasOwn(delivery, 'password')).toBe(false)
    expect(Object.hasOwn(listed, 'password')).toBe(false)
  })
})
