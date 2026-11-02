import type {
  DeliveryRecord,
  EmailAccount,
  EmailTestResult,
  ReportSchedule,
  ReportScheduleListItem
} from '@shared/domain'
import type {
  CiteFoxApi,
  DeleteReportScheduleRequest,
  DeleteReportScheduleResult,
  ListDeliveriesRequest,
  ResendDeliveryRequest,
  SendReportNowRequest,
  SendReportTestRequest,
  SetReportScheduleStatusRequest
} from '@shared/ipc'
import { deleteScheduledReport, isReportNotFound } from './reportsDelete'
import { explainReportsError, type AccountOption, type Explained } from './scheduleModel'

/**
 * Scheduled reports adapter.
 * The sample engine runs in the Vite dev harness and in tests. A production
 * build calls `reports:*` and `deliveries:*` only. A thrown error becomes a
 * plain reason with Electron's invoke wrapper removed.
 */
export interface SchedulesClient {
  listSchedules(): Promise<{
    rows: readonly ReportScheduleListItem[]
    unavailable: Explained | null
  }>
  saveSchedule(
    schedule: ReportSchedule
  ): Promise<{ row: ReportScheduleListItem | null; unavailable: Explained | null }>
  setStatus(
    request: SetReportScheduleStatusRequest
  ): Promise<{ row: ReportScheduleListItem | null; unavailable: Explained | null }>
  sendTest(
    request: SendReportTestRequest
  ): Promise<{ result: EmailTestResult | null; unavailable: Explained | null }>
  /** Builds and emails the report to its recipients now (`reports:sendNow`). */
  sendNow(
    request: SendReportNowRequest
  ): Promise<{ row: DeliveryRecord | null; unavailable: Explained | null }>
  listDeliveries(
    request?: ListDeliveriesRequest
  ): Promise<{ rows: readonly DeliveryRecord[]; unavailable: Explained | null }>
  resend(
    request: ResendDeliveryRequest
  ): Promise<{ row: DeliveryRecord | null; unavailable: Explained | null }>
  deleteSchedule(request: DeleteReportScheduleRequest): Promise<{
    result: Extract<DeleteReportScheduleResult, { ok: true }> | null
    unavailable: Explained | null
    notFound: boolean
  }>
  /** Rejects when the email settings cannot be read, so the screen can say why. */
  listAccounts(): Promise<readonly AccountOption[]>
}

export function createLiveSchedulesClient(): SchedulesClient {
  return {
    async listSchedules() {
      try {
        const rows = await requireApi()['reports:list']()
        return { rows, unavailable: null }
      } catch (error) {
        return { rows: [], unavailable: explainReportsError(error) }
      }
    },
    async saveSchedule(schedule) {
      try {
        const row = await requireApi()['reports:save'](schedule)
        return { row, unavailable: null }
      } catch (error) {
        return { row: null, unavailable: explainReportsError(error) }
      }
    },
    async setStatus(request) {
      try {
        const row = await requireApi()['reports:setStatus'](request)
        return { row, unavailable: null }
      } catch (error) {
        return { row: null, unavailable: explainReportsError(error) }
      }
    },
    async sendTest(request) {
      try {
        const result = await requireApi()['reports:sendTest'](request)
        return { result, unavailable: null }
      } catch (error) {
        return { result: null, unavailable: explainReportsError(error) }
      }
    },
    async sendNow(request) {
      try {
        const row = await requireApi()['reports:sendNow'](request)
        return { row, unavailable: null }
      } catch (error) {
        return { row: null, unavailable: explainReportsError(error) }
      }
    },
    async listDeliveries(request = {}) {
      try {
        const rows = await requireApi()['deliveries:list'](request)
        return { rows, unavailable: null }
      } catch (error) {
        return { rows: [], unavailable: explainReportsError(error) }
      }
    },
    async resend(request) {
      try {
        const row = await requireApi()['deliveries:resend'](request)
        return { row, unavailable: null }
      } catch (error) {
        return { row: null, unavailable: explainReportsError(error) }
      }
    },
    async deleteSchedule(request) {
      try {
        const result = await deleteScheduledReport(request)
        if (isReportNotFound(result)) {
          return {
            result: null,
            unavailable: explainReportsError(result),
            notFound: true
          }
        }
        return { result, unavailable: null, notFound: false }
      } catch (error) {
        return {
          result: null,
          unavailable: explainReportsError(error),
          notFound: isReportNotFound(error)
        }
      }
    },
    async listAccounts() {
      const settings = await requireApi()['email:getSettings']()
      return settings.accounts.map(accountOption)
    }
  }
}

function accountOption(account: EmailAccount): AccountOption {
  const provider = providerLabel(account.provider)
  return {
    id: account.id,
    label: `${provider} · ${account.fromAddress}`,
    fromAddress: account.fromAddress,
    isDefault: account.isDefault
  }
}

function providerLabel(provider: EmailAccount['provider']): string {
  switch (provider) {
    case 'gmail':
      return 'Gmail'
    case 'microsoft365':
      return 'Outlook'
    case 'ses':
      return 'Amazon SES'
    case 'sendgrid':
      return 'SendGrid'
    case 'mailgun':
      return 'Mailgun'
    case 'resend':
      return 'Resend'
    case 'postmark':
      return 'Postmark'
    case 'other':
      return 'SMTP'
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
