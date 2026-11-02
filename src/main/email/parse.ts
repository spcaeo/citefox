import {
  isEmailMode,
  isReportFormat,
  isSmtpProvider,
  isSmtpSecurity,
  type EmailMode,
  type ReportFormat,
  type SmtpProvider,
  type SmtpSecurity
} from '@shared/domain'
import type {
  EmailModeRequest,
  SaveEmailAccountRequest,
  UpdateAlertSettingsRequest
} from '@shared/ipc'
import type { ReportScope, ScheduledReport } from '@shared/domain'
import { isSlackWebhookUrl } from './webhook-http'
import { parseReportScope, parseScheduledReport } from './reports/parse'
import { EmailError } from './errors'
import { requireClockTime, requireTimeZone } from './due'
import {
  CHANGE_KINDS,
  SUMMARY_STYLES,
  type ChangeKind,
  type ReportTiming,
  type SummaryStyle
} from './types'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const EMAIL = /^[^\s@]+@[^\s@]+$/

export interface ParsedReportInput {
  id: string | null
  name: string
  projectId: string | null
  timing: ReportTiming
  format: ReportFormat
  sections: readonly string[]
  marketIds: readonly string[]
  recipients: readonly string[]
  accountId: string | null
  timeZone: string
  subject: string
  summaryStyle: SummaryStyle | null
  /** Null is the whole project. */
  scope: ReportScope | null
  /** Null is the check summary report. */
  report: ScheduledReport | null
}

export function parseModeRequest(value: unknown): EmailModeRequest {
  const record = plain(value, ['mode'])
  return { mode: readMode(record.mode) }
}

export function parseAccountId(value: unknown): string {
  const record = plain(value, ['id'])
  return readId(record.id)
}

/**
 * `email:test`. A missing `to` is null and the caller uses the account from address.
 * A present `to` is one address. `readEmails` does not split commas, and this is not a list.
 */
export function parseEmailTest(value: unknown): { id: string; to: string | null } {
  const record = plain(value, ['id'], ['to'])
  const id = readId(record.id)
  if (!has(record, 'to')) return { id, to: null }
  return { id, to: readSingleAddress(record.to) }
}

export function parseSaveAccount(value: unknown): SaveEmailAccountRequest {
  const record = plain(value, [
    'id',
    'provider',
    'fromName',
    'fromAddress',
    'replyTo',
    'host',
    'port',
    'security',
    'username',
    'password',
    'isDefault'
  ])
  const password = record.password
  if (password !== null && typeof password !== 'string') reject()
  if (typeof password === 'string' && password.length === 0) reject()
  const replyTo = record.replyTo
  if (replyTo !== null && typeof replyTo !== 'string') reject()
  return {
    id: record.id === null ? null : readId(record.id),
    provider: readProvider(record.provider),
    fromName: readHeader(record.fromName, true),
    fromAddress: readEmail(record.fromAddress),
    replyTo: replyTo === null ? null : readEmail(replyTo),
    host: readHost(record.host),
    port: readPort(record.port),
    security: readSecurity(record.security),
    username: readHeader(record.username, false),
    password: password as string | null,
    isDefault: readBoolean(record.isDefault)
  }
}

export function parseAlertUpdate(value: unknown): UpdateAlertSettingsRequest {
  const record = plain(
    value,
    ['projectId'],
    [
      'desktop',
      'emailAfterCheck',
      'emailAccountId',
      'emailTo',
      'slackEnabled',
      'slackWebhook',
      'monthlyClientPdf',
      'monthlyPdfTo'
    ]
  )
  const request: UpdateAlertSettingsRequest = { projectId: readId(record.projectId) }
  if (has(record, 'desktop')) request.desktop = readBoolean(record.desktop)
  if (has(record, 'emailAfterCheck')) request.emailAfterCheck = readBoolean(record.emailAfterCheck)
  if (has(record, 'emailAccountId')) {
    request.emailAccountId = record.emailAccountId === null ? null : readId(record.emailAccountId)
  }
  if (has(record, 'emailTo')) request.emailTo = readEmails(record.emailTo)
  if (has(record, 'slackEnabled')) request.slackEnabled = readBoolean(record.slackEnabled)
  if (has(record, 'slackWebhook')) request.slackWebhook = readWebhook(record.slackWebhook)
  if (has(record, 'monthlyClientPdf'))
    request.monthlyClientPdf = readBoolean(record.monthlyClientPdf)
  if (has(record, 'monthlyPdfTo')) {
    request.monthlyPdfTo =
      record.monthlyPdfTo === null ? null : readSingleAddress(record.monthlyPdfTo)
  }
  return request
}

/** `alerts:testSlack`: the project, and a webhook to try before saving it (optional). */
export function parseSlackTest(value: unknown): { projectId: string; webhook: string | null } {
  const record = plain(value, ['projectId'], ['webhook'])
  const webhook = has(record, 'webhook') ? readWebhook(record.webhook) : null
  return { projectId: readId(record.projectId), webhook: webhook === '' ? null : webhook }
}

export function parseProjectId(value: unknown): string {
  const record = plain(value, ['projectId'])
  return readId(record.projectId)
}

export function parseReport(value: unknown): ParsedReportInput {
  const record = plain(
    value,
    [
      'id',
      'name',
      'projectId',
      'timing',
      'format',
      'sections',
      'marketIds',
      'recipients',
      'accountId',
      'timeZone',
      'subject',
      'summaryStyle'
    ],
    ['scope', 'report']
  )
  if (typeof record.timeZone !== 'string' || typeof record.subject !== 'string') reject()
  if (typeof record.name !== 'string') reject()
  requireTimeZone(record.timeZone)
  const subject = readHeader(record.subject, true)
  const projectId = record.projectId === null ? null : readId(record.projectId)
  return {
    id: record.id === null ? null : readId(record.id),
    name: readHeader(record.name, true),
    projectId,
    scope: parseReportScope(record.scope, projectId),
    report: parseScheduledReport(record.report),
    timing: parseTiming(record.timing),
    format: readFormat(record.format),
    sections: readTokens(record.sections),
    marketIds: readTokens(record.marketIds),
    recipients: readEmails(record.recipients),
    accountId: record.accountId === null ? null : readId(record.accountId),
    timeZone: record.timeZone,
    subject,
    summaryStyle: readSummaryStyle(record.summaryStyle)
  }
}

