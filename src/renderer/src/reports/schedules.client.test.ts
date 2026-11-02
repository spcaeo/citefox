import { afterEach, describe, expect, it } from 'vitest'
import type { EmailTestResult, ReportScheduleListItem } from '@shared/domain'
import type { CiteFoxApi } from '@shared/ipc'
import { emptyDraft, buildSchedule } from './scheduleModel'
import { createLiveSchedulesClient } from './schedulesClient'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('reports IPC', () => {
  it('does not fall back to the mock in a production build', async () => {
    install(failingApi())
    const client = createLiveSchedulesClient()
    const listed = await client.listSchedules()
    expect(listed.rows).toEqual([])
    expect(listed.unavailable).toEqual({
      reason: 'The engine is busy.',
      nextStep: null
    })
    const ipc = createLiveSchedulesClient()
    expect((await ipc.listDeliveries()).rows).toEqual([])
    await expect(ipc.listAccounts()).rejects.toThrow()
  })

  it('returns an empty list when the handlers are implemented and have nothing to send', async () => {
    install({
      ...failingApi(),
      'reports:list': () => Promise.resolve([]),
      'deliveries:list': () => Promise.resolve([])
    })
    const client = createLiveSchedulesClient()
    expect((await client.listSchedules()).unavailable).toBeNull()
    expect((await client.listSchedules()).rows).toEqual([])
    expect((await client.listDeliveries()).rows).toEqual([])
  })

  it('strips the Electron invoke wrapper', async () => {
    install({
      ...failingApi(),
      'reports:list': () =>
        Promise.reject(
          new Error("Error invoking remote method 'reports:list': Error: The engine is busy.")
        ),
      'reports:save': () =>
        Promise.reject(
          new Error(
            "Error invoking remote method 'reports:save': Error: Add at least one recipient."
          )
        )
    })
    const client = createLiveSchedulesClient()
    const listed = await client.listSchedules()
    expect(listed.unavailable?.reason).toBe('The engine is busy.')
    expect(JSON.stringify(listed)).not.toContain('Error invoking remote method')
    expect(JSON.stringify(listed)).not.toContain('Error invoking remote method')
    const draft = emptyDraft('America/Toronto')
    draft.name = 'Monday report'
    draft.recipients = ['ada@example.com']
    const saved = await client.saveSchedule(
      buildSchedule(draft, 'sched-1', '2026-10-20T12:00:00.000Z')
    )
    expect(saved).toEqual({
      row: null,
      unavailable: { reason: 'Add at least one recipient.', nextStep: null }
    })
  })

  it('returns the handler row when save is implemented', async () => {
    const row = readyRow()
    const sent: EmailTestResult = {
      ok: true,
      host: 'smtp.example.com',
      testedAt: '2026-10-20T12:00:00.000Z',
      message: 'Sent',
      nextStep: null
    }
    install({
      ...failingApi(),
      'reports:save': () => Promise.resolve(row),
      'reports:sendTest': () => Promise.resolve(sent)
    })
    const client = createLiveSchedulesClient()
    expect((await client.saveSchedule(row)).row).toEqual(row)
    expect((await client.sendTest({ scheduleId: row.id, accountId: null })).result).toEqual(sent)
  })
})

function failingApi(): Partial<CiteFoxApi> {
  const fail = (channel: string) => () =>
    Promise.reject(
      new Error(`Error invoking remote method '${channel}': Error: The engine is busy.`)
    )
  return {
    'reports:list': fail('reports:list'),
    'reports:save': fail('reports:save'),
    'reports:setStatus': fail('reports:setStatus'),
    'reports:sendTest': fail('reports:sendTest'),
    'deliveries:list': fail('deliveries:list'),
    'deliveries:resend': fail('deliveries:resend'),
    'email:getSettings': fail('email:getSettings')
  }
}

function readyRow(): ReportScheduleListItem {
  return {
    ...buildSchedule(
      { ...emptyDraft('America/Toronto'), name: 'Monday report', recipients: ['ada@example.com'] },
      'sched-1',
      '2026-10-20T12:00:00.000Z'
    ),
    nextSendAt: null
  }
}

function install(api: Partial<CiteFoxApi>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { citefox: api }
  })
}
