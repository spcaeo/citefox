import type { EmailAccount, EmailMode } from '@shared/domain'
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
  StoredAlertSettings
} from './types'

/** FR-23.1. SMTP is the recommended mode until the user picks the mail app. */
export class MemoryEmailAccountStore implements EmailAccountStore {
  private mode: EmailMode = 'smtp'
  private readonly accounts: EmailAccount[] = []

  getMode(): EmailMode {
    return this.mode
  }

  setMode(mode: EmailMode): void {
    this.mode = mode
  }

  list(): readonly EmailAccount[] {
    return this.accounts.map(cloneAccount)
  }

  get(id: string): EmailAccount | null {
    const found = this.accounts.find((account) => account.id === id)
    return found === undefined ? null : cloneAccount(found)
  }

  insert(account: EmailAccount): void {
    this.accounts.push(cloneAccount(account))
  }

  update(account: EmailAccount): void {
    const index = this.accounts.findIndex((item) => item.id === account.id)
    if (index < 0) return
    this.accounts[index] = cloneAccount(account)
  }

  delete(id: string): void {
    const index = this.accounts.findIndex((item) => item.id === id)
    if (index >= 0) this.accounts.splice(index, 1)
  }
}

export class MemoryAlertStore implements AlertSettingsStore {
  private readonly rows = new Map<string, StoredAlertSettings>()

  get(projectId: string): StoredAlertSettings | null {
    const found = this.rows.get(projectId)
    return found === undefined ? null : cloneAlerts(found)
  }

  save(settings: StoredAlertSettings): void {
    this.rows.set(settings.projectId, cloneAlerts(settings))
  }
}

export class MemoryReportStore implements ReportScheduleStore {
  private readonly rows: ReportSchedule[] = []

  constructor(private readonly now: () => Date = () => new Date()) {}

  list(): readonly ReportSchedule[] {
    return this.rows.map(cloneReport)
  }

  get(id: string): ReportSchedule | null {
    const found = this.rows.find((schedule) => schedule.id === id)
    return found === undefined ? null : cloneReport(found)
  }

  save(schedule: ReportSchedule): void {
    const index = this.rows.findIndex((item) => item.id === schedule.id)
    if (index < 0) this.rows.push(cloneReport(schedule))
    else this.rows[index] = cloneReport(schedule)
  }

  delete(projectId: string | null, scheduleId: string): string | null {
    const index = this.rows.findIndex((schedule) => schedule.id === scheduleId)
    if (index < 0) return null
    const schedule = this.rows[index]
    if (schedule === undefined || schedule.projectId !== projectId) return null
    const deletedAt = this.now().toISOString()
    this.rows.splice(index, 1)
    return deletedAt
  }
}

export class MemoryDeliveryStore implements DeliveryStore {
  private readonly records: DeliveryRecord[] = []
  private readonly throttled = new Set<string>()

  add(record: DeliveryRecord): DeliveryAddResult {
    const occurrenceKey = record.outcome === 'failed' ? null : record.occurrenceKey
    if (occurrenceKey !== null && this.occurrenceTaken(record.scheduleId, occurrenceKey)) {
      return 'already_sent'
    }
    this.records.push(cloneDelivery({ ...record, occurrenceKey }))
    if (occurrenceKey !== null) this.throttled.add(occurrenceKey)
    return 'recorded'
  }

  list(): readonly DeliveryRecord[] {
    return this.records.map(cloneDelivery)
  }

  hasThrottle(key: string): boolean {
    return this.throttled.has(key)
  }

  markThrottle(key: string): void {
    this.throttled.add(key)
  }

  private occurrenceTaken(scheduleId: string | null, key: string): boolean {
    return this.records.some((record) => {
      if (record.occurrenceKey !== key) return false
      if (scheduleId === null) return record.scheduleId === null
      return record.scheduleId === scheduleId
    })
  }
}

export class MemoryMonthlyPdfStore implements MonthlyPdfStore {
  private readonly items: QueuedMonthlyPdf[] = []

  add(item: QueuedMonthlyPdf): MonthlyPdfAddResult {
    const taken = this.items.some(
      (queued) => queued.projectId === item.projectId && queued.dueDate === item.dueDate
    )
    if (taken) return 'already_queued'
    this.items.push(clonePdf(item))
    return 'queued'
  }

  list(): readonly QueuedMonthlyPdf[] {
    return this.items.map(clonePdf)
  }

  remove(id: string): void {
    const index = this.items.findIndex((item) => item.id === id)
    if (index >= 0) this.items.splice(index, 1)
  }
}

/** FR-23.11. Failures sort first. Inside a group, newest `at` is first. */
export function sortDeliveries(
  records: readonly DeliveryRecord[],
  failedOnly: boolean
): DeliveryRecord[] {
  const filtered = failedOnly
    ? records.filter((record) => record.outcome === 'failed')
    : [...records]
  return filtered.sort((left, right) => {
    const leftFailed = left.outcome === 'failed' ? 0 : 1
    const rightFailed = right.outcome === 'failed' ? 0 : 1
    if (leftFailed !== rightFailed) return leftFailed - rightFailed
    if (left.at !== right.at) return left.at < right.at ? 1 : -1
    return left.id < right.id ? 1 : -1
  })
}

function cloneAccount(account: EmailAccount): EmailAccount {
  return { ...account, usedFor: account.usedFor.map((use) => ({ ...use })) }
}

function cloneAlerts(settings: StoredAlertSettings): StoredAlertSettings {
  return { ...settings, emailTo: [...settings.emailTo] }
}

function cloneReport(schedule: ReportSchedule): ReportSchedule {
  return {
    ...schedule,
    timing: cloneTiming(schedule.timing),
    sections: [...schedule.sections],
    marketIds: [...schedule.marketIds],
    recipients: [...schedule.recipients]
  }
}

function cloneTiming(timing: ReportSchedule['timing']): ReportSchedule['timing'] {
  if (timing.kind !== 'on_change') return { ...timing }
  return { kind: 'on_change', scoreDropPoints: timing.scoreDropPoints, events: [...timing.events] }
}

function cloneDelivery(record: DeliveryRecord): DeliveryRecord {
  return {
    ...record,
    recipients: [...record.recipients],
    ok: record.outcome === 'sent'
  }
}

function clonePdf(item: QueuedMonthlyPdf): QueuedMonthlyPdf {
  return { ...item, bytes: new Uint8Array(item.bytes) }
}
