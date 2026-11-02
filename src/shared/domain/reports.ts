/** Scheduled reports and delivery history. */

import { isOneOf } from './one-of'

/**
 * FR-23.7 report file. This is not `ExportFormat`: `excel` is the SRS word, and
 * `summary` is the email summary only. `html_link` is the stored id (kept so saved
 * schedules stay valid) of the interactive HTML report, which is attached as a .zip
 * folder with index.html and README.txt. Nothing is uploaded, so it is not a link.
 */
export const REPORT_FORMATS = ['pdf', 'excel', 'csv', 'html_link', 'summary'] as const

export type ReportFormat = (typeof REPORT_FORMATS)[number]

/** FR-23.12. A new schedule is active. Paused sends nothing. */
export const REPORT_SCHEDULE_STATUSES = ['active', 'paused'] as const

export type ReportScheduleStatus = (typeof REPORT_SCHEDULE_STATUSES)[number]

export const DEFAULT_REPORT_SCHEDULE_STATUS: ReportScheduleStatus = 'active'

/** FR-23.10. Null means the summary is not written by Claude. */
export const SUMMARY_STYLES = ['standard', 'client_friendly'] as const

export type SummaryStyle = (typeof SUMMARY_STYLES)[number]

/** FR-23.8. Page-level, from the check's cited count. Prompt-level is an open question. */
export const CHANGE_KINDS = [
  'lost_citation',
  'gained_citation',
  'score_drop',
  'check_failed'
] as const

export type ChangeKind = (typeof CHANGE_KINDS)[number]

/**
 * FR-23.7 timing.
 * Weekly `day` is ISO 1 (Monday) through 7 (Sunday). That numbering is an open question.
 * `scoreDropPoints` is N in FR-23.8. A drop must be greater than N, not equal to it.
 * `events` on `on_change` are the changes that send (FR-23.8).
 */
export type ReportTiming =
  | { kind: 'after_check' }
  | { kind: 'weekly'; day: 1 | 2 | 3 | 4 | 5 | 6 | 7; time: string }
  | { kind: 'monthly'; when: '1' | '15' | 'last'; time: string }
  | { kind: 'on_change'; events: readonly ChangeKind[]; scoreDropPoints: number }

/**
 * Which pages of the project a scheduled report covers. `project` (or no scope) is
 * the whole project. `pages` and `topic` hold page ids (a topic is its own subject
 * row); `group` and `cluster` hold site-structure ids, resolved to their pages when
 * the report is built, so a page added to the group later is in the next email.
 */
export const REPORT_SCOPE_KINDS = ['project', 'pages', 'group', 'cluster', 'topic'] as const

export type ReportScopeKind = (typeof REPORT_SCOPE_KINDS)[number]

export interface ReportScope {
  kind: ReportScopeKind
  /** Empty for `project`. */
  ids: readonly string[]
}

/** The most ids a stored report scope holds (a bigger pick is a group). */
export const MAX_REPORT_SCOPE_IDS = 500

/**
 * The ready reports a schedule can send (Docs/REPORT-SPEC.md "Ready reports"). The
 * same ids as `REPORT_KINDS` in src/shared/report/review (a test keeps them equal).
 */
export const SCHEDULED_REPORT_KINDS = [
  'visibility',
  'changed',
  'impact',
  'pitch',
  'content',
  'rival'
] as const

export type ScheduledReportKind = (typeof SCHEDULED_REPORT_KINDS)[number]

/**
 * Which ready report a schedule emails. Its PDF (or offline HTML for `html_link`) is
 * the attachment, built the way Reports' Download builds it, and its headline is the
 * email body. `rival` is Head-to-head's rival domain; null is the top competitor.
 */
export interface ScheduledReport {
  kind: ScheduledReportKind
  rival: string | null
}

export interface ReportSchedule {
  id: string
  name: string
  /** Null is every project (FR-23.7): one email per project. */
  projectId: string | null
  /**
   * The pages the report covers. Omitted or null is the whole project. Only a
   * schedule for one project can narrow it; an all-projects schedule ignores it.
   */
  scope?: ReportScope | null
  /**
   * The ready report it sends. Omitted or null is the check summary report built
   * from `sections` (every schedule made before ready reports could be picked).
   */
  report?: ScheduledReport | null
  timing: ReportTiming
  format: ReportFormat
  sections: readonly string[]
  marketIds: readonly string[]
  recipients: readonly string[]
  /** Null uses the default sending account (FR-23.5). */
  accountId: string | null
  timeZone: string
  /** May use `{project}`, `{date_range}`, `{market}`, and `{score}` (FR-23.7). */
  subject: string
  summaryStyle: SummaryStyle | null
  /**
   * FR-23.12. This module only reads `status`. A new schedule is `active`.
   * Nothing here writes `paused`. A paused schedule sends nothing.
   */
  status: ReportScheduleStatus
  /** ISO-8601 UTC. Occurrences before this are not due. */
  createdAt: string
}

