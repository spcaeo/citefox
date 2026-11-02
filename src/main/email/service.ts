import {
  DEFAULT_REPORT_SCHEDULE_STATUS,
  RESEND_OCCURRENCE_PREFIX,
  SMTP_PRESETS,
  type AlertSettings,
  type EmailAccount,
  type EmailSettings,
  type EmailTestResult,
  type SmtpPreset,
  type SmtpProvider
} from '@shared/domain'
import type { RemoveEmailAccountResult, TestSlackResult } from '@shared/ipc'
import { randomUUID } from 'node:crypto'
import { sleep as delay } from '../providers/timeout'
import type { CapAlert } from '../queue/types'
import { renderSubject } from './compose'
import { MemoryDraftOpener } from './draft'
import { EmailError } from './errors'
import {
  parseAccountId,
  parseEmailTest,
  parseModeRequest,
  parseProjectId,
  parseReport,
  parseSaveAccount,
  readEmail
} from './parse'
import { createAccount, promoteDefault, updateAccount } from './service/accounts'
import {
  notifyCapAlert,
  notifyFinished,
  postSlackText,
  testSlackWebhook,
  toPublic,
  updateAlertSettings
} from './service/alerts'
import {
  dispatchReport,
  queuePdf,
  releaseDueWork,
  sendAfter,
  sendChanges
} from './service/schedules'
import { performSend } from './service/send'
import { asNotify, bag, mutateSecret, requireDelivery, requireReport } from './service/support'
import type {
  AfterCheckInput,
  ChangeReportInput,
  CheckFinishedInput,
  EmailService,
  EmailServiceDeps,
  ExportEmailInput,
  MonthlyPdfInput,
  ReadyDeps,
  RecordedSendInput,
  ReleaseInput,
  ReportTestInput,
  ResendReportInput
} from './service/types'
import {
  MemoryAlertStore,
  MemoryDeliveryStore,
  MemoryEmailAccountStore,
  MemoryMonthlyPdfStore,
  MemoryReportStore,
  sortDeliveries
} from './store'
import { MemorySmtpTransport } from './transport'
import {
  defaultAlertSettings,
  type CheckAlertResult,
  type DeliveryRecord,
  type EmailPreview,
  type NotifyResult,
  type ReportFacts,
  type ReportSchedule
} from './types'
import { MemoryWebhookTransport } from './webhook'

export type {
  AfterCheckInput,
  ChangeReportInput,
  CheckFinishedInput,
  EmailService,
  EmailServiceDeps,
  ExportEmailInput,
  MonthlyPdfInput,
  RecordedSendInput,
  ReleaseInput,
  ReportTestInput,
  ResendReportInput
} from './service/types'

export interface MemoryEmailPorts {
  transport: MemorySmtpTransport
  webhooks: MemoryWebhookTransport
  drafts: MemoryDraftOpener
  accounts: MemoryEmailAccountStore
  alerts: MemoryAlertStore
  reports: MemoryReportStore
  deliveries: MemoryDeliveryStore
  pdfs: MemoryMonthlyPdfStore
}

/** In-memory ports for tests. Nothing is written to disk or the network. */
export function createMemoryEmailPorts(): MemoryEmailPorts {
  return {
    transport: new MemorySmtpTransport(),
    webhooks: new MemoryWebhookTransport(),
    drafts: new MemoryDraftOpener(),
    accounts: new MemoryEmailAccountStore(),
    alerts: new MemoryAlertStore(),
    reports: new MemoryReportStore(),
    deliveries: new MemoryDeliveryStore(),
    pdfs: new MemoryMonthlyPdfStore()
  }
}

/** FR-23.2. Host, port, and security from the shared preset table. */
export function smtpPreset(provider: SmtpProvider): SmtpPreset {
  const preset = SMTP_PRESETS.find((item) => item.provider === provider)
  if (preset === undefined) throw new EmailError('Invalid request', 'invalid')
  return preset
}

/**
 * SMTP accounts, test sends, and alert delivery.
 * Account rows, schedules, and delivery history stay in the injected stores.
 * This module does not call the storage layer.
 */
