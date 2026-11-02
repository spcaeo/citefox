import {
  isChangeKind,
  isReportFormat,
  isReportScheduleStatus,
  isReportScopeKind,
  isScheduledReportKind,
  isSummaryStyle,
  RIVAL_DOMAIN,
  MAX_REPORT_SCOPE_IDS,
  type ReportScope,
  type ReportScheduleStatus,
  type ScheduledReport,
  type SummaryStyle
} from '@shared/domain'
import { EmailError } from '../errors'
import { requireClockTime, requireTimeZone } from '../due'
import type { ChangeKind, ReportSchedule, ReportTiming } from '../types'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const EMAIL = /^[^\s@]+@[^\s@]+$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const DROP_MAX = 1_000_000_000

const SCHEDULE_KEYS = [
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
  'summaryStyle',
  'status',
  'createdAt'
] as const

export interface ParsedSchedule extends Omit<ReportSchedule, 'status' | 'createdAt'> {
  status: ReportScheduleStatus
  createdAt: string
}

export function parseReportSchedule(value: unknown): ParsedSchedule {
  const record = plain(value, SCHEDULE_KEYS, ['scope', 'report'])
  if (typeof record.timeZone !== 'string') reject()
  requireTimeZone(record.timeZone)
  const format = record.format
  if (typeof format !== 'string' || !isReportFormat(format)) reject()
  const status = record.status
  if (typeof status !== 'string' || !isReportScheduleStatus(status)) reject()
  const projectId = readNullableId(record.projectId)
  return {
    id: readId(record.id),
    name: readLabel(record.name, 200),
    projectId,
    scope: parseReportScope(record.scope, projectId),
    report: parseScheduledReport(record.report),
    timing: parseTiming(record.timing),
    format,
    sections: readLabels(record.sections, 80),
    marketIds: readIds(record.marketIds),
    recipients: readEmails(record.recipients),
    accountId: readNullableId(record.accountId),
    timeZone: record.timeZone,
    subject: readLabel(record.subject, 500),
    summaryStyle: readSummaryStyle(record.summaryStyle),
    status,
    createdAt: readTimestamp(record.createdAt)
  }
}

/**
 * A schedule's scope. Missing, null, `project` and an empty pick are the whole
 * project (null), and so is any scope on an all-projects schedule. Ids are
 * opaque ids; repeats are dropped; more than {@link MAX_REPORT_SCOPE_IDS} is rejected.
 */
export function parseReportScope(value: unknown, projectId: string | null): ReportScope | null {
  if (value === undefined || value === null) return null
  const record = plain(value, ['kind', 'ids'])
  const kind = record.kind
  if (typeof kind !== 'string' || !isReportScopeKind(kind)) reject()
  if (!Array.isArray(record.ids) || record.ids.length > MAX_REPORT_SCOPE_IDS) reject()
  const ids = [...new Set(readIds(record.ids))]
  if (projectId === null || kind === 'project' || ids.length === 0) return null
  return { kind, ids }
}

/**
 * Which ready report a schedule sends. Missing or null is the check summary report.
 * `rival` is a bare host and only kept for Head-to-head.
 */
export function parseScheduledReport(value: unknown): ScheduledReport | null {
  if (value === undefined || value === null) return null
  const record = plain(value, ['kind'], ['rival'])
  const kind = record.kind
  if (typeof kind !== 'string' || !isScheduledReportKind(kind)) reject()
  const rival = record.rival ?? null
  if (rival !== null && (typeof rival !== 'string' || !RIVAL_DOMAIN.test(rival))) reject()
  return { kind, rival: kind === 'rival' ? (rival as string | null) : null }
}

/** `reports:sendNow`. */
export function parseSendNow(value: unknown): { scheduleId: string } {
  const record = plain(value, ['scheduleId'])
  return { scheduleId: readId(record.scheduleId) }
}

export function parseSetStatus(value: unknown): { id: string; status: ReportScheduleStatus } {
  const record = plain(value, ['id', 'status'])
  const status = record.status
  if (typeof status !== 'string' || !isReportScheduleStatus(status)) reject()
  return { id: readId(record.id), status }
}

export function parseDeleteSchedule(value: unknown): {
  projectId: string | null
  scheduleId: string
} {
  const record = plain(value, ['projectId', 'scheduleId'])
  return {
    projectId: readNullableId(record.projectId),
    scheduleId: readId(record.scheduleId)
  }
}

export function parseSendTest(value: unknown): { scheduleId: string; accountId: string | null } {
  const record = plain(value, ['scheduleId', 'accountId'])
  return {
    scheduleId: readId(record.scheduleId),
    accountId: readNullableId(record.accountId)
  }
}

export function parseListDeliveries(value: unknown): { scheduleId?: string } {
  const record = plain(value, [], ['scheduleId'])
  if (!has(record, 'scheduleId')) return {}
  return { scheduleId: readId(record.scheduleId) }
}

export function parseResend(value: unknown): { id: string } {
  const record = plain(value, ['id'])
  return { id: readId(record.id) }
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
    onlyKeys(record, ['kind', 'events', 'scoreDropPoints'])
    return {
      kind: 'on_change',
      events: readEvents(record.events),
      scoreDropPoints: readDrop(record.scoreDropPoints)
    }
  }
  reject()
}

function readEvents(value: unknown): ChangeKind[] {
  if (!Array.isArray(value)) reject()
  const events: ChangeKind[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !isChangeKind(item)) reject()
    if (events.includes(item)) reject()
    events.push(item)
  }
  return events
}

function readDrop(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > DROP_MAX) {
    reject()
  }
  return value
}

function readSummaryStyle(value: unknown): SummaryStyle | null {
  if (value === null) return null
  if (typeof value !== 'string' || !isSummaryStyle(value)) reject()
  return value
}

function readNullableId(value: unknown): string | null {
  if (value === null) return null
  return readId(value)
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) reject()
  return value
}

function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) reject()
  return value.map((item) => readId(item))
}

function readEmails(value: unknown): string[] {
  if (!Array.isArray(value)) reject()
  return value.map((item) => readEmail(item))
}

function readEmail(value: unknown): string {
  if (typeof value !== 'string' || !EMAIL.test(value) || /[\r\n]/.test(value)) reject()
  return value
}

function readLabels(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) reject()
  return value.map((item) => readLabel(item, max))
}

function readLabel(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) reject()
  if (value.trim() !== value || /[\r\n]/.test(value)) reject()
  return value
}

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !UTC.test(value)) reject()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) reject()
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
