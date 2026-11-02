import { DEFAULT_INTERVAL_DAYS, isCapRule, isIntervalDays } from '@shared/domain'
import type { CapRule, IntervalDays, ProjectSchedule } from '@shared/domain'
import { containsSecret } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { recordTrackingChange } from './tracking-changes'
import { assertId, DEFAULT_DAILY_CHECK_TIME, requireClockTime, requireUtcTimestamp } from './values'

/**
 * SCH-9. One schedule row in the project database. Pages keep their own interval.
 * `projectId` is not a column: the file is already one project, and the caller
 * stamps it, the same way `getPage` does. `nextCheckAt` stays stored while the
 * project is paused (the next check after resume). `pagesDueToday` is 0 then.
 * A missing row reads as {@link defaultProjectSchedule} and is not inserted.
 * Cap columns (FR-11.4) are read and written on their own. A schedule write
 * leaves them in place, and a cap write leaves the schedule fields in place.
 * `dedicatedKeyId` is an `api_keys.id` from app.sqlite. It is never a secret.
 */
export function defaultProjectSchedule(projectId: string): ProjectSchedule {
  return {
    projectId: assertId(projectId),
    defaultIntervalDays: DEFAULT_INTERVAL_DAYS,
    dailyCheckTime: DEFAULT_DAILY_CHECK_TIME,
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    nextCheckAt: null,
    pagesDueToday: 0
  }
}

export function readProjectSchedule(db: SqliteDatabase, projectId: string): ProjectSchedule {
  const id = assertId(projectId)
  const row = db
    .prepare<unknown[], ScheduleSql>(
      `SELECT default_interval_days, daily_check_time, quiet_from, quiet_until,
              spread_across_day, catch_up, paused, next_check_at, pages_due_today
       FROM project_schedule WHERE id = 1`
    )
    .get()
  if (row === undefined) return defaultProjectSchedule(id)
  return scheduleFromSql(id, row)
}

