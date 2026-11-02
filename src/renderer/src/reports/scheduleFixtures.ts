import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import type { AccountOption } from './scheduleModel'

/**
 * Mock-up rows for the dev harness and unit tests.
 * Production builds do not import this module.
 */

const CHICAGO = 'America/Chicago'

function schedule(
  overrides: Omit<
    ReportScheduleListItem,
    | 'sections'
    | 'marketIds'
    | 'recipients'
    | 'status'
    | 'summaryStyle'
    | 'createdAt'
    | 'timeZone'
    | 'accountId'
    | 'subject'
  > &
    Partial<ReportScheduleListItem>
): ReportScheduleListItem {
  return {
    sections: ['results', 'progress', 'sentiment'],
    marketIds: ['us'],
    recipients: ['you@textbolt.com'],
    accountId: null,
    timeZone: CHICAGO,
    subject: '{project}: AI Overview report for {date_range}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-09-01T15:00:00.000Z',
    ...overrides
  }
}

export function sampleSchedules(): ReportScheduleListItem[] {
  return [
    schedule({
      id: 'weekly',
      name: 'TextBolt weekly summary',
      projectId: 'textbolt',
      timing: { kind: 'weekly', day: 1, time: '08:00' },
      format: 'pdf',
      nextSendAt: '2026-10-26T13:00:00.000Z'
    }),
    schedule({
      id: 'acme',
      name: 'Acme monthly client report',
      projectId: 'acme',
      timing: { kind: 'monthly', when: '1', time: '07:00' },
      format: 'pdf',
      sections: ['results', 'progress', 'sentiment', 'markets', 'gaps'],
      recipients: ['marketing@acmeclinics.example', 'you@textbolt.com'],
      nextSendAt: '2026-11-01T13:00:00.000Z'
    }),
    schedule({
      id: 'lost',
      name: 'Lost-citation alert',
      projectId: null,
      timing: { kind: 'on_change', events: ['lost_citation'], scoreDropPoints: 10 },
      format: 'summary',
      sections: [],
      recipients: ['ops@textbolt.com'],
      nextSendAt: null
    }),
    schedule({
      id: 'field',
      name: 'FieldPro after each check',
      projectId: 'fieldpro',
      timing: { kind: 'after_check' },
      format: 'excel',
      sections: ['results', 'prompts'],
      nextSendAt: null
    })
  ]
}

export function sampleDeliveries(): DeliveryRecord[] {
  return [
    delivery(
      'h1',
      '2026-10-19T13:00:00.000Z',
      'weekly',
      'textbolt',
      ['you@textbolt.com'],
      'sent',
      'weekly',
      null
    ),
    delivery(
      'h2',
      '2026-10-19T11:42:00.000Z',
      'lost',
      null,
      ['ops@textbolt.com'],
      'sent',
      'on_change',
      null
    ),
    delivery(
      'h3',
      '2026-10-12T13:00:00.000Z',
      'weekly',
      'textbolt',
      ['you@textbolt.com'],
      'sent',
      'weekly',
      null
    ),
    delivery(
      'h4',
      '2026-10-07T19:31:00.000Z',
      'field',
      'fieldpro',
      ['you@textbolt.com'],
      'failed',
      'after_check',
      'SMTP sign-in failed: 535 authentication failed (Gmail)'
    ),
    delivery(
      'h5',
      '2026-10-05T13:00:00.000Z',
      'weekly',
      'textbolt',
      ['you@textbolt.com'],
      'sent',
      'weekly',
      null
    ),
    delivery(
      'h6',
      '2026-10-01T12:00:00.000Z',
      'acme',
      'acme',
      ['marketing@acmeclinics.example', 'you@textbolt.com'],
      'sent',
      'monthly',
      null
    )
  ]
}

function delivery(
  id: string,
  at: string,
  scheduleId: string,
  projectId: string | null,
  recipients: string[],
  outcome: 'sent' | 'failed',
  trigger: DeliveryRecord['trigger'],
  reason: string | null
): DeliveryRecord {
  return {
    id,
    scheduleId,
    at,
    trigger,
    projectId,
    recipients,
    outcome,
    ok: outcome === 'sent',
    reason,
    nextStep: outcome === 'failed' ? 'Fix the sending account in Email setup.' : null,
    occurrenceKey: outcome === 'sent' ? id : null
  }
}

/** Sending accounts for the mock adapter. */
export function sampleAccounts(): AccountOption[] {
  return [
    {
      id: 'gmail',
      label: 'Gmail · you@example.com',
      fromAddress: 'you@example.com',
      isDefault: true
    },
    {
      id: 'ses',
      label: 'Amazon SES · reports@example.com',
      fromAddress: 'reports@example.com',
      isDefault: false
    }
  ]
}