export function readEmail(value: unknown): string {
  if (typeof value !== 'string' || !EMAIL.test(value) || /[\r\n]/.test(value)) reject()
  return value
}

/**
 * One address, not a recipient list.
 * `readEmails` validates an array and does not split on commas, so a comma-separated
 * string is not parsed into several addresses. It is rejected here.
 * `readEmail` would otherwise accept `a@b.com,c@d.com` because the pattern allows a comma.
 */
export function isSingleEmailAddress(value: string): boolean {
  return EMAIL.test(value) && !value.includes(',') && !/[\r\n]/.test(value)
}

function readSingleAddress(value: unknown): string {
  if (typeof value !== 'string' || !isSingleEmailAddress(value)) reject()
  return value
}

function parseTiming(value: unknown): ReportTiming {
  const record = plainAny(value)
  const kind = record.kind
  if (kind === 'after_check') {
    onlyKeys(record, ['kind'])
    return { kind: 'after_check' }
  }
  if (kind === 'weekly') {
    onlyKeys(record, ['kind', 'day', 'time'])
    const day = record.day
    if (day !== 1 && day !== 2 && day !== 3 && day !== 4 && day !== 5 && day !== 6 && day !== 7) {
      reject()
    }
    if (typeof record.time !== 'string') reject()
    requireClockTime(record.time)
    return { kind: 'weekly', day, time: record.time }
  }
  if (kind === 'monthly') {
    onlyKeys(record, ['kind', 'when', 'time'])
    const when = record.when
    if (when !== '1' && when !== '15' && when !== 'last') reject()
    if (typeof record.time !== 'string') reject()
    requireClockTime(record.time)
    return { kind: 'monthly', when, time: record.time }
  }
  if (kind === 'on_change') {
    for (const key of Object.keys(record)) {
      if (key !== 'kind' && key !== 'scoreDropPoints' && key !== 'events') reject()
    }
    if (!has(record, 'kind') || !has(record, 'scoreDropPoints')) reject()
    const points = record.scoreDropPoints
    if (typeof points !== 'number' || !Number.isInteger(points) || points < 0) reject()
    // The service request predates `events`. Omitting it watches every change kind.
    const events = has(record, 'events') ? readChangeKinds(record.events) : [...CHANGE_KINDS]
    return { kind: 'on_change', scoreDropPoints: points, events }
  }
  reject()
}

function readMode(value: unknown): EmailMode {
  if (typeof value !== 'string' || !isEmailMode(value)) reject()
  return value
}

function readProvider(value: unknown): SmtpProvider {
  if (typeof value !== 'string' || !isSmtpProvider(value)) reject()
  return value
}

function readSecurity(value: unknown): SmtpSecurity {
  if (typeof value !== 'string' || !isSmtpSecurity(value)) reject()
  return value
}

function readFormat(value: unknown): ReportFormat {
  if (typeof value !== 'string' || !isReportFormat(value)) reject()
  return value
}

function readChangeKinds(value: unknown): ChangeKind[] {
  if (!Array.isArray(value)) reject()
  const events: ChangeKind[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !CHANGE_KINDS.includes(item as ChangeKind)) reject()
    const kind = item as ChangeKind
    if (events.includes(kind)) reject()
    events.push(kind)
  }
  return events
}

function readSummaryStyle(value: unknown): SummaryStyle | null {
  if (value === null) return null
  if (typeof value !== 'string' || !SUMMARY_STYLES.includes(value as SummaryStyle)) reject()
  return value as SummaryStyle
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) reject()
  return value
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') reject()
  return value
}

function readPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) reject()
  return value
}

/** `spaces` allows a display name. Host, username, and subject stay a single header line. */
function readHeader(value: unknown, spaces: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) reject()
  if (!spaces && /\s/.test(value)) reject()
  return value
}

function readHost(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) reject()
  return value
}

function readEmails(value: unknown): string[] {
  if (!Array.isArray(value)) reject()
  const emails = value.map((item) => readEmail(item))
  return [...new Set(emails)]
}

function readTokens(value: unknown): string[] {
  if (!Array.isArray(value)) reject()
  return value.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || /[\r\n]/.test(item)) reject()
    return item
  })
}

/**
 * Slack incoming webhooks only (`https://hooks.slack.com/services/...`).
 * Any other https URL is refused: the redaction rules and the delivery
 * transport both assume Slack, and the URL is otherwise a free SSRF target.
 */
function readWebhook(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') reject()
  if (value === '') return ''
  if (/\s/.test(value)) reject()
  if (!isSlackWebhookUrl(value)) {
    throw new EmailError(
      'Use a Slack webhook URL that starts with https://hooks.slack.com/services/.',
      'invalid'
    )
  }
  return value
}

function plain(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  const record = plainAny(value)
  const allowed = [...required, ...optional]
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) reject()
  }
  for (const key of required) {
    if (!has(record, key)) reject()
  }
  return record
}

function plainAny(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject()
  return value as Record<string, unknown>
}

function onlyKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) reject()
  }
  for (const key of keys) {
    if (!has(record, key)) reject()
  }
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function reject(): never {
  throw new EmailError('Invalid request', 'invalid')
}