/**
 * One row from `reports:list`.
 * `nextSendAt` is ISO-8601 UTC. Null for an `on_change` schedule or a paused project.
 */
export type ReportScheduleListItem = ReportSchedule & { nextSendAt: string | null }

/** Triggers the email engine records on a delivery (email engine commit 28e69e5). */
export const DELIVERY_TRIGGERS = [
  'account_test',
  'report_test',
  'after_check',
  'weekly',
  'monthly',
  'on_change',
  'check_summary',
  'slack',
  'cap',
  'monthly_pdf',
  'export'
] as const

export type DeliveryTrigger = (typeof DELIVERY_TRIGGERS)[number]

/**
 * `sent` means SMTP accepted the message. `draft` is waiting in the mail app.
 * `failed` was not sent. `ok` is true only when `outcome` is `sent`.
 */
export const DELIVERY_OUTCOMES = ['sent', 'draft', 'failed'] as const

export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number]

/**
 * FR-23.11. `outcome` is the source of truth.
 * `ok` is derived as `outcome === 'sent'` and is never stored on its own.
 * `draft` is FR-23.1: the mail app has the message and it has not been sent.
 * `occurrenceKey` is kept only for `sent` and `draft`. A failed row stores null
 * so the unique index does not block a retry.
 */
export interface DeliveryRecord {
  id: string
  scheduleId: string | null
  /** ISO-8601 UTC (NFR-15). */
  at: string
  trigger: DeliveryTrigger
  projectId: string | null
  recipients: readonly string[]
  outcome: DeliveryOutcome
  ok: boolean
  reason: string | null
  nextStep: string | null
  occurrenceKey: string | null
}

/**
 * A resend from Delivery history keeps the original trigger and stores an occurrence key
 * with this prefix, so the history can say "Resend". A failed row stores no key.
 */
export const RESEND_OCCURRENCE_PREFIX = 'resend:'

export function isResendDelivery(record: Pick<DeliveryRecord, 'occurrenceKey'>): boolean {
  return record.occurrenceKey?.startsWith(RESEND_OCCURRENCE_PREFIX) === true
}

/**
 * "Send now" from Reports (`reports:sendNow`) keeps the schedule's own trigger and
 * stores an occurrence key with this prefix, so the history can say "Sent now". It
 * never takes the slot of the next scheduled send.
 */
export const SEND_NOW_OCCURRENCE_PREFIX = 'now:'

export function isSendNowDelivery(record: Pick<DeliveryRecord, 'occurrenceKey'>): boolean {
  return record.occurrenceKey?.startsWith(SEND_NOW_OCCURRENCE_PREFIX) === true
}

export function isScheduledReportKind(value: string): value is ScheduledReportKind {
  return isOneOf(SCHEDULED_REPORT_KINDS, value)
}

/** A rival domain as Head-to-head takes it: a bare host such as `twilio.com`. */
export const RIVAL_DOMAIN = /^[a-z0-9.-]{1,253}$/i

export function isReportScopeKind(value: string): value is ReportScopeKind {
  return isOneOf(REPORT_SCOPE_KINDS, value)
}

export function isReportFormat(value: string): value is ReportFormat {
  return isOneOf(REPORT_FORMATS, value)
}

export function isReportScheduleStatus(value: string): value is ReportScheduleStatus {
  return isOneOf(REPORT_SCHEDULE_STATUSES, value)
}

export function isSummaryStyle(value: string): value is SummaryStyle {
  return isOneOf(SUMMARY_STYLES, value)
}

export function isChangeKind(value: string): value is ChangeKind {
  return isOneOf(CHANGE_KINDS, value)
}

export function isDeliveryTrigger(value: string): value is DeliveryTrigger {
  return isOneOf(DELIVERY_TRIGGERS, value)
}

export function isDeliveryOutcome(value: string): value is DeliveryOutcome {
  return isOneOf(DELIVERY_OUTCOMES, value)
}
