import type {
  ApiKeyMetadata,
  DeliveryRecord,
  EmailAccount,
  QueueStatus,
  ConnectionState
} from '@shared/domain'
import { isKeyWarningReason, warningCopy } from '../../keys/health'
import { formatClock, formatDay } from '../../utils/dates'
import type { UsagePace } from '../types'

export { keySearchesLeft, serpKeyLines, sharedTotals } from '../../keys/serpUsage'

/** Plain words for a key's last failure (FR-24.2 "last event"). Null when none is stored. */
export function keyProblem(key: ApiKeyMetadata): string | null {
  if (key.lastReason && isKeyWarningReason(key.lastReason)) {
    return warningCopy(key.provider, key.lastReason)
  }
  return key.statusDetail ?? null
}

/** CiteFox counts searches per local calendar month, so the count restarts on the 1st. */
export function monthResetLabel(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return formatDay(next.toISOString(), { year: false })
}

/** FR-24.5 without Claude: a straight-line projection of this month's recorded searches. */
export function usagePace(queue: QueueStatus, now: Date): UsagePace {
  const used = queue.projects.reduce((sum, project) => sum + project.used, 0)
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), daysInMonth, 12)
  return {
    used,
    dayOfMonth,
    daysInMonth,
    projected: Math.round((used / Math.max(1, dayOfMonth)) * daysInMonth),
    monthEnd: formatDay(monthEnd.toISOString(), { year: false })
  }
}

export function percentOf(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

export function checksState(queue: QueueStatus): ConnectionState {
  return queue.state === 'running' ? 'ok' : 'off'
}

export function queueStateLabel(queue: QueueStatus): string {
  if (queue.state === 'paused_all') return 'All checks paused until you resume.'
  if (queue.state === 'paused_today') return 'Checks paused for today. They resume at midnight.'
  return 'Checks run on schedule.'
}

export function nextRunLabel(queue: QueueStatus): string {
  if (queue.nextRunAt === null) return 'No scheduled run'
  return `Next scheduled run ${formatDay(queue.nextRunAt, { year: false })} ${formatClock(queue.nextRunAt)}`
}

const SMTP_NAMES: Readonly<Record<EmailAccount['provider'], string>> = {
  gmail: 'Gmail',
  microsoft365: 'Microsoft 365',
  ses: 'Amazon SES',
  sendgrid: 'SendGrid',
  mailgun: 'Mailgun',
  resend: 'Resend',
  postmark: 'Postmark',
  other: 'SMTP'
}

export function smtpName(provider: EmailAccount['provider']): string {
  return SMTP_NAMES[provider]
}

export function emailAccountState(account: EmailAccount): ConnectionState {
  if (account.lastTestOk === null) return 'unchecked'
  return account.lastTestOk ? 'ok' : 'warning'
}

/** Report deliveries only: tests and exports are not "reports sent". */
function isReport(record: DeliveryRecord): boolean {
  return record.trigger !== 'account_test' && record.trigger !== 'export'
}

export function lastReportSent(records: readonly DeliveryRecord[]): DeliveryRecord | null {
  return (
    records
      .filter((record) => isReport(record) && record.outcome === 'sent')
      .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
  )
}

/** Failed report sends newer than the last successful one, newest first. */
export function failedSends(records: readonly DeliveryRecord[]): DeliveryRecord[] {
  const last = lastReportSent(records)
  return records
    .filter((record) => isReport(record) && record.outcome === 'failed')
    .filter((record) => last === null || record.at > last.at)
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** Email roll-up: warning when an account test failed or a send failed after the last good one. */
export function emailState(
  accounts: readonly EmailAccount[],
  records: readonly DeliveryRecord[]
): ConnectionState {
  if (accounts.length === 0) return 'off'
  if (accounts.some((account) => account.lastTestOk === false)) return 'warning'
  if (failedSends(records).length > 0) return 'warning'
  if (accounts.every((account) => account.lastTestOk === null)) return 'unchecked'
  return 'ok'
}

export function triggerLabel(record: DeliveryRecord): string {
  switch (record.trigger) {
    case 'after_check':
      return 'After-check email'
    case 'weekly':
      return 'Weekly report'
    case 'monthly':
      return 'Monthly report'
    case 'on_change':
      return 'Change report'
    case 'check_summary':
      return 'Check summary'
    case 'slack':
      return 'Slack message'
    case 'cap':
      return 'Search cap alert'
    case 'monthly_pdf':
      return 'Monthly client PDF'
    case 'report_test':
      return 'Report test'
    case 'account_test':
      return 'Account test'
    case 'export':
      return 'Export'
  }
}

export function count(value: number): string {
  return value.toLocaleString('en-US')
}
