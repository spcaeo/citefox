import type {
  AlertSettings,
  DeliveryTrigger,
  EmailAccount,
  EmailSettings,
  EmailTestResult
} from '@shared/domain'
import type { RemoveEmailAccountResult, TestSlackResult } from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import type { CapAlert } from '../../queue/types'
import type { SecretStore } from '../../secrets/secret-store'
import type { MailAppDraftOpener } from '../draft'
import type { EmailAttachment, SmtpTransport } from '../transport'
import type {
  AlertSettingsStore,
  ChangeEvent,
  CheckAlertResult,
  DeliveryRecord,
  DeliveryStore,
  EmailAccountStore,
  EmailClock,
  EmailPreview,
  MonthlyPdfStore,
  NotifyResult,
  PageCheckFacts,
  ReportFacts,
  ReportPayload,
  ReportSchedule,
  ReportScheduleStore,
  SummaryWriter
} from '../types'
import type { WebhookTransport } from '../webhook'

export interface EmailServiceDeps {
  secrets: SecretStore
  transport: SmtpTransport
  webhooks: WebhookTransport
  drafts: MailAppDraftOpener
  accounts: EmailAccountStore
  alerts: AlertSettingsStore
  reports: ReportScheduleStore
  deliveries: DeliveryStore
  pdfs: MonthlyPdfStore
  logger: Logger
  clock: EmailClock
  /** NFR-2. Defaults to the real timer. Tests pass a resolved function. */
  sleep?: (ms: number) => Promise<void>
  createId?: () => string
  summaryWriter?: SummaryWriter
  knownSecrets?: () => readonly string[]
}

export interface EmailService {
  getSettings(): EmailSettings
  setMode(request: unknown): EmailSettings
  saveAccount(request: unknown): EmailAccount
  removeAccount(request: unknown): RemoveEmailAccountResult
  /** FR-23.4. Always an SMTP attempt, including when the mode is `mail_app`. */
  testAccount(request: unknown): Promise<EmailTestResult>
  getAlerts(request: unknown): AlertSettings
  updateAlerts(request: unknown): AlertSettings
  /** `alerts:testSlack`: one post to the typed or saved webhook, with the result. */
  testSlack(request: unknown): Promise<TestSlackResult>
  /** Alert rules: one post to the project's saved Slack webhook, recorded as a delivery. */
  postSlack(input: {
    projectId: string
    text: string
    occurrenceKey: string | null
  }): Promise<NotifyResult>
  /** SCH-7, FR-23.12, FR-23.13, FR-24.7. */
  notifyCheckFinished(input: CheckFinishedInput): Promise<CheckAlertResult>
  /** FR-11.4. At most one email per project per local month. */
  notifyCap(input: { alert: CapAlert; paused: boolean }): Promise<NotifyResult>
  saveReport(request: unknown): ReportSchedule
  /** FR-23.9. Does not send and does not call Claude. */
  previewReport(scheduleId: string, facts: ReportFacts): EmailPreview
  /** FR-23.9. The message goes only to `toUser`. */
  sendReportTest(input: ReportTestInput): Promise<NotifyResult>
  /** FR-23.7 `after_check`. One success per schedule per check id. */
  sendAfterChecks(input: AfterCheckInput): Promise<readonly NotifyResult[]>
  /** FR-23.8. At most one email per schedule per check, listing every event. */
  sendChangeReport(input: ChangeReportInput): Promise<NotifyResult>
  /**
   * FR-23.11 resend of a scheduled report: the same path as the scheduled send, so the
   * body, subject and attached file follow the schedule. `occurrenceKey` starts `resend:`.
   */
  resendReport(input: ResendReportInput): Promise<NotifyResult>
  /** FR-23.12. Weekly, monthly, and the client PDF that came due while asleep. */
  releaseDue(input: ReleaseInput): Promise<readonly NotifyResult[]>
  /** FR-23.13. Queues the 1st's PDF. `releaseDue` sends it. */
  queueMonthlyPdf(input: MonthlyPdfInput): void
  /** FR-22.6. `mail_app` opens a draft instead of sending. */
  sendExport(input: ExportEmailInput): Promise<NotifyResult>
  /**
   * One recorded send through the SMTP path. `accountId` null uses the default account.
   * `forceSmtp` skips the mail-app draft, the same way an account test does.
   */
  sendRecorded(input: RecordedSendInput): Promise<NotifyResult>
  /** FR-23.11. Failures are first when `failedOnly` is set, and also on the full list. */
  listDeliveries(options?: { failedOnly?: boolean }): readonly DeliveryRecord[]
}

export interface CheckFinishedInput {
  checkId: string
  projectId: string
  projectName: string
  paused: boolean
  pages: readonly PageCheckFacts[]
}

export interface ReportTestInput {
  scheduleId: string
  toUser: string
  payload: ReportPayload
  paused: boolean
}

export interface AfterCheckInput {
  checkId: string
  projectId: string
  paused: boolean
  factsFor(schedule: ReportSchedule): ReportPayload | null
}

export interface ChangeReportInput {
  scheduleId: string
  checkId: string
  paused: boolean
  events: readonly ChangeEvent[]
  payload: ReportPayload
}

export interface ResendReportInput {
  schedule: ReportSchedule
  trigger: DeliveryTrigger
  to: readonly string[]
  payload: ReportPayload
  /**
   * The occurrence key prefix. Default `resend:` (Delivery history's Resend);
   * `now:` is Reports' Send now. Either way the key is unique, so it never takes
   * the slot of a scheduled send.
   */
  occurrencePrefix?: string
}

export interface ReleaseInput {
  /** Null project id asks whether every project on an all-projects report is paused. */
  isPaused(projectId: string | null): boolean
  factsFor(schedule: ReportSchedule): ReportPayload | null
}

export interface MonthlyPdfInput {
  projectId: string
  projectName: string
  dueDate: string
  filename: string
  bytes: Uint8Array
}

export interface RecordedSendInput {
  trigger: DeliveryTrigger
  scheduleId: string | null
  projectId: string | null
  accountId: string | null
  to: readonly string[]
  subject: string
  text: string
  forceSmtp?: boolean
}

export interface ExportEmailInput {
  projectId: string
  paused: boolean
  to: readonly string[]
  accountId: string | null
  subject: string
  text: string
  filename: string
  contentType: string
  bytes: Uint8Array
}

export interface ReadyDeps extends EmailServiceDeps {
  sleep: (ms: number) => Promise<void>
  createId: () => string
  clock: EmailClock
}

export interface Outgoing {
  trigger: DeliveryTrigger
  scheduleId: string | null
  projectId: string | null
  accountId: string | null
  to: readonly string[]
  subject: string
  text: string
  attachment: EmailAttachment | null
  occurrenceKey: string | null
  forceSmtp?: boolean
}
