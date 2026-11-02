import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { ensureProjectSchema } from './project-profile'
import {
  defaultProjectSchedule,
  defaultProjectScheduleCap,
  readProjectSchedule,
  readProjectScheduleCap,
  writeProjectSchedule,
  writeProjectScheduleCap
} from './project-schedule'
import { PROJECT_MIGRATIONS } from './project-schema'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('project schedule', () => {
  test('reads SCH-9 defaults until the first write, then round-trips', () => {
    const db = projectDb()
    expect(countRows(db)).toBe(0)
    expect(readProjectSchedule(db, 'proj-1')).toEqual(defaultProjectSchedule('proj-1'))
    expect(defaultProjectSchedule('proj-1')).toMatchObject({
      defaultIntervalDays: 7,
      dailyCheckTime: '08:00',
      quietFrom: null,
      quietUntil: null,
      spreadAcrossDay: false,
      catchUp: true,
      paused: false,
      nextCheckAt: null,
      pagesDueToday: 0
    })

    writeProjectSchedule(db, {
      ...defaultProjectSchedule('proj-1'),
      defaultIntervalDays: 30,
      dailyCheckTime: '22:15',
      quietFrom: '22:00',
      quietUntil: '07:00',
      spreadAcrossDay: true,
      catchUp: false,
      nextCheckAt: '2026-04-20T08:00:00.000Z',
      pagesDueToday: 4
    })
    expect(countRows(db)).toBe(1)
    expect(readProjectSchedule(db, 'proj-1')).toMatchObject({
      projectId: 'proj-1',
      defaultIntervalDays: 30,
      dailyCheckTime: '22:15',
      quietFrom: '22:00',
      quietUntil: '07:00',
      spreadAcrossDay: true,
      catchUp: false,
      paused: false,
      nextCheckAt: '2026-04-20T08:00:00.000Z',
      pagesDueToday: 4
    })

    writeProjectSchedule(db, {
      ...readProjectSchedule(db, 'proj-1'),
      paused: true,
      pagesDueToday: 0,
      quietFrom: '08:00',
      quietUntil: '08:00'
    })
    expect(readProjectSchedule(db, 'proj-1')).toMatchObject({
      paused: true,
      pagesDueToday: 0,
      nextCheckAt: '2026-04-20T08:00:00.000Z',
      quietFrom: '08:00',
      quietUntil: '08:00'
    })
  })

  test('rejects a half quiet window, a bad interval, and pages due while paused', () => {
    const db = projectDb()
    const base = defaultProjectSchedule('proj-1')
    expect(() =>
      writeProjectSchedule(db, { ...base, quietFrom: '22:00', quietUntil: null })
    ).toThrow(/both a start and an end/)
    expect(() =>
      writeProjectSchedule(db, {
        ...base,
        defaultIntervalDays: 15 as (typeof base)['defaultIntervalDays']
      })
    ).toThrow(/interval/)
    expect(() => writeProjectSchedule(db, { ...base, paused: true, pagesDueToday: 2 })).toThrow(
      /pagesDueToday stays 0/
    )
    expect(() => writeProjectSchedule(db, { ...base, dailyCheckTime: '8:00' })).toThrow(
      /daily check time/
    )
    expect(countRows(db)).toBe(0)
  })

  test('reads a null cap and pause until a cap is written, and keeps the schedule', () => {
    const db = projectDb()
    expect(readProjectScheduleCap(db)).toEqual(defaultProjectScheduleCap())
    expect(defaultProjectScheduleCap()).toEqual({
      cap: null,
      capRule: 'pause',
      dedicatedKeyId: null
    })
    expect(countRows(db)).toBe(0)

    writeProjectSchedule(db, {
      ...defaultProjectSchedule('proj-1'),
      defaultIntervalDays: 30,
      dailyCheckTime: '09:30',
      paused: true
    })
    writeProjectScheduleCap(db, { cap: 0, capRule: 'notify', dedicatedKeyId: 'key-serp-1' })
    expect(readProjectScheduleCap(db)).toEqual({
      cap: 0,
      capRule: 'notify',
      dedicatedKeyId: 'key-serp-1'
    })
    expect(readProjectSchedule(db, 'proj-1')).toMatchObject({
      defaultIntervalDays: 30,
      dailyCheckTime: '09:30',
      paused: true,
      pagesDueToday: 0
    })

    writeProjectSchedule(db, {
      ...readProjectSchedule(db, 'proj-1'),
      dailyCheckTime: '10:00',
      paused: false,
      pagesDueToday: 3
    })
    expect(readProjectScheduleCap(db)).toEqual({
      cap: 0,
      capRule: 'notify',
      dedicatedKeyId: 'key-serp-1'
    })

    writeProjectScheduleCap(db, { cap: 40, capRule: 'allow_10', dedicatedKeyId: null })
    expect(readProjectScheduleCap(db)).toEqual({
      cap: 40,
      capRule: 'allow_10',
      dedicatedKeyId: null
    })
    expect(readProjectSchedule(db, 'proj-1').dailyCheckTime).toBe('10:00')
    expect(countRows(db)).toBe(1)
  })

  test('inserts schedule defaults when the cap is written first', () => {
    const db = projectDb()
    writeProjectScheduleCap(db, { cap: null, capRule: 'pause', dedicatedKeyId: 'key-1' })
    expect(readProjectSchedule(db, 'proj-1')).toEqual(defaultProjectSchedule('proj-1'))
    expect(readProjectScheduleCap(db).dedicatedKeyId).toBe('key-1')
  })

  test('rejects a bad cap, a bad rule, and a secret stored as a key id', () => {
    const db = projectDb()
    const base = defaultProjectScheduleCap()
    expect(() => writeProjectScheduleCap(db, { ...base, cap: -1 })).toThrow(/project cap/)
    expect(() => writeProjectScheduleCap(db, { ...base, cap: 1.5 })).toThrow(/project cap/)
    expect(() =>
      writeProjectScheduleCap(db, { ...base, capRule: 'stop' as (typeof base)['capRule'] })
    ).toThrow(/cap rule/)
    expect(() => writeProjectScheduleCap(db, { ...base, dedicatedKeyId: '' })).toThrow(/id/)
    expect(() =>
      writeProjectScheduleCap(db, { ...base, dedicatedKeyId: 'sk-ant-abcdefghij1234' })
    ).toThrow(/secret/)
    expect(() => writeProjectScheduleCap(db, { ...base, dedicatedKeyId: 'a'.repeat(64) })).toThrow(
      /secret/
    )
    expect(countRows(db)).toBe(0)
  })

  test('upgrades an existing schedule row to a null cap, pause, and no dedicated key', () => {
    const db = openSqliteDatabase(':memory:')
    databases.push(db)
    migrate(db, PROJECT_MIGRATIONS.slice(0, 7))
    db.prepare(
      `INSERT INTO project_schedule (
         id, default_interval_days, daily_check_time, quiet_from, quiet_until,
         spread_across_day, catch_up, paused, next_check_at, pages_due_today
       ) VALUES (1, 30, '09:30', '22:00', '07:00', 1, 0, 0, '2026-05-01T09:30:00.000Z', 2)`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(readProjectScheduleCap(db)).toEqual({
      cap: null,
      capRule: 'pause',
      dedicatedKeyId: null
    })
    expect(readProjectSchedule(db, 'proj-1')).toMatchObject({
      defaultIntervalDays: 30,
      dailyCheckTime: '09:30',
      quietFrom: '22:00',
      quietUntil: '07:00',
      spreadAcrossDay: true,
      catchUp: false,
      nextCheckAt: '2026-05-01T09:30:00.000Z',
      pagesDueToday: 2
    })
    const rule = db
      .prepare<unknown[], { name: string; dflt_value: string | null; notnull: number }>(
        `PRAGMA table_info(project_schedule)`
      )
      .all()
      .find((column) => column.name === 'cap_rule')
    expect(rule).toMatchObject({ notnull: 1 })
    expect(rule?.dflt_value).toContain('pause')
    expect(() => db.prepare(`UPDATE project_schedule SET cap_rule = 'stop'`).run()).toThrow()
    expect(() => db.prepare(`UPDATE project_schedule SET cap = -1`).run()).toThrow()
    const names = db
      .prepare<unknown[], { name: string }>('SELECT name FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.name)
    expect(names).toContain('008_project_schedule_caps')
  })
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  return db
}

function countRows(db: SqliteDatabase): number {
  const row = db
    .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM project_schedule')
    .get()
  return row?.n ?? 0
}
