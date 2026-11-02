import type { EmailAccount, EmailMode } from '@shared/domain'
import type {
  ChangeKind,
  DeliveryRecord,
  ReportSchedule,
  ReportTiming,
  SummaryStyle
} from '@shared/domain'
import { CHANGE_KINDS, SUMMARY_STYLES } from '@shared/domain'
import type { CheckFinishedNotice } from '@shared/ipc'

/**
 * Schedule and delivery shapes are the shared contract (FR-23.7, FR-23.8, FR-23.11).
 * `on_change` carries `events` and `scoreDropPoints`. A drop must be greater than N.
 */
export { CHANGE_KINDS, SUMMARY_STYLES }
export type { ChangeKind, DeliveryRecord, ReportSchedule, ReportTiming, SummaryStyle }

/**
 * FR-23.6. The Email screen shows these. The words are the SRS list.
 * Numbered provider setup steps stay UI copy (Docs/IPC.md) and are not invented here.
 */
export const DELIVERABILITY_TIPS = [
  'Send from the own domain.',
  'SPF, DKIM, DMARC.',
  'Attach the HTML report (.zip) instead of a PDF over 10 MB.'
] as const

/**
 * FR-23.6. "Over 10 MB" uses 10 × 1024 × 1024 bytes.
 * A decimal megabyte (10_000_000) is an open question.
 */
export const PDF_LINK_INSTEAD_BYTES = 10 * 1024 * 1024

/** FR-24.7. The notification action. */
export const VIEW_RESULTS = 'View results'

/**
 * Facts for subject tokens and the plain summary.
 * Null leaves the token in the subject. No placeholder word is invented.
 */
export interface ReportFacts {
  project: string | null
  dateRange: string | null
  market: string | null
  score: string | null
  lines: readonly string[]
}

export interface ReportAttachment {
  filename: string
  contentType: string
  bytes: Uint8Array
}

export interface ReportPayload {
  facts: ReportFacts
  attachment: ReportAttachment | null
}

/** FR-23.9. Preview does not send. */
export interface EmailPreview {
  subject: string
  text: string
}

export type SkipReason = 'paused' | 'disabled' | 'empty' | 'already_sent' | 'no_facts'

export type NotifyResult =
  { action: 'skipped'; reason: SkipReason } | { action: 'recorded'; delivery: DeliveryRecord }

/** SCH-7. Desktop notices plus the email and Slack results for one check. */
export interface CheckAlertResult {
  /** Set when the project is paused and nothing was sent (FR-23.12). */
  skipped: 'paused' | null
  notices: readonly DesktopNotice[]
  email: NotifyResult
  slack: NotifyResult
}

/** FR-24.7 desktop notice. The main process shows it. This module does not. */
export interface DesktopNotice {
  projectId: string
  pageId: string
  title: string
  body: string
  action: typeof VIEW_RESULTS
}

/** FR-23.8. Page-level, from the check's cited count. Prompt-level is an open question. */
export interface ChangeEvent {
  kind: ChangeKind
  pageId: string
  pageLabel: string
  /** Positive drop. Null unless `kind` is `score_drop`. */
  points: number | null
}

export interface PageCheckFacts {
  notice: CheckFinishedNotice
  /** FR-23.8 "a check failed". The finished notice has no failure field. */
  failed: boolean
  /** User cancel (NFR-3). Not a failure and not a finished check. */
  cancelled?: boolean
}

export interface EmailClock {
  now(): Date
  /** IANA zone for cap months and the monthly PDF date. Report schedules use their own zone. */
  timeZone: string
}

/** FR-23.10. Called fresh on every send. The module does not cache the text. */
export interface SummaryWriter {
  write(input: { style: SummaryStyle; facts: string }): Promise<string>
}

export interface EmailAccountStore {
  getMode(): EmailMode
  setMode(mode: EmailMode): void
  list(): readonly EmailAccount[]
  get(id: string): EmailAccount | null
  insert(account: EmailAccount): void
  update(account: EmailAccount): void
  delete(id: string): void
}

/** Slack URL stays in the keychain. Only the ref is stored here (NFR-5). */
export interface StoredAlertSettings {
  projectId: string
  desktop: boolean
  emailAfterCheck: boolean
  emailAccountId: string | null
  emailTo: readonly string[]
  slackEnabled: boolean
  slackKeychainRef: string | null
  monthlyClientPdf: boolean
  /** Null, or one address. Not stored until `alert_settings.monthly_pdf_to` exists. */
  monthlyPdfTo: string | null
}

export interface AlertSettingsStore {
  get(projectId: string): StoredAlertSettings | null
  save(settings: StoredAlertSettings): void
}

export interface ReportScheduleStore {
  /** Live schedules. A row with `deleted_at` set is omitted. Due delivery reads this. */
  list(): readonly ReportSchedule[]
  /** A missing or deleted schedule is null. */
  get(id: string): ReportSchedule | null
  save(schedule: ReportSchedule): void
  /**
   * Soft-delete one live row.
   * `projectId` null matches an all-projects schedule (`project_id IS NULL`).
   * Returns the ISO UTC `deleted_at` from the store clock, or null when no row
   * changed: missing id, project mismatch, or already deleted.
   * Pending occurrences are not stored. List, get, and due delivery skip the row,
   * so those occurrences are ignored.
   */
  delete(projectId: string | null, scheduleId: string): string | null
}

/** A unique occurrence is already stored. The caller must not record a second send. */
export type DeliveryAddResult = 'recorded' | 'already_sent'

export interface DeliveryStore {
  /**
   * Persists the row. Failed rows store a null occurrence key and do not mark
   * the throttle. Sent and draft rows with a key mark that throttle with the row.
   * A duplicate key is `already_sent` and does not throw.
   */
  add(record: DeliveryRecord): DeliveryAddResult
  list(): readonly DeliveryRecord[]
  hasThrottle(key: string): boolean
  markThrottle(key: string): void
}

export interface QueuedMonthlyPdf {
  id: string
  projectId: string
  projectName: string
  /** Local `YYYY-MM-DD`. FR-23.13 requires the 1st. */
  dueDate: string
  filename: string
  bytes: Uint8Array
}

/** One file per project and due date. A second add is not an error. */
export type MonthlyPdfAddResult = 'queued' | 'already_queued'

export interface MonthlyPdfStore {
  add(item: QueuedMonthlyPdf): MonthlyPdfAddResult
  list(): readonly QueuedMonthlyPdf[]
  remove(id: string): void
}

/**
 * FR-23.13. Email, Slack, and the monthly PDF stay off until the user opts in.
 * Desktop starts on when nothing is stored. A saved `desktop` value replaces this.
 */
export function defaultAlertSettings(projectId: string): StoredAlertSettings {
  return {
    projectId,
    desktop: true,
    emailAfterCheck: false,
    emailAccountId: null,
    emailTo: [],
    slackEnabled: false,
    slackKeychainRef: null,
    monthlyClientPdf: false,
    monthlyPdfTo: null
  }
}
