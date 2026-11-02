import type { EmailAccount, EmailAccountUse, EmailMode, ReportScope } from '@shared/domain'
import { CHANGE_KINDS, isSendNowDelivery } from '@shared/domain'
import type { Logger } from '../logging/logger'
import { REDACTED, redactString } from '../logging/redact'
import { requireOptionalLabel } from '../storage/values'
import {
  addPendingClientPdf,
  closeProjectDatabase,
  deleteEmailAccount,
  getAlertSettings,
  getEmailAccount,
  getEmailMode,
  getProject,
  getReportSchedule,
  hasEmailThrottle,
  insertDelivery,
  insertEmailAccount,
  insertReportSchedule,
  isUniqueConstraintError,
  listDeliveries,
  listEmailAccounts,
  listPendingClientPdfs,
  listReportSchedules,
  markEmailThrottle,
  openProjectDatabase,
  readPendingClientPdf,
  removePendingClientPdf,
  saveAlertSettings,
  setEmailMode,
  StorageError,
  updateEmailAccount,
  updateReportSchedule,
  type EmailDeliveryRecord,
  type ReportScheduleRecord,
  type ReportTiming as StoredReportTiming,
  type SqliteDatabase
} from '../storage'
import { isSingleEmailAddress } from './parse'
import type { EmailClock } from './types'
import type {
  AlertSettingsStore,
  DeliveryAddResult,
  DeliveryRecord,
  DeliveryStore,
  EmailAccountStore,
  MonthlyPdfAddResult,
  MonthlyPdfStore,
  QueuedMonthlyPdf,
  ReportSchedule,
  ReportScheduleStore,
  ReportTiming,
  StoredAlertSettings
} from './types'

/**
 * Writes used inside the delivery transaction.
 * Production passes Engine's `insertDelivery` and `markEmailThrottle`.
 * Tests can throw after the real write to prove the transaction rolls back.
 */
export interface DeliveryWriters {
  insert(db: SqliteDatabase, delivery: EmailDeliveryRecord): void
  mark(db: SqliteDatabase, key: string, at: string): void
}

const engineWriters: DeliveryWriters = {
  insert: (db, delivery) => insertDelivery(db, delivery),
  mark: (db, key, at) => markEmailThrottle(db, key, at)
}

export interface StorageEmailStoreDeps {
  app: SqliteDatabase
  projectsDirectory: string
  outboxDir: string
  clock: EmailClock
  logger: Logger
}

export interface StorageEmailStores {
  accounts: EmailAccountStore
  alerts: StorageAlertStore
  reports: ReportScheduleStore
  deliveries: DeliveryStore
  pdfs: MonthlyPdfStore
  close(): void
}

/**
 * Stores that call Engine's app.sqlite and project-database functions.
 * The service stays on the store interfaces, so tests can still inject fakes.
 */
export function createStorageEmailStores(deps: StorageEmailStoreDeps): StorageEmailStores {
  const alerts = new StorageAlertStore(deps.app, deps.projectsDirectory)
  return {
    accounts: new StorageEmailAccountStore(deps.app, alerts),
    alerts,
    reports: new StorageReportStore(deps.app, deps.clock),
    deliveries: new StorageDeliveryStore(deps.app, deps.clock, engineWriters, deps.logger),
    pdfs: new StorageMonthlyPdfStore(deps.app, deps.outboxDir, deps.clock),
    close() {
      alerts.close()
    }
  }
}

export class StorageEmailAccountStore implements EmailAccountStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly alerts: StorageAlertStore
  ) {}

  getMode(): EmailMode {
    return getEmailMode(this.db)
  }

  setMode(mode: EmailMode): void {
    setEmailMode(this.db, mode)
  }

  list(): readonly EmailAccount[] {
    const usage = this.usageByAccount()
    return listEmailAccounts(this.db).map((account) => ({
      ...account,
      usedFor: usage.get(account.id) ?? []
    }))
  }

  get(id: string): EmailAccount | null {
    const account = getEmailAccount(this.db, id)
    if (account === null) return null
    return { ...account, usedFor: this.usageByAccount().get(account.id) ?? [] }
  }

  insert(account: EmailAccount): void {
    insertEmailAccount(this.db, account)
  }

  update(account: EmailAccount): void {
    updateEmailAccount(this.db, account)
  }

  delete(id: string): void {
    deleteEmailAccount(this.db, id)
  }

  /**
   * Projects whose alerts name the account, then live schedules whose
   * `account_id` is that account. A null schedule account is the default
   * account at send time and is not listed here. `deleted_at` rows are omitted.
   */
  private usageByAccount(): Map<string, EmailAccountUse[]> {
    const usage = new Map<string, EmailAccountUse[]>()
    const add = (accountId: string, use: EmailAccountUse): void => {
      const list = usage.get(accountId)
      if (list === undefined) usage.set(accountId, [use])
      else list.push(use)
    }
    for (const project of this.alerts.projectsNamingAccounts()) {
      add(project.emailAccountId, { projectId: project.projectId, label: project.label })
    }
    const schedules = this.db
      .prepare<
        unknown[],
        { id: string; name: string; project_id: string | null; account_id: string }
      >(
        `SELECT id, name, project_id, account_id
         FROM report_schedules
         WHERE deleted_at IS NULL AND account_id IS NOT NULL
         ORDER BY rowid ASC`
      )
      .all()
    for (const schedule of schedules) {
      add(schedule.account_id, {
        projectId: schedule.project_id,
        scheduleId: schedule.id,
        label: schedule.name
      })
    }
    return usage
  }
}