export function writeProjectSchedule(db: SqliteDatabase, schedule: ProjectSchedule): void {
  const row = normalizeSchedule(schedule)
  const before = db
    .prepare<unknown[], Pick<ScheduleSql, 'default_interval_days' | 'daily_check_time'>>(
      `SELECT default_interval_days, daily_check_time FROM project_schedule WHERE id = 1`
    )
    .get()
  try {
    db.prepare(
      `INSERT INTO project_schedule (
         id, default_interval_days, daily_check_time, quiet_from, quiet_until,
         spread_across_day, catch_up, paused, next_check_at, pages_due_today
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         default_interval_days = excluded.default_interval_days,
         daily_check_time = excluded.daily_check_time,
         quiet_from = excluded.quiet_from,
         quiet_until = excluded.quiet_until,
         spread_across_day = excluded.spread_across_day,
         catch_up = excluded.catch_up,
         paused = excluded.paused,
         next_check_at = excluded.next_check_at,
         pages_due_today = excluded.pages_due_today`
    ).run(
      row.defaultIntervalDays,
      row.dailyCheckTime,
      row.quietFrom,
      row.quietUntil,
      row.spreadAcrossDay ? 1 : 0,
      row.catchUp ? 1 : 0,
      row.paused ? 1 : 0,
      row.nextCheckAt,
      row.pagesDueToday
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save project schedule')
    throw error
  }
  // A new interval or check time changes when the charts get points: mark it. The
  // scheduler's own writes (next check, pages due) leave both alone.
  if (before === undefined) return
  const days = before.default_interval_days !== row.defaultIntervalDays
  if (days || before.daily_check_time !== row.dailyCheckTime) {
    recordTrackingChange(db, {
      at: new Date().toISOString(),
      kind: 'schedule_changed',
      detail: days ? `every ${row.defaultIntervalDays} days` : 'time'
    })
  }
}

interface ScheduleSql {
  default_interval_days: number
  daily_check_time: string
  quiet_from: string | null
  quiet_until: string | null
  spread_across_day: number
  catch_up: number
  paused: number
  next_check_at: string | null
  pages_due_today: number
}

function scheduleFromSql(projectId: string, row: ScheduleSql): ProjectSchedule {
  return {
    projectId,
    defaultIntervalDays: requireInterval(row.default_interval_days),
    dailyCheckTime: requireClockTime(row.daily_check_time, 'daily check time'),
    quietFrom: row.quiet_from === null ? null : requireClockTime(row.quiet_from, 'quiet hours'),
    quietUntil: row.quiet_until === null ? null : requireClockTime(row.quiet_until, 'quiet hours'),
    spreadAcrossDay: row.spread_across_day === 1,
    catchUp: row.catch_up === 1,
    paused: row.paused === 1,
    nextCheckAt: row.next_check_at,
    pagesDueToday: row.pages_due_today
  }
}

function normalizeSchedule(schedule: ProjectSchedule): ProjectSchedule {
  const projectId = assertId(schedule.projectId)
  const quiet = requireQuietHours(schedule.quietFrom, schedule.quietUntil)
  const paused = requireBoolean(schedule.paused, 'paused')
  const pagesDueToday = requireCount(schedule.pagesDueToday, 'pagesDueToday')
  if (paused && pagesDueToday !== 0) {
    throw new StorageError('pagesDueToday stays 0 while the project is paused')
  }
  return {
    projectId,
    defaultIntervalDays: requireInterval(schedule.defaultIntervalDays),
    dailyCheckTime: requireClockTime(schedule.dailyCheckTime, 'daily check time'),
    quietFrom: quiet.from,
    quietUntil: quiet.until,
    spreadAcrossDay: requireBoolean(schedule.spreadAcrossDay, 'spreadAcrossDay'),
    catchUp: requireBoolean(schedule.catchUp, 'catchUp'),
    paused,
    nextCheckAt: schedule.nextCheckAt === null ? null : requireUtcTimestamp(schedule.nextCheckAt),
    pagesDueToday
  }
}

function requireQuietHours(
  from: string | null,
  until: string | null
): { from: string | null; until: string | null } {
  if (from === null && until === null) return { from: null, until: null }
  if (from === null || until === null) {
    throw new StorageError('Quiet hours need both a start and an end, or neither')
  }
  return {
    from: requireClockTime(from, 'quiet hours'),
    until: requireClockTime(until, 'quiet hours')
  }
}

function requireInterval(value: number): IntervalDays {
  if (typeof value !== 'number' || !isIntervalDays(value)) {
    throw new StorageError('Invalid project default interval')
  }
  return value
}

function requireBoolean(value: boolean, label: string): boolean {
  if (typeof value !== 'boolean') throw new StorageError(`Invalid ${label}`)
  return value
}

/** FR-11.4. Null cap means no project cap. The rule defaults to `pause`. */
export interface ProjectScheduleCap {
  cap: number | null
  capRule: CapRule
  /** Stored provider key id, or null when the project uses shared keys. */
  dedicatedKeyId: string | null
}

export function defaultProjectScheduleCap(): ProjectScheduleCap {
  return { cap: null, capRule: 'pause', dedicatedKeyId: null }
}

/**
 * The cap stored on `project_schedule`, or the defaults when the row is missing.
 * `projectId` is not a column. The caller already has the project.
 */
export function readProjectScheduleCap(db: SqliteDatabase): ProjectScheduleCap {
  const row = db
    .prepare<unknown[], CapSql>(
      `SELECT cap, cap_rule, dedicated_key_id FROM project_schedule WHERE id = 1`
    )
    .get()
  if (row === undefined) return defaultProjectScheduleCap()
  return capFromSql(row)
}

/**
 * Writes the cap columns. A missing schedule row is inserted with the SCH-9
 * defaults so the cap has a place to live. An existing row keeps its schedule.
 */
export function writeProjectScheduleCap(db: SqliteDatabase, cap: ProjectScheduleCap): void {
  const stored = normalizeCap(cap)
  const schedule = defaultProjectSchedule('project')
  try {
    db.prepare(
      `INSERT INTO project_schedule (
         id, default_interval_days, daily_check_time, quiet_from, quiet_until,
         spread_across_day, catch_up, paused, next_check_at, pages_due_today,
         cap, cap_rule, dedicated_key_id
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         cap = excluded.cap,
         cap_rule = excluded.cap_rule,
         dedicated_key_id = excluded.dedicated_key_id`
    ).run(
      schedule.defaultIntervalDays,
      schedule.dailyCheckTime,
      schedule.quietFrom,
      schedule.quietUntil,
      schedule.spreadAcrossDay ? 1 : 0,
      schedule.catchUp ? 1 : 0,
      schedule.paused ? 1 : 0,
      schedule.nextCheckAt,
      schedule.pagesDueToday,
      stored.cap,
      stored.capRule,
      stored.dedicatedKeyId
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save project cap')
    throw error
  }
}

/**
 * FR-11.4 notice choice "Continue this month at 10% over". A `notify` cap reads as
 * `allow_10` during `overMonth` only. Other rules and other months read as stored.
 */
export function effectiveCapRule(
  capRule: CapRule,
  overMonth: string | null,
  month: string
): CapRule {
  return capRule === 'notify' && overMonth !== null && overMonth === month ? 'allow_10' : capRule
}

/** The stored cap with the rule in force for `month` (`YYYY-MM`, local). */
export function readEffectiveScheduleCap(db: SqliteDatabase, month: string): ProjectScheduleCap {
  const cap = readProjectScheduleCap(db)
  return { ...cap, capRule: effectiveCapRule(cap.capRule, readCapOverMonth(db), month) }
}

/** Project migration 024. The month the user chose to go 10% over, or null. */
export function readCapOverMonth(db: SqliteDatabase): string | null {
  const row = db
    .prepare<unknown[], { cap_over_month: string | null }>(
      `SELECT cap_over_month FROM project_schedule WHERE id = 1`
    )
    .get()
  return row?.cap_over_month ?? null
}

/** Saves the month for "continue at 10% over". A missing schedule row gets the defaults. */
export function writeCapOverMonth(db: SqliteDatabase, month: string | null): void {
  if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new StorageError('Invalid month')
  }
  db.transaction(() => {
    const exists = db.prepare(`SELECT 1 FROM project_schedule WHERE id = 1`).get()
    if (exists === undefined) writeProjectScheduleCap(db, readProjectScheduleCap(db))
    db.prepare(`UPDATE project_schedule SET cap_over_month = ? WHERE id = 1`).run(month)
  })()
}

interface CapSql {
  cap: number | null
  cap_rule: string
  dedicated_key_id: string | null
}

function capFromSql(row: CapSql): ProjectScheduleCap {
  return {
    cap: requireCap(row.cap),
    capRule: requireCapRule(row.cap_rule),
    dedicatedKeyId:
      row.dedicated_key_id === null ? null : requireDedicatedKeyId(row.dedicated_key_id)
  }
}

function normalizeCap(cap: ProjectScheduleCap): ProjectScheduleCap {
  return {
    cap: requireCap(cap.cap),
    capRule: requireCapRule(cap.capRule),
    dedicatedKeyId: cap.dedicatedKeyId === null ? null : requireDedicatedKeyId(cap.dedicatedKeyId)
  }
}

function requireCap(value: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new StorageError('Invalid project cap')
  }
  return value
}

function requireCapRule(value: string): CapRule {
  if (!isCapRule(value)) throw new StorageError('Invalid cap rule')
  return value
}

function requireDedicatedKeyId(value: string): string {
  const id = assertId(value)
  if (containsSecret(id)) throw new StorageError('dedicated key cannot contain a secret')
  return id
}

function requireCount(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new StorageError(`Invalid ${label}`)
  }
  return value
}
