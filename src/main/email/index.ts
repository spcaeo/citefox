export { MemoryDraftOpener, unconfiguredDraftOpener } from './draft'
export type { MailAppDraftOpener, MailDraft } from './draft'
export { dueOccurrences } from './due'
export { FIX_IN_EMAIL_SETUP, EmailError } from './errors'
export type { EmailErrorCode } from './errors'
export {
  changeEventLines,
  changeEventsFromPages,
  checkSummaryLines,
  desktopNoticeFor,
  pageCheckFactsForRun,
  renderSubject
} from './compose'
export { createEmailService, createMemoryEmailPorts, smtpPreset } from './service'
export {
  bindEmailIpcHandlers,
  bindReportIpcHandlers,
  engineEmailFor,
  openEngineEmail,
  setEngineEmailTestPorts
} from './engine-email'
export type { EngineEmail, EngineEmailTestPorts } from './engine-email'
export { createStorageEmailStores } from './storage-stores'
export type { StorageEmailStoreDeps, StorageEmailStores } from './storage-stores'
export type {
  AfterCheckInput,
  ChangeReportInput,
  CheckFinishedInput,
  EmailService,
  EmailServiceDeps,
  ExportEmailInput,
  MemoryEmailPorts,
  MonthlyPdfInput,
  ReleaseInput,
  RecordedSendInput,
  ReportTestInput
} from './service'
export { sortDeliveries } from './store'
export { createNodemailerTransport } from './smtp-client'
export type { SmtpClientOptions } from './smtp-client'
export {
  classifySmtpFailure,
  MemorySmtpTransport,
  SmtpTransportError,
  unconfiguredSmtpTransport
} from './transport'
export type { SmtpFailureKind, SmtpSendRequest, SmtpTransport } from './transport'
export {
  DEFAULT_REPORT_SCHEDULE_STATUS,
  DELIVERY_OUTCOMES,
  DELIVERY_TRIGGERS,
  REPORT_FORMATS,
  REPORT_SCHEDULE_STATUSES
} from '@shared'
export type { DeliveryOutcome, DeliveryTrigger, ReportFormat, ReportScheduleStatus } from '@shared'
export {
  DELIVERABILITY_TIPS,
  PDF_LINK_INSTEAD_BYTES,
  VIEW_RESULTS,
  defaultAlertSettings
} from './types'
export type {
  ChangeEvent,
  ChangeKind,
  CheckAlertResult,
  DeliveryRecord,
  DesktopNotice,
  EmailClock,
  EmailPreview,
  NotifyResult,
  PageCheckFacts,
  ReportFacts,
  ReportPayload,
  ReportSchedule,
  ReportTiming,
  SummaryStyle,
  SummaryWriter
} from './types'
export {
  MemoryWebhookTransport,
  WebhookDeliveryError,
  unconfiguredWebhookTransport
} from './webhook'
export type { WebhookTransport } from './webhook'