/**
 * FR-23.13. Alert toggles live in the project database, one file per project.
 * A missing project is null. A project with no alerts row reports desktop on
 * and leaves email, Slack, and the monthly PDF off. The row is not inserted.
 * `desktop` is NOT NULL, so a stored row always has 0 or 1. A stored 0 stays off.
 * Handles stay open until `close` or `evictProject`. A read also drops a handle
 * when the project row is gone, so a deleted project is not used again.
 */
export class StorageAlertStore implements AlertSettingsStore {
  private readonly open = new Map<string, SqliteDatabase>()

  constructor(
    private readonly app: SqliteDatabase,
    private readonly projectsDirectory: string
  ) {}

  get(projectId: string): StoredAlertSettings | null {
    const db = this.projectDb(projectId)
    if (db === null) return null
    const stored = getAlertSettings(db, projectId)
    const monthlyPdfTo = readMonthlyPdfTo(db)
    if (alertRowExists(db)) return { ...stored, monthlyPdfTo }
    return { ...stored, desktop: true, monthlyPdfTo }
  }

  save(settings: StoredAlertSettings): void {
    const db = this.projectDb(settings.projectId)
    if (db === null) throw new StorageError('Project database does not exist')
    if (!isMonthlyPdfTo(settings.monthlyPdfTo)) throw new StorageError('Invalid monthly pdf to')
    db.transaction(() => {
      saveAlertSettings(db, settings)
      writeMonthlyPdfTo(db, settings.monthlyPdfTo)
    })()
  }

  /**
   * Projects whose alert row names a sending account.
   * The label is `projects.name`. A missing alert row does not name an account.
   */
  projectsNamingAccounts(): readonly {
    projectId: string
    label: string
    emailAccountId: string
  }[] {
    const projects = this.app
      .prepare<unknown[], { id: string; name: string }>(
        `SELECT id, name FROM projects ORDER BY rowid ASC`
      )
      .all()
    const named: { projectId: string; label: string; emailAccountId: string }[] = []
    for (const project of projects) {
      const settings = this.get(project.id)
      if (settings === null || settings.emailAccountId === null) continue
      named.push({
        projectId: project.id,
        label: project.name,
        emailAccountId: settings.emailAccountId
      })
    }
    return named
  }

  /**
   * Closes and drops the cached project database.
   * Call this when the project is deleted. Returns the closed database, or null
   * when this store had not opened one. A later read opens a new handle when
   * the project row is still there.
   */
  evictProject(projectId: string): SqliteDatabase | null {
    const cached = this.open.get(projectId)
    if (cached === undefined) return null
    this.open.delete(projectId)
    closeProjectDatabase(cached)
    return cached
  }

  close(): void {
    for (const db of this.open.values()) closeProjectDatabase(db)
    this.open.clear()
  }

  private projectDb(projectId: string): SqliteDatabase | null {
    const project = getProject(this.app, projectId)
    if (project === null) {
      this.evictProject(projectId)
      return null
    }
    const cached = this.open.get(projectId)
    if (cached !== undefined) return cached
    const db = openProjectDatabase(this.projectsDirectory, project.slug)
    this.open.set(projectId, db)
    return db
  }
}

function alertRowExists(db: SqliteDatabase): boolean {
  const row = db
    .prepare<unknown[], { id: number }>(`SELECT id FROM alert_settings WHERE id = 1`)
    .get()
  return row !== undefined
}

/**
 * FR-23.12 and NFR-15. `createdAt` is `report_schedules.created_at`.
 * Insert stores the injected clock. Update does not write the column.
 * A read returns the stored value and does not stamp a missing one.
 * List, get, and due delivery omit rows whose `deleted_at` is set.
 */
