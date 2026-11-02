import { describe, expect, it } from 'vitest'
import { DELIVERY_TRIGGERS, type DeliveryRecord, type ReportScheduleListItem } from '@shared/domain'
import { toDeliveryRow } from './scheduleModel'

/**
 * Live check 2026-10-21: Delivery history showed the raw kind "account_test", and a
 * test send of a monthly schedule read "Monthly". The kind comes from the delivery's
 * own trigger, never from the schedule's timing.
 */
describe('delivery kind labels', () => {
  it.each<[Partial<DeliveryRecord>, string]>([
    [{ trigger: 'account_test', scheduleId: null }, 'Account test'],
    [{ trigger: 'report_test' }, 'Test send'],
    [{ trigger: 'weekly' }, 'Scheduled · Weekly'],
    [{ trigger: 'monthly' }, 'Scheduled · Monthly'],
    [{ trigger: 'after_check' }, 'After check'],
    [{ trigger: 'on_change' }, 'On change'],
    [{ trigger: 'weekly', occurrenceKey: 'resend:id-9' }, 'Resend']
  ])('%o reads %s', (overrides, label) => {
    expect(toDeliveryRow(delivery(overrides), [monthly()], [], 'UTC').trigger).toBe(label)
  })

  it('a test send of a monthly schedule is not labelled Monthly', () => {
    const row = toDeliveryRow(delivery({ trigger: 'report_test' }), [monthly()], [], 'UTC')
    expect(row.trigger).not.toMatch(/Monthly/)
  })

  it('every delivery trigger has a plain label', () => {
    for (const trigger of DELIVERY_TRIGGERS) {
      const label = toDeliveryRow(delivery({ trigger }), [], [], 'UTC').trigger
      expect(label).not.toContain('_')
      expect(label).not.toBe(trigger)
    }
  })
})

function monthly(): ReportScheduleListItem {
  return {
    id: 'sched-1',
    name: 'Monthly client report',
    projectId: null,
    timing: { kind: 'monthly', when: '1', time: '08:00' },
    format: 'pdf',
    sections: ['results'],
    marketIds: [],
    recipients: ['ada@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    nextSendAt: '2026-11-01T08:00:00.000Z'
  }
}

function delivery(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: 'del-1',
    scheduleId: 'sched-1',
    at: '2026-10-19T03:30:00.000Z',
    trigger: 'weekly',
    projectId: null,
    recipients: ['ada@example.com'],
    outcome: 'sent',
    ok: true,
    reason: null,
    nextStep: null,
    occurrenceKey: null,
    ...overrides
  }
}
