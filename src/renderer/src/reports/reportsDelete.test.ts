import { afterEach, describe, expect, it } from 'vitest'
import type { DeliveryRecord } from '@shared/domain'
import { REPORT_ERROR_MESSAGES } from '@shared/ipc'
import {
  deleteScheduledReport,
  listedScheduleIds,
  rememberScheduleForDelete,
  reportsDeleteMock,
  resetReportsDeleteMock,
  toReportsDeleteRequest
} from './reportsDelete'

const DELETED_AT = '2026-10-20T15:04:00.000Z'
const NOT_FOUND = {
  channel: 'reports:delete' as const,
  code: 'not_found' as const,
  message: REPORT_ERROR_MESSAGES.not_found
}

afterEach(() => {
  resetReportsDeleteMock()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('reports:delete adapter', () => {
  it('returns ok and an ISO deletedAt, then drops the schedule from the list', async () => {
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    rememberScheduleForDelete({ id: 'lost', projectId: null })
    const deliveries = [delivery('weekly')]

    const result = await reportsDeleteMock(
      { projectId: 'textbolt', scheduleId: 'weekly' },
      () => DELETED_AT
    )

    expect(result).toEqual({ ok: true, deletedAt: DELETED_AT })
    expect(listedScheduleIds()).toEqual(['lost'])
    expect(deliveries.map((item) => item.scheduleId)).toEqual(['weekly'])
  })

  it('returns not_found when the schedule is missing, already deleted, or in another project', async () => {
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    const request = { projectId: 'textbolt', scheduleId: 'weekly' }
    expect(await reportsDeleteMock(request, () => DELETED_AT)).toEqual({
      ok: true,
      deletedAt: DELETED_AT
    })
    expect(await reportsDeleteMock(request, () => DELETED_AT)).toEqual(NOT_FOUND)
    expect(
      await reportsDeleteMock({ projectId: 'textbolt', scheduleId: 'missing' }, () => DELETED_AT)
    ).toEqual(NOT_FOUND)
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    expect(
      await reportsDeleteMock({ projectId: 'other', scheduleId: 'weekly' }, () => DELETED_AT)
    ).toEqual(NOT_FOUND)
    expect(listedScheduleIds()).toEqual(['weekly'])
  })

  it('sends projectId null for an all-projects schedule and deletes it', async () => {
    rememberScheduleForDelete({ id: 'lost', projectId: null })
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    const request = toReportsDeleteRequest({ id: 'lost', projectId: null })
    expect(request).toEqual({ projectId: null, scheduleId: 'lost' })
    expect(await reportsDeleteMock(request, () => DELETED_AT)).toEqual({
      ok: true,
      deletedAt: DELETED_AT
    })
    expect(listedScheduleIds()).toEqual(['weekly'])
  })

  it('returns not_found when a null project id does not match a string', async () => {
    rememberScheduleForDelete({ id: 'lost', projectId: null })
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    expect(
      await reportsDeleteMock({ projectId: 'textbolt', scheduleId: 'lost' }, () => DELETED_AT)
    ).toEqual(NOT_FOUND)
    expect(
      await reportsDeleteMock({ projectId: null, scheduleId: 'weekly' }, () => DELETED_AT)
    ).toEqual(NOT_FOUND)
    expect(listedScheduleIds()).toEqual(['lost', 'weekly'])
  })

  it('calls window.citefox when the preload exposes reports:delete, and does not use the mock list', async () => {
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    const seen: unknown[] = []
    installDelete((request) => {
      seen.push(request)
      return Promise.resolve({ ok: true, deletedAt: DELETED_AT })
    })
    const request = toReportsDeleteRequest({ id: 'lost', projectId: null })
    expect(request).toEqual({ projectId: null, scheduleId: 'lost' })
    expect(await deleteScheduledReport(request)).toEqual({ ok: true, deletedAt: DELETED_AT })
    expect(seen).toEqual([request])
    expect(listedScheduleIds()).toEqual(['weekly'])

    installDelete(() => Promise.resolve(NOT_FOUND))
    expect(await deleteScheduledReport(request)).toEqual(NOT_FOUND)
    expect(listedScheduleIds()).toEqual(['weekly'])
  })

  it('returns not_found without the mock list when the channel is missing', async () => {
    rememberScheduleForDelete({ id: 'weekly', projectId: 'textbolt' })
    expect(await deleteScheduledReport({ projectId: 'textbolt', scheduleId: 'weekly' })).toEqual(
      NOT_FOUND
    )
    expect(listedScheduleIds()).toEqual(['weekly'])
  })
})

function delivery(scheduleId: string): DeliveryRecord {
  return {
    id: 'h1',
    scheduleId,
    at: '2026-10-19T13:00:00.000Z',
    trigger: 'weekly',
    projectId: 'textbolt',
    recipients: ['you@textbolt.com'],
    outcome: 'sent',
    ok: true,
    reason: null,
    nextStep: null,
    occurrenceKey: 'weekly:1'
  }
}

function installDelete(
  channel: (request: { projectId: string | null; scheduleId: string }) => Promise<unknown>
): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { citefox: { 'reports:delete': channel } }
  })
}
