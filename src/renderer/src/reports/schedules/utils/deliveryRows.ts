import {
  isResendDelivery,
  isSendNowDelivery,
  type DeliveryOutcome,
  type DeliveryRecord,
  type DeliveryTrigger,
  type ReportScheduleListItem
} from '@shared/domain'
import { formatMoment } from '../../../utils/dates'
import { projectDisplay, type NamedProject } from '../../scheduleModel'
import { formatDayHeading, localDayKey } from './zoned'

/* Delivery history rows: what each send was, when, to whom, and how it went. */

/** "Sent Oct 19, 3:12 PM", in the schedule's zone and the computer's clock. */
export function resultPhrase(record: DeliveryRecord, timeZone: string): string {
  const when = formatMoment(record.at, { timeZone })
  if (record.outcome === 'failed') return `Failed ${when}`
  if (record.outcome === 'draft') return `Draft ${when}`
  return `Sent ${when}`
}

export function resultFacet(outcome: DeliveryOutcome): 'Sent' | 'Failed' | 'Draft' {
  if (outcome === 'failed') return 'Failed'
  if (outcome === 'draft') return 'Draft'
  return 'Sent'
}

export interface DeliveryRow {
  id: string
  at: string
  dayKey: string
  dayLabel: string
  dateLabel: string
  timeLabel: string
  name: string
  /** The schedule that sent it. Null for an account test or a deleted schedule. */
  scheduleId: string | null
  projectId: string | null
  project: string
  trigger: string
  recipients: string
  outcome: DeliveryOutcome
  result: 'Sent' | 'Failed' | 'Draft'
  reason: string | null
}

export function toDeliveryRow(
  record: DeliveryRecord,
  schedules: readonly ReportScheduleListItem[],
  projects: readonly NamedProject[],
  timeZone: string
): DeliveryRow {
  const schedule = schedules.find((item) => item.id === record.scheduleId) ?? null
  const projectId = record.projectId ?? schedule?.projectId ?? null
  return {
    id: record.id,
    at: record.at,
    dayKey: localDayKey(record.at, timeZone),
    dayLabel: formatDayHeading(record.at, timeZone),
    dateLabel: formatMoment(record.at, { timeZone }),
    timeLabel: new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(record.at)),
    name: schedule?.name ?? 'Report',
    scheduleId: schedule?.id ?? null,
    projectId,
    project: projectDisplay(projectId, projects).name,
    trigger: deliveryKindLabel(record),
    recipients: record.recipients.join(', '),
    outcome: record.outcome,
    result: resultFacet(record.outcome),
    reason: record.reason
  }
}

/**
 * What kind of send a delivery row was, from its own trigger. A test send of a monthly
 * schedule is "Test send", not "Monthly": the schedule's timing is not the kind.
 */
export function deliveryKindLabel(
  record: Pick<DeliveryRecord, 'trigger' | 'occurrenceKey'>
): string {
  if (isResendDelivery(record)) return 'Resend'
  if (isSendNowDelivery(record)) return 'Sent now'
  return DELIVERY_KIND_LABELS[record.trigger]
}

const DELIVERY_KIND_LABELS: Readonly<Record<DeliveryTrigger, string>> = {
  account_test: 'Account test',
  report_test: 'Test send',
  after_check: 'After check',
  weekly: 'Scheduled · Weekly',
  monthly: 'Scheduled · Monthly',
  on_change: 'On change',
  check_summary: 'Check summary',
  slack: 'Slack message',
  cap: 'Search cap alert',
  monthly_pdf: 'Monthly client PDF',
  export: 'Export'
}

export interface TimelineDay {
  key: string
  label: string
  count: number
  failed: number
  meta: string
  runs: DeliveryRow[]
}

/** Group deliveries into local days. Each day's count equals the runs in that day. */
export function timelineDays(
  rows: readonly DeliveryRow[],
  direction: 'asc' | 'desc'
): TimelineDay[] {
  const ordered = rows.slice().sort((left, right) => {
    const compared = left.at.localeCompare(right.at)
    return direction === 'asc' ? compared : -compared
  })
  const days: TimelineDay[] = []
  for (const row of ordered) {
    let group = days[days.length - 1]
    if (!group || group.key !== row.dayKey) {
      group = { key: row.dayKey, label: row.dayLabel, count: 0, failed: 0, meta: '', runs: [] }
      days.push(group)
    }
    group.runs.push(row)
    group.count = group.runs.length
    group.failed = group.runs.filter((item) => item.outcome === 'failed').length
    const sends = group.count === 1 ? '1 send' : `${group.count} sends`
    group.meta = group.failed > 0 ? `${sends} · ${group.failed} failed` : sends
  }
  return days
}

export function resendLabel(outcome: DeliveryOutcome, resent: boolean): string {
  if (resent) return outcome === 'failed' ? 'Sent now' : 'Resent'
  return outcome === 'failed' ? 'Retry' : 'Resend'
}

export function resendAria(row: DeliveryRow, resent: boolean): string {
  const verb = resent
    ? row.outcome === 'failed'
      ? 'Sent now'
      : 'Resent'
    : row.outcome === 'failed'
      ? 'Retry'
      : 'Resend'
  return `${verb} ${row.name}, ${row.dateLabel}`
}
