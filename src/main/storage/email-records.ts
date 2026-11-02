import {
  CHANGE_KINDS,
  isChangeKind,
  isDeliveryOutcome,
  isDeliveryTrigger,
  isReportFormat,
  isReportScheduleStatus,
  isReportScopeKind,
  isScheduledReportKind,
  RIVAL_DOMAIN,
  MAX_REPORT_SCOPE_IDS,
  isSmtpProvider,
  isSmtpSecurity
} from '@shared/domain'
import type {
  ChangeKind,
  DeliveryOutcome,
  DeliveryTrigger,
  EmailAccount,
  ReportFormat,
  ReportScheduleStatus,
  ReportScope,
  ScheduledReport,
  SmtpProvider,
  SmtpSecurity
} from '@shared/domain'
import { containsSecret } from '../logging/redact'
import { assertKeychainRef } from '../secrets/secret-store'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import {
  assertId,
  readJson,
  requireClockTime,
  requireLabel,
  requireOptionalLabel,
  requireUtcTimestamp
} from './values'

/**
 * Section 10 `email_accounts` in app.sqlite.
 * The password is not a field. `keychainRef` is the keychain id (NFR-5, FR-23.3).
 * `last_test` is one column. Null means no test yet. Otherwise it is a JSON
 * object `{at, ok, message, nextStep}` so this record matches `EmailAccount`.
 * `usedFor` is computed when an account is read. It is not a column.
 */
export type EmailAccountRecord = Omit<EmailAccount, 'usedFor'>

export type {
  DeliveryOutcome,
  DeliveryTrigger,
  ReportFormat,
  ReportScheduleStatus
} from '@shared/domain'
export {
  DELIVERY_OUTCOMES,
  DELIVERY_TRIGGERS,
  REPORT_FORMATS,
  REPORT_SCHEDULE_STATUSES
} from '@shared/domain'

/** FR-23.10. Null means the summary is not written by Claude. */
export const SUMMARY_STYLES = ['standard', 'client_friendly'] as const
export type SummaryStyle = (typeof SUMMARY_STYLES)[number]

/**
 * FR-23.7 timing, stored in `timing_json`.
 * Weekly `day` is ISO 1 (Monday) through 7 (Sunday), matching the email engine.
 * `scoreDropPoints` is N in FR-23.8. A drop must be greater than N.
 * `events` is optional. A missing list reads back as every `ChangeKind`.
 */
export type ReportTiming =
  | { kind: 'after_check' }
  | { kind: 'weekly'; day: 1 | 2 | 3 | 4 | 5 | 6 | 7; time: string }
  | { kind: 'monthly'; when: '1' | '15' | 'last'; time: string }
  | { kind: 'on_change'; scoreDropPoints: number; events?: readonly ChangeKind[] }

/**
 * Section 10 `report_schedules`.
 * `projectId` null is every project (FR-23.7). `accountId` null uses the default
 * account (FR-23.5). `status` is `active` or `paused`, and a new row defaults to
 * `active` (FR-23.12). `createdAt` is ISO-8601 UTC (NFR-15).
 * Insert treats an omitted `createdAt` as now, the same rule as a pending client PDF.
 * Update never changes the stored value, even when a caller passes one.
 */
export interface ReportScheduleRecord {
  id: string
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
  status: ReportScheduleStatus
  /**
   * `scope_json`. Which pages the report covers. Omitted or null is the whole
   * project. Get and list always set it (null when none). `project` is stored as null.
   */
  scope?: ReportScope | null
  /**
   * `report_json`. The ready report it sends. Omitted or null is the check summary
   * report. Get and list always set it (null when none).
   */
  report?: ScheduledReport | null
  /** UTC ISO-8601. Omitted on insert means now. Get and list always set it. */
  createdAt?: string
}

/**
 * Section 10 `deliveries`.
 * `scheduleId` null is a send that is not a scheduled report (FR-23.11).
 * `ok` and `error` stay. `ok` is true only when `outcome` is `sent`.
 * `occurrenceKey` is the throttle key, or null.
 * `nextStep` is guidance. Omit it, or pass null, to store null.
 * Get and list always return the column, using null when it is empty.
 */
export interface EmailDeliveryRecord {
  id: string
  scheduleId: string | null
  at: string
  trigger: DeliveryTrigger
  projectId: string | null
  recipients: readonly string[]
  ok: boolean
  error: string | null
  outcome: DeliveryOutcome
  occurrenceKey: string | null
  nextStep?: string | null
}