export function createEmailService(deps: EmailServiceDeps): EmailService {
  const clock = deps.clock
  const createId = deps.createId ?? ((): string => randomUUID())
  const full: ReadyDeps = {
    ...deps,
    sleep: deps.sleep ?? delay,
    createId,
    clock
  }

  return {
    getSettings(): EmailSettings {
      return { mode: full.accounts.getMode(), accounts: full.accounts.list() }
    },

    setMode(request: unknown): EmailSettings {
      const { mode } = parseModeRequest(request)
      full.accounts.setMode(mode)
      return { mode: full.accounts.getMode(), accounts: full.accounts.list() }
    },

    saveAccount(request: unknown): EmailAccount {
      const parsed = parseSaveAccount(request)
      if (parsed.id === null) return createAccount(full, parsed)
      return updateAccount(full, parsed)
    },

    removeAccount(request: unknown): RemoveEmailAccountResult {
      const id = parseAccountId(request)
      const existing = full.accounts.get(id)
      if (existing === null) throw new EmailError('Unknown email account', 'not_found')
      mutateSecret(() => full.secrets.delete(existing.keychainRef), bag(full))
      full.accounts.delete(id)
      promoteDefault(full.accounts)
      return { id }
    },

    async testAccount(request: unknown): Promise<EmailTestResult> {
      const parsed = parseEmailTest(request)
      const account = full.accounts.get(parsed.id)
      if (account === null) throw new EmailError('Unknown email account', 'not_found')
      const to = parsed.to ?? account.fromAddress
      const delivery = requireDelivery(
        await performSend(full, {
          trigger: 'account_test',
          scheduleId: null,
          projectId: null,
          accountId: account.id,
          to: [to],
          subject: 'Test',
          text: 'Test',
          attachment: null,
          occurrenceKey: null,
          forceSmtp: true
        })
      )
      const ok = delivery.outcome === 'sent'
      const message = ok
        ? `Test sent through ${account.host} at ${delivery.at}.`
        : (delivery.reason ?? 'The SMTP send failed.')
      const nextStep = ok ? null : delivery.nextStep
      const current = full.accounts.get(parsed.id)
      if (current !== null) {
        full.accounts.update({
          ...current,
          lastTestAt: delivery.at,
          lastTestOk: ok,
          lastTestMessage: ok ? null : message,
          lastTestNextStep: nextStep
        })
      }
      return { ok, host: account.host, testedAt: delivery.at, message, nextStep }
    },

    getAlerts(request: unknown): AlertSettings {
      const projectId = parseProjectId(request)
      const stored = full.alerts.get(projectId) ?? defaultAlertSettings(projectId)
      return toPublic(full, stored)
    },

    updateAlerts(request: unknown): AlertSettings {
      return updateAlertSettings(full, request)
    },

    testSlack(request: unknown): Promise<TestSlackResult> {
      return testSlackWebhook(full, request)
    },

    postSlack(input): Promise<NotifyResult> {
      return postSlackText(full, input)
    },

    notifyCheckFinished(input: CheckFinishedInput): Promise<CheckAlertResult> {
      return notifyFinished(full, input)
    },

    notifyCap(input: { alert: CapAlert; paused: boolean }): Promise<NotifyResult> {
      return notifyCapAlert(full, input.alert, input.paused)
    },

    saveReport(request: unknown): ReportSchedule {
      const parsed = parseReport(request)
      const existing = parsed.id === null ? null : full.reports.get(parsed.id)
      if (parsed.id !== null && existing === null)
        throw new EmailError('Unknown report', 'not_found')
      const schedule: ReportSchedule = {
        id: existing?.id ?? full.createId(),
        name: parsed.name,
        projectId: parsed.projectId,
        scope: parsed.scope,
        report: parsed.report,
        timing: parsed.timing,
        format: parsed.format,
        sections: parsed.sections,
        marketIds: parsed.marketIds,
        recipients: parsed.recipients,
        accountId: parsed.accountId,
        timeZone: parsed.timeZone,
        subject: parsed.subject,
        summaryStyle: parsed.summaryStyle,
        status: existing?.status ?? DEFAULT_REPORT_SCHEDULE_STATUS,
        createdAt: existing?.createdAt ?? full.clock.now().toISOString()
      }
      full.reports.save(schedule)
      return schedule
    },

    previewReport(scheduleId: string, facts: ReportFacts): EmailPreview {
      const schedule = requireReport(full, scheduleId)
      return { subject: renderSubject(schedule.subject, facts), text: facts.lines.join('\n') }
    },

    sendReportTest(input: ReportTestInput): Promise<NotifyResult> {
      const toUser = readEmail(input.toUser)
      const schedule = requireReport(full, input.scheduleId)
      if (input.paused || schedule.status === 'paused') {
        return Promise.resolve({ action: 'skipped', reason: 'paused' })
      }
      return dispatchReport(full, {
        schedule,
        trigger: 'report_test',
        occurrenceKey: null,
        to: [toUser],
        payload: input.payload,
        text: input.payload.facts.lines.join('\n')
      })
    },

    sendAfterChecks(input: AfterCheckInput): Promise<readonly NotifyResult[]> {
      return sendAfter(full, input)
    },

    sendChangeReport(input: ChangeReportInput): Promise<NotifyResult> {
      return sendChanges(full, input)
    },

    resendReport(input: ResendReportInput): Promise<NotifyResult> {
      return dispatchReport(full, {
        schedule: input.schedule,
        trigger: input.trigger,
        occurrenceKey: `${input.occurrencePrefix ?? RESEND_OCCURRENCE_PREFIX}${full.createId()}`,
        to: input.to,
        payload: input.payload,
        text: input.payload.facts.lines.join('\n')
      })
    },

    releaseDue(input: ReleaseInput): Promise<readonly NotifyResult[]> {
      return releaseDueWork(full, input)
    },

    queueMonthlyPdf(input: MonthlyPdfInput): void {
      queuePdf(full, input)
    },

    sendRecorded(input: RecordedSendInput): Promise<NotifyResult> {
      return performSend(full, {
        trigger: input.trigger,
        scheduleId: input.scheduleId,
        projectId: input.projectId,
        accountId: input.accountId,
        to: [...input.to],
        subject: input.subject,
        text: input.text,
        attachment: null,
        occurrenceKey: null,
        ...(input.forceSmtp === true ? { forceSmtp: true } : {})
      }).then((delivery) => asNotify(delivery))
    },

    sendExport(input: ExportEmailInput): Promise<NotifyResult> {
      if (input.paused) return Promise.resolve({ action: 'skipped', reason: 'paused' })
      const to = input.to.map((address) => readEmail(address))
      return performSend(full, {
        trigger: 'export',
        scheduleId: null,
        projectId: input.projectId,
        accountId: input.accountId,
        to,
        subject: input.subject,
        text: input.text,
        attachment: {
          filename: input.filename,
          contentType: input.contentType,
          bytes: input.bytes
        },
        occurrenceKey: null
      }).then((delivery) => asNotify(delivery))
    },

    listDeliveries(options?: { failedOnly?: boolean }): readonly DeliveryRecord[] {
      return sortDeliveries(full.deliveries.list(), options?.failedOnly === true)
    }
  }
}