export class StorageReportStore implements ReportScheduleStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: EmailClock
  ) {}

  list(): readonly ReportSchedule[] {
    const live = this.liveScheduleIds()
    return listReportSchedules(this.db)
      .filter((row) => live.has(row.id))
      .map((row) => this.fromRow(row))
  }

  get(id: string): ReportSchedule | null {
    if (!this.scheduleIsLive(id)) return null
    const row = getReportSchedule(this.db, id)
    return row === null ? null : this.fromRow(row)
  }

  save(schedule: ReportSchedule): void {
    if (getReportSchedule(this.db, schedule.id) === null) {
      insertReportSchedule(this.db, toStoredSchedule(schedule, this.clock.now().toISOString()))
      return
    }
    updateReportSchedule(this.db, toStoredSchedule(schedule))
  }

  /**
   * One UPDATE. `project_id IS ?` matches NULL when `projectId` is null.
   * `deleted_at` is the injected clock as ISO UTC. No row changed is not found.
   * Pending occurrences are computed from live schedules, so hiding the row
   * drops them from due delivery. Already-sent throttle rows stay.
   */
  delete(projectId: string | null, scheduleId: string): string | null {
    const deletedAt = this.clock.now().toISOString()
    const result = this.db
      .prepare(
        `UPDATE report_schedules SET deleted_at = ? WHERE id = ? AND project_id IS ? AND deleted_at IS NULL`
      )
      .run(deletedAt, scheduleId, projectId)
    if (result.changes !== 1) return null
    return deletedAt
  }

  /** List and due delivery. `deleted_at IS NOT NULL` stays out. */
  private liveScheduleIds(): ReadonlySet<string> {
    const rows = this.db
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM report_schedules WHERE deleted_at IS NULL`
      )
      .all()
    return new Set(rows.map((row) => row.id))
  }

  /** Get. A deleted id is not live. */
  private scheduleIsLive(id: string): boolean {
    const row = this.db
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM report_schedules WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id)
    return row !== undefined
  }

  private fromRow(row: ReportScheduleRecord): ReportSchedule {
    return {
      ...row,
      timing: fromStoredTiming(row.timing),
      sections: [...row.sections],
      marketIds: [...row.marketIds],
      recipients: [...row.recipients],
      scope: copyScope(row.scope ?? null),
      report: row.report ? { kind: row.report.kind, rival: row.report.rival } : null,
      createdAt: storedCreatedAt(row.createdAt)
    }
  }
}

/**
 * Sent and draft rows with an occurrence key are inserted and throttled in one
 * app.sqlite transaction. Failed rows store a null key and do not mark it.
 * A unique-constraint hit is already sent: no second row, and this transaction
 * does not change the throttle.
 */
export class StorageDeliveryStore implements DeliveryStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: EmailClock,
    private readonly writers: DeliveryWriters,
    private readonly logger: Logger
  ) {}

  add(record: DeliveryRecord): DeliveryAddResult {
    const stored = toStoredDelivery(record, this.logger)
    try {
      const run = this.db.transaction(() => {
        this.writers.insert(this.db, stored)
        if (stored.occurrenceKey !== null) {
          this.writers.mark(this.db, stored.occurrenceKey, stored.at)
        }
      })
      run()
      return 'recorded'
    } catch (error) {
      if (isUniqueConstraintError(error)) return 'already_sent'
      throw error
    }
  }

  list(): readonly DeliveryRecord[] {
    return listDeliveries(this.db).map(fromStoredDelivery)
  }

  hasThrottle(key: string): boolean {
    return hasEmailThrottle(this.db, key)
  }

  markThrottle(key: string): void {
    markEmailThrottle(this.db, key, this.clock.now().toISOString())
  }
}

/**
 * FR-23.13. One monthly PDF per project and due date.
 * `createdAt` comes from the injected clock. A unique hit is already queued.
 * Engine writes the file only after the insert, so a hit leaves no extra file.
 */
export class StorageMonthlyPdfStore implements MonthlyPdfStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly outboxDir: string,
    private readonly clock: EmailClock
  ) {}

  add(item: QueuedMonthlyPdf): MonthlyPdfAddResult {
    try {
      addPendingClientPdf(this.db, this.outboxDir, {
        id: item.id,
        projectId: item.projectId,
        projectName: item.projectName,
        dueDate: item.dueDate,
        filename: item.filename,
        bytes: item.bytes,
        createdAt: this.clock.now().toISOString()
      })
      return 'queued'
    } catch (error) {
      if (isUniqueConstraintError(error)) return 'already_queued'
      throw error
    }
  }

  list(): readonly QueuedMonthlyPdf[] {
    return listPendingClientPdfs(this.db, this.outboxDir).map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: item.projectName,
      dueDate: item.dueDate,
      filename: item.filename,
      bytes: readPendingClientPdf(this.db, this.outboxDir, item.id)
    }))
  }

  remove(id: string): void {
    removePendingClientPdf(this.db, this.outboxDir, id)
  }
}

function copyScope(scope: ReportScope | null): ReportScope | null {
  return scope === null ? null : { kind: scope.kind, ids: [...scope.ids] }
}

function toStoredSchedule(schedule: ReportSchedule, createdAt?: string): ReportScheduleRecord {
  return {
    id: schedule.id,
    name: schedule.name,
    projectId: schedule.projectId,
    timing: toStoredTiming(schedule.timing),
    format: schedule.format,
    sections: [...schedule.sections],
    marketIds: [...schedule.marketIds],
    recipients: [...schedule.recipients],
    accountId: schedule.accountId,
    timeZone: schedule.timeZone,
    subject: schedule.subject,
    summaryStyle: schedule.summaryStyle,
    status: schedule.status,
    scope: schedule.scope ?? null,
    report: schedule.report ?? null,
    ...(createdAt === undefined ? {} : { createdAt })
  }
}

function toStoredTiming(timing: ReportTiming): StoredReportTiming {
  if (timing.kind !== 'on_change') return timing
  return {
    kind: 'on_change',
    scoreDropPoints: timing.scoreDropPoints,
    events: [...timing.events]
  }
}

function fromStoredTiming(timing: StoredReportTiming): ReportTiming {
  if (timing.kind !== 'on_change') return timing
  return {
    kind: 'on_change',
    scoreDropPoints: timing.scoreDropPoints,
    events: timing.events === undefined ? [...CHANGE_KINDS] : [...timing.events]
  }
}

function storedCreatedAt(value: string | undefined): string {
  if (value === undefined) throw new StorageError('Invalid timestamp')
  return value
}

function toStoredDelivery(record: DeliveryRecord, logger: Logger): EmailDeliveryRecord {
  const occurrenceKey =
    record.outcome === 'failed' && !isSendNowDelivery(record) ? null : record.occurrenceKey
  return {
    id: record.id,
    scheduleId: record.scheduleId,
    at: record.at,
    trigger: record.trigger,
    projectId: record.projectId,
    recipients: [...record.recipients],
    ok: record.outcome === 'sent',
    error: record.outcome === 'sent' ? null : record.reason,
    outcome: record.outcome,
    occurrenceKey,
    nextStep: acceptedNextStep(record.nextStep, logger)
  }
}

/** History reads `error` as the reason. `ok` follows `outcome` (FR-23.11). */
function fromStoredDelivery(row: EmailDeliveryRecord): DeliveryRecord {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    at: row.at,
    trigger: row.trigger,
    projectId: row.projectId,
    recipients: [...row.recipients],
    outcome: row.outcome,
    ok: row.outcome === 'sent',
    reason: row.outcome === 'sent' ? null : row.error,
    nextStep: row.nextStep ?? null,
    occurrenceKey: row.occurrenceKey
  }
}

/** Storage's next-step label limit. Longer text is capped before validation. */
const NEXT_STEP_MAX = 500

/**
 * Cap, then storage's `requireOptionalLabel`. A rejected step is null so the
 * delivery row and its throttle still commit. The warning does not include the step.
 */
function acceptedNextStep(value: string | null, logger: Logger): string | null {
  const capped = capNextStep(value)
  try {
    return requireOptionalLabel(capped, 'next step', NEXT_STEP_MAX)
  } catch {
    logger.warn(redactString(`Delivery next step omitted ${REDACTED}`))
    return null
  }
}

function capNextStep(value: string | null): string | null {
  if (value === null || value.length <= NEXT_STEP_MAX) return value
  const capped = value.slice(0, NEXT_STEP_MAX).trimEnd()
  if (capped.length === 0) return null
  return capped
}

function isMonthlyPdfTo(value: string | null): boolean {
  return value === null || isSingleEmailAddress(value)
}

function readMonthlyPdfTo(db: SqliteDatabase): string | null {
  const row = db
    .prepare<unknown[], { monthly_pdf_to: string | null }>(
      `SELECT monthly_pdf_to FROM alert_settings WHERE id = 1`
    )
    .get()
  if (row === undefined || row.monthly_pdf_to === null) return null
  if (!isSingleEmailAddress(row.monthly_pdf_to)) {
    throw new StorageError('Invalid monthly pdf to')
  }
  return row.monthly_pdf_to
}

function writeMonthlyPdfTo(db: SqliteDatabase, value: string | null): void {
  db.prepare(`UPDATE alert_settings SET monthly_pdf_to = ? WHERE id = 1`).run(value)
}