const EMAIL = /^[^\s@]+@[^\s@]+$/
const ACCOUNT_ACTION = 'Could not save email account'
const SCHEDULE_ACTION = 'Could not save report schedule'
const DELIVERY_ACTION = 'Could not save delivery'

export function insertEmailAccount(db: SqliteDatabase, account: EmailAccountRecord): void {
  writeAccount(db, normalizeAccount(account), 'insert')
}

export function getEmailAccount(db: SqliteDatabase, id: string): EmailAccountRecord | null {
  const accountId = requireRowId(id)
  const row = db
    .prepare<unknown[], AccountSql>(
      `SELECT id, provider, from_name, from_address, reply_to, host, port, security, username,
              keychain_ref, is_default, last_test
       FROM email_accounts WHERE id = ?`
    )
    .get(accountId)
  return row === undefined ? null : accountFromSql(row)
}

export function listEmailAccounts(db: SqliteDatabase): EmailAccountRecord[] {
  return db
    .prepare<unknown[], AccountSql>(
      `SELECT id, provider, from_name, from_address, reply_to, host, port, security, username,
              keychain_ref, is_default, last_test
       FROM email_accounts ORDER BY rowid ASC`
    )
    .all()
    .map((row) => accountFromSql(row))
}

export function updateEmailAccount(db: SqliteDatabase, account: EmailAccountRecord): void {
  writeAccount(db, normalizeAccount(account), 'update')
}

/** Removes the account. The earliest remaining account becomes the default (FR-23.5). */
export function deleteEmailAccount(db: SqliteDatabase, id: string): void {
  const accountId = requireRowId(id)
  const action = 'Could not remove email account'
  const run = db.transaction(() => {
    const result = db.prepare(`DELETE FROM email_accounts WHERE id = ?`).run(accountId)
    if (result.changes !== 1) throw new StorageError(action)
    const still = db.prepare(`SELECT id FROM email_accounts WHERE is_default = 1 LIMIT 1`).get()
    if (still !== undefined) return
    const next = db
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM email_accounts ORDER BY rowid ASC LIMIT 1`
      )
      .get()
    if (next === undefined) return
    db.prepare(`UPDATE email_accounts SET is_default = 1 WHERE id = ?`).run(next.id)
  })
  runWrite(action, () => run())
}

export function insertReportSchedule(db: SqliteDatabase, schedule: ReportScheduleRecord): void {
  const row = normalizeSchedule(schedule)
  runWrite(SCHEDULE_ACTION, () => {
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients,
         account_id, time_zone, subject, summary_style, status, created_at, scope_json,
         report_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.name,
      row.projectId,
      JSON.stringify(row.timing),
      row.format,
      JSON.stringify(row.sections),
      JSON.stringify(row.marketIds),
      JSON.stringify(row.recipients),
      row.accountId,
      row.timeZone,
      row.subject,
      row.summaryStyle,
      row.status,
      row.createdAt,
      scopeJson(row.scope ?? null),
      reportJson(row.report ?? null)
    )
  })
}

export function getReportSchedule(db: SqliteDatabase, id: string): ReportScheduleRecord | null {
  const scheduleId = requireRowId(id)
  const row = db.prepare<unknown[], ScheduleSql>(`${SCHEDULE_SELECT} WHERE id = ?`).get(scheduleId)
  return row === undefined ? null : scheduleFromSql(row)
}

export function listReportSchedules(db: SqliteDatabase): ReportScheduleRecord[] {
  return db
    .prepare<unknown[], ScheduleSql>(`${SCHEDULE_SELECT} ORDER BY rowid ASC`)
    .all()
    .map((row) => scheduleFromSql(row))
}

export function updateReportSchedule(db: SqliteDatabase, schedule: ReportScheduleRecord): void {
  // createdAt is ignored. The column stays at the insert time.
  const row = scheduleFields(schedule)
  runWrite(SCHEDULE_ACTION, () => {
    const result = db
      .prepare(
        `UPDATE report_schedules SET
           name = ?, project_id = ?, timing_json = ?, format = ?, sections = ?, markets = ?,
           recipients = ?, account_id = ?, time_zone = ?, subject = ?, summary_style = ?, status = ?,
           scope_json = ?, report_json = ?
         WHERE id = ?`
      )
      .run(
        row.name,
        row.projectId,
        JSON.stringify(row.timing),
        row.format,
        JSON.stringify(row.sections),
        JSON.stringify(row.marketIds),
        JSON.stringify(row.recipients),
        row.accountId,
        row.timeZone,
        row.subject,
        row.summaryStyle,
        row.status,
        scopeJson(row.scope ?? null),
        reportJson(row.report ?? null),
        row.id
      )
    if (result.changes !== 1) throw new StorageError(SCHEDULE_ACTION)
  })
}

export function deleteReportSchedule(db: SqliteDatabase, id: string): void {
  const scheduleId = requireRowId(id)
  const action = 'Could not remove report schedule'
  runWrite(action, () => {
    const result = db.prepare(`DELETE FROM report_schedules WHERE id = ?`).run(scheduleId)
    if (result.changes !== 1) throw new StorageError(action)
  })
}

export function insertDelivery(db: SqliteDatabase, delivery: EmailDeliveryRecord): void {
  const row = normalizeDelivery(delivery)
  runWrite(DELIVERY_ACTION, () => {
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome,
         occurrence_key, next_step
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.scheduleId,
      row.at,
      row.trigger,
      row.projectId,
      JSON.stringify(row.recipients),
      row.ok ? 1 : 0,
      row.error,
      row.outcome,
      row.occurrenceKey,
      row.nextStep
    )
  })
}

export function getDelivery(db: SqliteDatabase, id: string): EmailDeliveryRecord | null {
  const deliveryId = requireRowId(id)
  const row = db.prepare<unknown[], DeliverySql>(`${DELIVERY_SELECT} WHERE id = ?`).get(deliveryId)
  return row === undefined ? null : deliveryFromSql(row)
}

export function listDeliveries(db: SqliteDatabase): EmailDeliveryRecord[] {
  return db
    .prepare<unknown[], DeliverySql>(`${DELIVERY_SELECT} ORDER BY at ASC, rowid ASC`)
    .all()
    .map((row) => deliveryFromSql(row))
}

export function deleteDelivery(db: SqliteDatabase, id: string): void {
  const deliveryId = requireRowId(id)
  const action = 'Could not remove delivery'
  runWrite(action, () => {
    const result = db.prepare(`DELETE FROM deliveries WHERE id = ?`).run(deliveryId)
    if (result.changes !== 1) throw new StorageError(action)
  })
}

const SCHEDULE_SELECT = `SELECT id, name, project_id, timing_json, format, sections, markets, recipients,
  account_id, time_zone, subject, summary_style, status, created_at, scope_json, report_json
  FROM report_schedules`

const DELIVERY_SELECT = `SELECT id, schedule_id, at, trigger, project_id, recipients, ok, "error",
  outcome, occurrence_key, next_step FROM deliveries`

interface AccountSql {
  id: string
  provider: string
  from_name: string
  from_address: string
  reply_to: string | null
  host: string
  port: number
  security: string
  username: string
  keychain_ref: string
  is_default: number
  last_test: string | null
}

interface AccountRow {
  id: string
  provider: SmtpProvider
  fromName: string
  fromAddress: string
  replyTo: string | null
  host: string
  port: number
  security: SmtpSecurity
  username: string
  keychainRef: string
  isDefault: boolean
  lastTest: string | null
}

interface ScheduleSql {
  id: string
  name: string
  project_id: string | null
  timing_json: string
  format: string
  sections: string
  markets: string
  recipients: string
  account_id: string | null
  time_zone: string
  subject: string
  summary_style: string | null
  status: string
  created_at: string
  scope_json: string | null
  report_json: string | null
}

interface DeliverySql {
  id: string
  schedule_id: string | null
  at: string
  trigger: string
  project_id: string | null
  recipients: string
  ok: number
  error: string | null
  outcome: string
  occurrence_key: string | null
  next_step: string | null
}

function writeAccount(db: SqliteDatabase, row: AccountRow, mode: 'insert' | 'update'): void {
  const run = db.transaction(() => {
    if (mode === 'update') {
      const existing = db.prepare(`SELECT id FROM email_accounts WHERE id = ?`).get(row.id)
      if (existing === undefined) throw new StorageError(ACCOUNT_ACTION)
    }
    const isDefault = row.isDefault || !othersHaveDefault(db, row.id)
    if (isDefault) {
      db.prepare(`UPDATE email_accounts SET is_default = 0 WHERE id != ?`).run(row.id)
    }
    const flag = isDefault ? 1 : 0
    if (mode === 'insert') {
      db.prepare(
        `INSERT INTO email_accounts (
           id, provider, from_name, from_address, reply_to, host, port, security, username,
           keychain_ref, is_default, last_test
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.provider,
        row.fromName,
        row.fromAddress,
        row.replyTo,
        row.host,
        row.port,
        row.security,
        row.username,
        row.keychainRef,
        flag,
        row.lastTest
      )
      return
    }
    const result = db
      .prepare(
        `UPDATE email_accounts SET
           provider = ?, from_name = ?, from_address = ?, reply_to = ?, host = ?, port = ?,
           security = ?, username = ?, keychain_ref = ?, is_default = ?, last_test = ?
         WHERE id = ?`
      )
      .run(
        row.provider,
        row.fromName,
        row.fromAddress,
        row.replyTo,
        row.host,
        row.port,
        row.security,
        row.username,
        row.keychainRef,
        flag,
        row.lastTest,
        row.id
      )
    if (result.changes !== 1) throw new StorageError(ACCOUNT_ACTION)
  })
  runWrite(ACCOUNT_ACTION, () => run())
}

function othersHaveDefault(db: SqliteDatabase, id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM email_accounts WHERE is_default = 1 AND id != ?`)
    .get(id)
  return row !== undefined
}

function accountFromSql(row: AccountSql): EmailAccountRecord {
  const lastTest = decodeLastTest(row.last_test)
  return {
    id: requireRowId(row.id),
    provider: requireProvider(row.provider),
    fromName: requireLabel(row.from_name, 'from name', 200),
    fromAddress: requireEmail(row.from_address, 'from address'),
    replyTo: row.reply_to === null ? null : requireEmail(row.reply_to, 'reply-to'),
    host: requireHost(row.host),
    port: requirePort(row.port),
    security: requireSecurity(row.security),
    username: requireUsername(row.username),
    keychainRef: requireKeychainRef(row.keychain_ref),
    isDefault: requireFlag(row.is_default),
    ...lastTest
  }
}

function normalizeAccount(account: EmailAccountRecord): AccountRow {
  return {
    id: requireRowId(account.id),
    provider: requireProvider(account.provider),
    fromName: requireLabel(account.fromName, 'from name', 200),
    fromAddress: requireEmail(account.fromAddress, 'from address'),
    replyTo: account.replyTo === null ? null : requireEmail(account.replyTo, 'reply-to'),
    host: requireHost(account.host),
    port: requirePort(account.port),
    security: requireSecurity(account.security),
    username: requireUsername(account.username),
    keychainRef: requireKeychainRef(account.keychainRef),
    isDefault: requireBoolean(account.isDefault, 'default account'),
    lastTest: encodeLastTest(account)
  }
}

function encodeLastTest(account: EmailAccountRecord): string | null {
  const { lastTestAt, lastTestOk, lastTestMessage, lastTestNextStep } = account
  if (
    lastTestAt === null &&
    lastTestOk === null &&
    lastTestMessage === null &&
    lastTestNextStep === null
  ) {
    return null
  }
  if (typeof lastTestAt !== 'string' || typeof lastTestOk !== 'boolean') {
    throw new StorageError('Invalid last test')
  }
  const message = lastTestMessage === null ? null : requireLabel(lastTestMessage, 'last test', 2000)
  const nextStep =
    lastTestNextStep === null ? null : requireLabel(lastTestNextStep, 'last test', 500)
  const encoded = JSON.stringify({
    at: requireUtcTimestamp(lastTestAt),
    ok: lastTestOk,
    message,
    nextStep
  })
  if (containsSecret(encoded)) throw new StorageError('last test cannot contain a secret')
  return encoded
}

function decodeLastTest(
  encoded: string | null
): Pick<EmailAccountRecord, 'lastTestAt' | 'lastTestOk' | 'lastTestMessage' | 'lastTestNextStep'> {
  if (encoded === null) {
    return {
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      lastTestNextStep: null
    }
  }
  const parsed = readJson(encoded, 'last test')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StorageError('Invalid last test')
  }
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 4 ||
    record.at === undefined ||
    record.ok === undefined ||
    !('message' in record) ||
    !('nextStep' in record)
  ) {
    throw new StorageError('Invalid last test')
  }
  if (typeof record.at !== 'string' || typeof record.ok !== 'boolean') {
    throw new StorageError('Invalid last test')
  }
  if (containsSecret(encoded)) throw new StorageError('last test cannot contain a secret')
  return {
    lastTestAt: requireUtcTimestamp(record.at),
    lastTestOk: record.ok,
    lastTestMessage:
      record.message === null
        ? null
        : requireLabel(requireText(record.message, 'last test'), 'last test', 2000),
    lastTestNextStep:
      record.nextStep === null
        ? null
        : requireLabel(requireText(record.nextStep, 'last test'), 'last test', 500)
  }
}

function normalizeSchedule(schedule: ReportScheduleRecord): ReportScheduleRecord {
  return {
    ...scheduleFields(schedule),
    createdAt: requireUtcTimestamp(schedule.createdAt ?? new Date().toISOString())
  }
}

function scheduleFields(schedule: ReportScheduleRecord): Omit<ReportScheduleRecord, 'createdAt'> {
  const timing = requireTiming(schedule.timing)
  const sections = requireSections(schedule.sections)
  const marketIds = requireMarketIds(schedule.marketIds)
  const recipients = requireRecipients(schedule.recipients)
  const encoded = JSON.stringify({ timing, sections, marketIds, recipients })
  if (containsSecret(encoded)) throw new StorageError('report schedule cannot contain a secret')
  return {
    id: requireRowId(schedule.id),
    name: requireLabel(schedule.name, 'report name', 200),
    projectId: requireOptionalId(schedule.projectId, 'project'),
    timing,
    format: requireFormat(schedule.format),
    sections,
    marketIds,
    recipients,
    accountId: requireOptionalId(schedule.accountId, 'email account'),
    timeZone: requireTimeZone(schedule.timeZone),
    subject: requireLabel(schedule.subject, 'subject', 500),
    summaryStyle: requireSummaryStyle(schedule.summaryStyle),
    status: requireStatus(schedule.status),
    scope: requireScope(schedule.scope ?? null, schedule.projectId),
    report: requireReport(schedule.report ?? null)
  }
}

/** A stored ready report: a known kind, and a bare rival host (Head-to-head only) or null. */
function requireReport(report: ScheduledReport | null): ScheduledReport | null {
  if (report === null) return null
  if (
    typeof report !== 'object' ||
    typeof report.kind !== 'string' ||
    !isScheduledReportKind(report.kind)
  )
    throw new StorageError('Invalid scheduled report')
  const rival = report.rival ?? null
  if (rival !== null && (typeof rival !== 'string' || !RIVAL_DOMAIN.test(rival)))
    throw new StorageError('Invalid scheduled report')
  return { kind: report.kind, rival: report.kind === 'rival' ? rival : null }
}

function reportJson(report: ScheduledReport | null): string | null {
  return report === null ? null : JSON.stringify({ kind: report.kind, rival: report.rival })
}

/**
 * A stored scope. `project`, an empty pick, and any scope on an all-projects
 * schedule are the whole project (null). Ids are opaque row ids, deduped, capped.
 */
function requireScope(scope: ReportScope | null, projectId: string | null): ReportScope | null {
  if (scope === null || projectId === null) return null
  if (typeof scope !== 'object' || typeof scope.kind !== 'string' || !isReportScopeKind(scope.kind))
    throw new StorageError('Invalid report scope')
  if (!Array.isArray(scope.ids) || scope.ids.length > MAX_REPORT_SCOPE_IDS)
    throw new StorageError('Invalid report scope')
  if (scope.kind === 'project') return null
  const ids = [...new Set(scope.ids.map((id) => requireRowId(id)))]
  return ids.length === 0 ? null : { kind: scope.kind, ids }
}

function scopeJson(scope: ReportScope | null): string | null {
  return scope === null ? null : JSON.stringify({ kind: scope.kind, ids: scope.ids })
}

function scopeFromSql(encoded: string | null): ReportScope | null {
  if (encoded === null) return null
  const parsed = readJson(encoded, 'report scope') as ReportScope
  return parsed
}

function scheduleFromSql(row: ScheduleSql): ReportScheduleRecord {
  return normalizeSchedule({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    timing: readJson(row.timing_json, 'report timing') as ReportTiming,
    format: row.format as ReportFormat,
    sections: readStringArray(row.sections, 'sections'),
    marketIds: readStringArray(row.markets, 'markets'),
    recipients: readStringArray(row.recipients, 'recipients'),
    accountId: row.account_id,
    timeZone: row.time_zone,
    subject: row.subject,
    summaryStyle: row.summary_style as SummaryStyle | null,
    status: row.status as ReportScheduleStatus,
    scope: scopeFromSql(row.scope_json),
    report:
      row.report_json === null
        ? null
        : (readJson(row.report_json, 'scheduled report') as ScheduledReport),
    createdAt: row.created_at
  })
}

function normalizeDelivery(delivery: EmailDeliveryRecord): EmailDeliveryRecord {
  const recipients = requireRecipients(delivery.recipients)
  const nextStep = requireOptionalLabel(delivery.nextStep ?? null, 'next step', 500)
  if (containsSecret(JSON.stringify(recipients))) {
    throw new StorageError('delivery cannot contain a secret')
  }
  const outcome = requireOutcome(delivery.outcome)
  const ok = requireBoolean(delivery.ok, 'delivery result')
  if (ok !== (outcome === 'sent')) throw new StorageError('delivery ok must match outcome')
  return {
    id: requireRowId(delivery.id),
    scheduleId: requireOptionalId(delivery.scheduleId, 'report schedule'),
    at: requireUtcTimestamp(delivery.at),
    trigger: requireTrigger(delivery.trigger),
    projectId: requireOptionalId(delivery.projectId, 'project'),
    recipients,
    ok,
    error: requireOptionalLabel(delivery.error, 'delivery error', 2000),
    outcome,
    occurrenceKey: requireOccurrenceKey(delivery.occurrenceKey),
    nextStep
  }
}

function deliveryFromSql(row: DeliverySql): EmailDeliveryRecord {
  return normalizeDelivery({
    id: row.id,
    scheduleId: row.schedule_id,
    at: row.at,
    trigger: row.trigger as DeliveryTrigger,
    projectId: row.project_id,
    recipients: readStringArray(row.recipients, 'recipients'),
    ok: requireFlag(row.ok),
    error: row.error,
    outcome: row.outcome as DeliveryOutcome,
    occurrenceKey: row.occurrence_key,
    nextStep: row.next_step
  })
}

function requireTiming(value: unknown): ReportTiming {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StorageError('Invalid report timing')
  }
  const record = value as Record<string, unknown>
  if (record.kind === 'after_check') {
    if (Object.keys(record).length !== 1) throw new StorageError('Invalid report timing')
    return { kind: 'after_check' }
  }
  if (record.kind === 'weekly') {
    if (Object.keys(record).length !== 3 || typeof record.time !== 'string') {
      throw new StorageError('Invalid report timing')
    }
    return {
      kind: 'weekly',
      day: requireWeekday(record.day),
      time: requireClockTime(record.time, 'report time')
    }
  }
  if (record.kind === 'monthly') {
    if (Object.keys(record).length !== 3 || typeof record.time !== 'string') {
      throw new StorageError('Invalid report timing')
    }
    const when = record.when
    if (when !== '1' && when !== '15' && when !== 'last') {
      throw new StorageError('Invalid report timing')
    }
    return { kind: 'monthly', when, time: requireClockTime(record.time, 'report time') }
  }
  if (record.kind === 'on_change') {
    const scoreDropPoints = requireDrop(record.scoreDropPoints)
    const keys = Object.keys(record).sort().join(',')
    if (keys === 'kind,scoreDropPoints') {
      return { kind: 'on_change', scoreDropPoints, events: [...CHANGE_KINDS] }
    }
    if (keys === 'events,kind,scoreDropPoints') {
      return { kind: 'on_change', scoreDropPoints, events: requireChangeEvents(record.events) }
    }
    throw new StorageError('Invalid report timing')
  }
  throw new StorageError('Invalid report timing')
}

function requireChangeEvents(value: unknown): ChangeKind[] {
  if (!Array.isArray(value) || value.length === 0) throw new StorageError('Invalid report timing')
  const events: ChangeKind[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !isChangeKind(item) || events.includes(item)) {
      throw new StorageError('Invalid report timing')
    }
    events.push(item)
  }
  return events
}

function requireWeekday(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  if (
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6 ||
    value === 7
  ) {
    return value
  }
  throw new StorageError('Invalid report timing')
}

function requireDrop(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new StorageError('Invalid report timing')
  }
  return value
}

function requireSections(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new StorageError('Invalid sections')
  return values.map((item) => requireLabel(item, 'section', 80))
}

function requireMarketIds(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new StorageError('Invalid markets')
  return values.map((item) => requireRowId(item))
}

function requireRecipients(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new StorageError('Invalid recipients')
  return values.map((item) => requireEmail(item, 'recipient'))
}

function readStringArray(encoded: string, label: string): string[] {
  const parsed = readJson(encoded, label)
  if (!Array.isArray(parsed)) throw new StorageError(`Invalid ${label}`)
  return parsed.map((item) => requireText(item, label))
}

function requireFormat(value: string): ReportFormat {
  if (!isReportFormat(value)) throw new StorageError('Invalid report format')
  return value
}

function requireStatus(value: string): ReportScheduleStatus {
  if (!isReportScheduleStatus(value)) throw new StorageError('Invalid report schedule status')
  return value
}

function requireSummaryStyle(value: string | null): SummaryStyle | null {
  if (value === null) return null
  if (typeof value !== 'string' || !isOneOf(SUMMARY_STYLES, value)) {
    throw new StorageError('Invalid summary style')
  }
  return value
}

function requireTrigger(value: string): DeliveryTrigger {
  if (!isDeliveryTrigger(value)) throw new StorageError('Invalid delivery trigger')
  return value
}

function requireOutcome(value: string): DeliveryOutcome {
  if (!isDeliveryOutcome(value)) throw new StorageError('Invalid delivery outcome')
  return value
}

function requireOccurrenceKey(value: string | null): string | null {
  return requireOptionalLabel(value, 'occurrence key', 200)
}

function requireProvider(value: string): SmtpProvider {
  if (!isSmtpProvider(value)) throw new StorageError('Invalid email provider')
  return value
}

function requireSecurity(value: string): SmtpSecurity {
  if (!isSmtpSecurity(value)) throw new StorageError('Invalid email security')
  return value
}

function requireHost(value: string): string {
  const host = requireLabel(value, 'host', 253)
  if (/\s/.test(host) || host.includes('://') || host.includes('/') || host.includes('@')) {
    throw new StorageError('Invalid host')
  }
  return host
}

function requireUsername(value: string): string {
  const username = requireLabel(value, 'username', 320)
  if (/\s/.test(username)) throw new StorageError('Invalid username')
  return username
}

function requireEmail(value: string, label: string): string {
  const email = requireLabel(value, label, 320)
  if (!EMAIL.test(email)) throw new StorageError(`Invalid ${label}`)
  return email
}

function requirePort(value: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new StorageError('Invalid port')
  }
  return value
}

function requireTimeZone(value: string): string {
  const zone = requireLabel(value, 'time zone', 100)
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    throw new StorageError('Invalid time zone')
  }
  return zone
}

function requireRowId(value: string): string {
  const id = assertId(value)
  if (containsSecret(id)) throw new StorageError('id cannot contain a secret')
  return id
}

function requireOptionalId(value: string | null, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new StorageError(`Invalid ${label}`)
  return requireRowId(value)
}

function requireKeychainRef(value: string): string {
  if (typeof value !== 'string') throw new StorageError('Invalid keychain ref')
  if (containsSecret(value)) throw new StorageError('keychain ref cannot contain a secret')
  try {
    assertKeychainRef(value)
  } catch {
    throw new StorageError('Invalid keychain ref')
  }
  return value
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new StorageError(`Invalid ${label}`)
  return value
}

function requireFlag(value: number): boolean {
  if (value === 1) return true
  if (value === 0) return false
  throw new StorageError('Invalid flag')
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new StorageError(`Invalid ${label}`)
  return value
}

function runWrite(action: string, write: () => void): void {
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) {
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new StorageError(`${action}: referenced row is missing`)
      }
      if (error.code.startsWith('SQLITE_CONSTRAINT')) {
        const wrapped = new StorageError(`${action}: rejected by the database`)
        if (
          error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
        ) {
          wrapped.cause = error
        }
        throw wrapped
      }
    }
    throw new StorageError(`${action} failed`)
  }
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value)
}
