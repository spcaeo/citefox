import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { CHANGE_KINDS, type PageSummary } from '@shared/domain'
import { createLogger } from '../logging/logger'
import { openAppDatabase } from './app-database'
import {
  closeDatabase,
  isUniqueConstraintError,
  openSqliteDatabase,
  type SqliteDatabase
} from './database'
import {
  deleteDelivery,
  deleteEmailAccount,
  deleteReportSchedule,
  getDelivery,
  getEmailAccount,
  getReportSchedule,
  insertDelivery,
  insertEmailAccount,
  insertReportSchedule,
  listDeliveries,
  listEmailAccounts,
  listReportSchedules,
  updateEmailAccount,
  updateReportSchedule,
  type EmailAccountRecord,
  type EmailDeliveryRecord,
  type ReportScheduleRecord,
  type ReportTiming
} from './email-records'
import { insertPage, setPageStatus } from './pages'
import { ensureProjectSchema, writeProjectProfile } from './project-profile'
import { insertProject, type ProjectRecord } from './records'
import { projectDatabaseRelativePath } from './slug'

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('email account records', () => {
  test('round-trips an account and packs last_test into one column', () => {
    const db = appDb()
    insertEmailAccount(db, account({ isDefault: false, replyTo: 'reply@example.com' }))
    expect(getEmailAccount(db, 'acct-1')).toEqual(account({ replyTo: 'reply@example.com' }))
    const stored = db
      .prepare<unknown[], { last_test: string | null; is_default: number }>(
        `SELECT last_test, is_default FROM email_accounts WHERE id = 'acct-1'`
      )
      .get()
    expect(stored).toEqual({ last_test: null, is_default: 1 })

    updateEmailAccount(
      db,
      account({
        replyTo: 'reply@example.com',
        lastTestAt: '2026-10-20T15:04:05.000Z',
        lastTestOk: false,
        lastTestMessage: '535: Gmail needs an App Password',
        lastTestNextStep: 'Fix in Email setup'
      })
    )
    expect(getEmailAccount(db, 'acct-1')).toEqual(
      account({
        replyTo: 'reply@example.com',
        lastTestAt: '2026-10-20T15:04:05.000Z',
        lastTestOk: false,
        lastTestMessage: '535: Gmail needs an App Password',
        lastTestNextStep: 'Fix in Email setup'
      })
    )
    const packed = db
      .prepare<unknown[], { last_test: string }>(
        `SELECT last_test FROM email_accounts WHERE id = 'acct-1'`
      )
      .get()
    expect(JSON.parse(packed?.last_test ?? 'null')).toEqual({
      at: '2026-10-20T15:04:05.000Z',
      ok: false,
      message: '535: Gmail needs an App Password',
      nextStep: 'Fix in Email setup'
    })

    updateEmailAccount(
      db,
      account({
        replyTo: 'reply@example.com',
        lastTestAt: '2026-10-20T16:00:00.000Z',
        lastTestOk: true,
        lastTestMessage: null,
        lastTestNextStep: null
      })
    )
    expect(getEmailAccount(db, 'acct-1')?.lastTestOk).toBe(true)
    expect(getEmailAccount(db, 'acct-1')?.lastTestMessage).toBeNull()
  })

  test('keeps one default and promotes the earliest account on delete', () => {
    const db = appDb()
    insertEmailAccount(db, account())
    insertEmailAccount(db, account({ id: 'acct-2', ...secondAccount, isDefault: false }))
    expect(listEmailAccounts(db).map((row) => [row.id, row.isDefault])).toEqual([
      ['acct-1', true],
      ['acct-2', false]
    ])
    updateEmailAccount(db, account({ id: 'acct-2', ...secondAccount, isDefault: true }))
    expect(getEmailAccount(db, 'acct-1')?.isDefault).toBe(false)
    expect(getEmailAccount(db, 'acct-2')?.isDefault).toBe(true)
    deleteEmailAccount(db, 'acct-2')
    expect(getEmailAccount(db, 'acct-2')).toBeNull()
    expect(getEmailAccount(db, 'acct-1')?.isDefault).toBe(true)
    deleteEmailAccount(db, 'acct-1')
    expect(listEmailAccounts(db)).toEqual([])
    expect(() => deleteEmailAccount(db, 'acct-1')).toThrow(/remove email account/)
    expect(() => updateEmailAccount(db, account())).toThrow(/save email account/)
  })

  test('rejects a bad account, a duplicate keychain ref, and a partial last test', () => {
    const db = appDb()
    insertEmailAccount(db, account())
    expect(() =>
      insertEmailAccount(db, account({ id: 'acct-2', provider: 'icloud' as 'gmail' }))
    ).toThrow(/provider/)
    expect(() => insertEmailAccount(db, account({ id: 'acct-2', port: 0 }))).toThrow(/port/)
    expect(() =>
      insertEmailAccount(db, account({ id: 'acct-2', security: 'tls' as 'starttls' }))
    ).toThrow(/security/)
    expect(() =>
      insertEmailAccount(db, account({ id: 'acct-2', ...secondAccount, keychainRef: 'Not-A-Ref' }))
    ).toThrow(/keychain ref/)
    expect(() =>
      insertEmailAccount(
        db,
        account({ id: 'acct-2', ...secondAccount, keychainRef: 'citefox.smtp.acct-1' })
      )
    ).toThrow(/rejected by the database/)
    expect(() =>
      insertEmailAccount(
        db,
        account({
          id: 'acct-2',
          ...secondAccount,
          keychainRef: 'citefox.smtp.acct-2',
          lastTestAt: null,
          lastTestOk: false,
          lastTestMessage: 'no',
          lastTestNextStep: null
        })
      )
    ).toThrow(/last test/)
    expect(listEmailAccounts(db)).toHaveLength(1)
  })
})

describe('report schedule records', () => {
  test('stores the scope in scope_json; project, empty and all-projects scopes read back null', () => {
    const db = ready()
    insertReportSchedule(
      db,
      schedule({ scope: { kind: 'group', ids: ['grp-1', 'grp-2', 'grp-1'] } })
    )
    expect(getReportSchedule(db, 'sched-1')?.scope).toEqual({
      kind: 'group',
      ids: ['grp-1', 'grp-2']
    })
    updateReportSchedule(db, schedule({ scope: { kind: 'pages', ids: ['page-9'] } }))
    expect(getReportSchedule(db, 'sched-1')?.scope).toEqual({ kind: 'pages', ids: ['page-9'] })
    updateReportSchedule(db, schedule({ scope: { kind: 'project', ids: [] } }))
    expect(getReportSchedule(db, 'sched-1')?.scope).toBeNull()
    updateReportSchedule(db, schedule({ scope: { kind: 'topic', ids: [] } }))
    expect(getReportSchedule(db, 'sched-1')?.scope).toBeNull()
    updateReportSchedule(
      db,
      schedule({ projectId: null, scope: { kind: 'cluster', ids: ['cl-1'] } })
    )
    expect(getReportSchedule(db, 'sched-1')?.scope).toBeNull()
    const raw = db
      .prepare<unknown[], { scope_json: string | null }>(
        `SELECT scope_json FROM report_schedules WHERE id = 'sched-1'`
      )
      .get()
    expect(raw?.scope_json).toBeNull()
    expect(() =>
      updateReportSchedule(
        db,
        schedule({ scope: { kind: 'everything' as 'pages', ids: ['page-1'] } })
      )
    ).toThrow(/report scope/)
    expect(() =>
      updateReportSchedule(db, schedule({ scope: { kind: 'pages', ids: ['bad id!'] } }))
    ).toThrow()
  })

  test('round-trips each timing and updates the row', () => {
    const db = ready()
    const timings: ReportTiming[] = [
      { kind: 'after_check' },
      { kind: 'weekly', day: 1, time: '09:30' },
      { kind: 'monthly', when: 'last', time: '18:00' },
      { kind: 'on_change', scoreDropPoints: 0 }
    ]
    insertReportSchedule(db, schedule({ timing: timings[0]! }))
    expect(getReportSchedule(db, 'sched-1')).toEqual(schedule({ timing: timings[0]! }))
    for (const timing of timings.slice(1)) {
      updateReportSchedule(db, schedule({ timing, summaryStyle: null, projectId: null }))
      const stored = timing.kind === 'on_change' ? { ...timing, events: [...CHANGE_KINDS] } : timing
      expect(getReportSchedule(db, 'sched-1')).toEqual(
        schedule({ timing: stored, summaryStyle: null, projectId: null })
      )
    }
    expect(listReportSchedules(db)).toHaveLength(1)
  })

  test('saves and reads back the on_change events list', () => {
    const db = ready()
    insertReportSchedule(
      db,
      schedule({
        id: 'sched-drop',
        timing: { kind: 'on_change', scoreDropPoints: 5, events: ['score_drop'] }
      })
    )
    expect(getReportSchedule(db, 'sched-drop')?.timing).toEqual({
      kind: 'on_change',
      scoreDropPoints: 5,
      events: ['score_drop']
    })
    updateReportSchedule(
      db,
      schedule({
        id: 'sched-drop',
        timing: { kind: 'on_change', scoreDropPoints: 5, events: ['check_failed', 'score_drop'] }
      })
    )
    expect(getReportSchedule(db, 'sched-drop')?.timing).toEqual({
      kind: 'on_change',
      scoreDropPoints: 5,
      events: ['check_failed', 'score_drop']
    })
    expect(() =>
      insertReportSchedule(
        db,
        schedule({
          id: 'sched-unknown',
          timing: {
            kind: 'on_change',
            scoreDropPoints: 1,
            events: ['not_a_kind' as 'score_drop']
          }
        })
      )
    ).toThrow(/timing/)
    expect(() =>
      insertReportSchedule(
        db,
        schedule({
          id: 'sched-dup',
          timing: { kind: 'on_change', scoreDropPoints: 1, events: ['score_drop', 'score_drop'] }
        })
      )
    ).toThrow(/timing/)
    expect(() =>
      insertReportSchedule(
        db,
        schedule({
          id: 'sched-empty',
          timing: { kind: 'on_change', scoreDropPoints: 1, events: [] }
        })
      )
    ).toThrow(/timing/)
    expect(getReportSchedule(db, 'sched-unknown')).toBeNull()
  })

  test('an old on_change row with no events reads back as every kind', () => {
    const db = ready()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status, created_at
       ) VALUES (
         'sched-old', 'Legacy', 'project-1', '{"kind":"on_change","scoreDropPoints":3}', 'summary',
         '[]', '[]', '[]', 'acct-1', 'UTC', 'Report', NULL, 'active', '2026-04-01T00:00:00.000Z'
       )`
    ).run()
    expect(getReportSchedule(db, 'sched-old')?.timing).toEqual({
      kind: 'on_change',
      scoreDropPoints: 3,
      events: [...CHANGE_KINDS]
    })
    const raw = db
      .prepare<unknown[], { timing_json: string }>(
        `SELECT timing_json FROM report_schedules WHERE id = 'sched-old'`
      )
      .get()
    expect(JSON.parse(raw?.timing_json ?? 'null')).toEqual({
      kind: 'on_change',
      scoreDropPoints: 3
    })
  })

  test('round-trips the ready report a schedule sends; the rival only for Head-to-head', () => {
    const db = ready()
    insertReportSchedule(db, schedule({ report: { kind: 'rival', rival: 'twilio.com' } }))
    expect(getReportSchedule(db, 'sched-1')?.report).toEqual({ kind: 'rival', rival: 'twilio.com' })
    updateReportSchedule(db, schedule({ report: { kind: 'impact', rival: 'twilio.com' } }))
    expect(getReportSchedule(db, 'sched-1')?.report).toEqual({ kind: 'impact', rival: null })
    updateReportSchedule(db, schedule({ report: null }))
    expect(getReportSchedule(db, 'sched-1')?.report).toBeNull()
    expect(() =>
      updateReportSchedule(db, schedule({ report: { kind: 'nope' as 'impact', rival: null } }))
    ).toThrow('Invalid scheduled report')
  })

  test('round-trips createdAt and leaves it unchanged on update', () => {
    const db = ready()
    insertReportSchedule(db, schedule({ createdAt: '2026-04-01T00:00:00.000Z' }))
    expect(getReportSchedule(db, 'sched-1')?.createdAt).toBe('2026-04-01T00:00:00.000Z')
    expect(listReportSchedules(db).map((row) => row.createdAt)).toEqual([
      '2026-04-01T00:00:00.000Z'
    ])
    updateReportSchedule(db, schedule({ name: 'Renamed', createdAt: '2026-05-01T00:00:00.000Z' }))
    expect(getReportSchedule(db, 'sched-1')).toEqual(
      schedule({ name: 'Renamed', createdAt: '2026-04-01T00:00:00.000Z' })
    )
    const stored = db
      .prepare<unknown[], { created_at: string }>(
        `SELECT created_at FROM report_schedules WHERE id = 'sched-1'`
      )
      .get()
    expect(stored?.created_at).toBe('2026-04-01T00:00:00.000Z')
    expect(() =>
      insertReportSchedule(db, schedule({ id: 'sched-bad', createdAt: 'yesterday' }))
    ).toThrow(/timestamp/)
  })

  test('defaults an omitted createdAt to the current UTC time', () => {
    const db = ready()
    const before = new Date().toISOString()
    const omitted: ReportScheduleRecord = schedule({ id: 'sched-now' })
    delete omitted.createdAt
    insertReportSchedule(db, omitted)
    const after = new Date().toISOString()
    const createdAt = getReportSchedule(db, 'sched-now')?.createdAt
    expect(createdAt !== undefined && createdAt >= before && createdAt <= after).toBe(true)
    expect(createdAt).toBe(new Date(createdAt ?? '').toISOString())
  })

  test('rejects a missing project, a missing account, and a bad schedule', () => {
    const db = appDb()
    insertEmailAccount(db, account())
    expect(() => insertReportSchedule(db, schedule())).toThrow(/referenced row is missing/)
    insertProject(db, project())
    expect(() => insertReportSchedule(db, schedule({ accountId: 'acct-missing' }))).toThrow(
      /referenced row is missing/
    )
    expect(() => insertReportSchedule(db, schedule({ format: 'xlsx' as 'pdf' }))).toThrow(/format/)
    expect(() => insertReportSchedule(db, schedule({ timeZone: 'Not/AZone' }))).toThrow(/time zone/)
    expect(() => insertReportSchedule(db, schedule({ status: '' as 'active' }))).toThrow(/status/)
    expect(() => insertReportSchedule(db, schedule({ status: 'retired' as 'active' }))).toThrow(
      /status/
    )
    expect(() =>
      insertReportSchedule(
        db,
        schedule({
          timing: { kind: 'weekly', day: 8, time: '08:00' } as unknown as ReportTiming
        })
      )
    ).toThrow(/timing/)
    expect(() =>
      insertReportSchedule(db, schedule({ timing: { kind: 'on_change', scoreDropPoints: -1 } }))
    ).toThrow(/timing/)
    expect(listReportSchedules(db)).toEqual([])
    insertReportSchedule(db, schedule({ status: 'paused' }))
    expect(getReportSchedule(db, 'sched-1')?.status).toBe('paused')
    expect(() => updateReportSchedule(db, schedule({ id: 'sched-missing' }))).toThrow(
      /save report schedule/
    )
    expect(() => deleteReportSchedule(db, 'sched-missing')).toThrow(/remove report schedule/)
  })
})

describe('delivery records', () => {
  test('round-trips a send and lists by time', () => {
    const db = ready()
    insertReportSchedule(db, schedule())
    insertDelivery(
      db,
      delivery({
        id: 'del-2',
        at: '2026-10-21T00:00:00.000Z',
        ok: false,
        outcome: 'failed',
        error: 'Connection refused.'
      })
    )
    insertDelivery(db, delivery())
    expect(getDelivery(db, 'del-1')).toEqual(delivery())
    expect(listDeliveries(db).map((row) => row.id)).toEqual(['del-1', 'del-2'])
    insertDelivery(
      db,
      delivery({
        id: 'del-3',
        scheduleId: null,
        projectId: null,
        trigger: 'account_test',
        at: '2026-10-19T00:00:00.000Z',
        recipients: []
      })
    )
    expect(getDelivery(db, 'del-3')?.scheduleId).toBeNull()
    deleteDelivery(db, 'del-1')
    expect(getDelivery(db, 'del-1')).toBeNull()
    expect(() => deleteDelivery(db, 'del-1')).toThrow(/remove delivery/)
    expect(() =>
      insertDelivery(
        db,
        delivery({ id: 'del-4', trigger: 'nope' as EmailDeliveryRecord['trigger'] })
      )
    ).toThrow(/trigger/)
    expect(() =>
      insertDelivery(db, delivery({ id: 'del-4', scheduleId: 'sched-missing' }))
    ).toThrow(/referenced row is missing/)
    expect(() =>
      insertDelivery(
        db,
        delivery({ id: 'del-4', outcome: 'queued' as EmailDeliveryRecord['outcome'] })
      )
    ).toThrow(/outcome/)
  })

  test('stores a draft and rejects ok that disagrees with outcome', () => {
    const db = ready()
    insertReportSchedule(db, schedule())
    const draft = delivery({ id: 'del-draft', ok: false, outcome: 'draft' })
    insertDelivery(db, draft)
    expect(getDelivery(db, 'del-draft')).toEqual(draft)
    expect(() =>
      insertDelivery(db, delivery({ id: 'del-mismatch', ok: true, outcome: 'draft' }))
    ).toThrow(/match outcome/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-sql-mismatch', 'sched-1', '2026-10-20T12:00:00.000Z', 'monthly', 'project-1',
             '[]', 1, NULL, 'draft', NULL)`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    expect(getDelivery(db, 'del-sql-mismatch')).toBeNull()
  })

  test('rejects a duplicate occurrence key and allows two null keys', () => {
    const db = ready()
    insertReportSchedule(db, schedule())
    insertDelivery(db, delivery({ id: 'del-key', occurrenceKey: 'after:sched-1:check-1' }))
    expect(getDelivery(db, 'del-key')?.occurrenceKey).toBe('after:sched-1:check-1')
    expect(() =>
      insertDelivery(
        db,
        delivery({
          id: 'del-key-2',
          at: '2026-10-20T13:00:00.000Z',
          occurrenceKey: 'after:sched-1:check-1'
        })
      )
    ).toThrow(/rejected by the database/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-sql-dup', 'sched-1', '2026-10-20T14:00:00.000Z', 'monthly', 'project-1',
             '[]', 1, NULL, 'sent', 'after:sched-1:check-1')`
        )
        .run()
    ).toThrow(/UNIQUE/)
    insertDelivery(
      db,
      delivery({ id: 'del-null-a', at: '2026-10-20T15:00:00.000Z', occurrenceKey: null })
    )
    insertDelivery(
      db,
      delivery({ id: 'del-null-b', at: '2026-10-20T16:00:00.000Z', occurrenceKey: null })
    )
    expect(listDeliveries(db).filter((row) => row.occurrenceKey === null)).toHaveLength(2)
  })

  test('round-trips nextStep, including null', () => {
    const db = ready()
    insertReportSchedule(db, schedule())
    insertDelivery(db, delivery({ nextStep: 'Fix in Email setup' }))
    expect(getDelivery(db, 'del-1')).toEqual(delivery({ nextStep: 'Fix in Email setup' }))
    expect(listDeliveries(db)[0]?.nextStep).toBe('Fix in Email setup')
    insertDelivery(db, delivery({ id: 'del-null', at: '2026-10-20T13:00:00.000Z', nextStep: null }))
    expect(getDelivery(db, 'del-null')).toEqual(
      delivery({ id: 'del-null', at: '2026-10-20T13:00:00.000Z', nextStep: null })
    )
    const stored = db
      .prepare<unknown[], { next_step: string | null }>(
        `SELECT next_step FROM deliveries WHERE id = 'del-null'`
      )
      .get()
    expect(stored?.next_step).toBeNull()
    const omitted = delivery({ id: 'del-omit', at: '2026-10-20T14:00:00.000Z' })
    delete omitted.nextStep
    insertDelivery(db, omitted)
    expect(getDelivery(db, 'del-omit')?.nextStep).toBeNull()
  })

  test('dedupes a schedule-less occurrence key and keeps the scheduled index', () => {
    const db = ready()
    insertReportSchedule(db, schedule())
    insertReportSchedule(db, schedule({ id: 'sched-2', name: 'Weekly' }))
    const key = 'slack:project-1:check-1'
    insertDelivery(
      db,
      delivery({
        id: 'del-slack',
        scheduleId: null,
        trigger: 'slack',
        occurrenceKey: key
      })
    )
    let uniqueHit: unknown
    try {
      insertDelivery(
        db,
        delivery({
          id: 'del-slack-2',
          scheduleId: null,
          trigger: 'check_summary',
          at: '2026-10-20T13:00:00.000Z',
          occurrenceKey: key
        })
      )
    } catch (error) {
      uniqueHit = error
    }
    expect(uniqueHit).toBeInstanceOf(Error)
    expect((uniqueHit as Error).message).toMatch(/rejected by the database/)
    expect(isUniqueConstraintError(uniqueHit)).toBe(true)
    let rawHit: unknown
    try {
      db.prepare(
        `INSERT INTO deliveries (
           id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
         ) VALUES ('del-slack-sql', NULL, '2026-10-20T13:30:00.000Z', 'cap', 'project-1',
           '[]', 1, NULL, 'sent', ?)`
      ).run(key)
    } catch (error) {
      rawHit = error
    }
    expect(rawHit).toBeInstanceOf(Error)
    expect((rawHit as Error).message).toMatch(/UNIQUE/)
    expect(isUniqueConstraintError(rawHit)).toBe(true)

    insertDelivery(
      db,
      delivery({
        id: 'del-sched-a',
        scheduleId: 'sched-1',
        at: '2026-10-20T14:00:00.000Z',
        occurrenceKey: key
      })
    )
    insertDelivery(
      db,
      delivery({
        id: 'del-sched-b',
        scheduleId: 'sched-2',
        trigger: 'weekly',
        at: '2026-10-20T15:00:00.000Z',
        occurrenceKey: key
      })
    )
    expect(() =>
      insertDelivery(
        db,
        delivery({
          id: 'del-sched-dup',
          scheduleId: 'sched-1',
          at: '2026-10-20T16:00:00.000Z',
          occurrenceKey: key
        })
      )
    ).toThrow(/rejected by the database/)

    insertDelivery(
      db,
      delivery({
        id: 'del-open-a',
        scheduleId: null,
        trigger: 'monthly_pdf',
        at: '2026-10-20T17:00:00.000Z',
        occurrenceKey: null
      })
    )
    insertDelivery(
      db,
      delivery({
        id: 'del-open-b',
        scheduleId: null,
        trigger: 'cap',
        at: '2026-10-20T18:00:00.000Z',
        occurrenceKey: null
      })
    )
    expect(listDeliveries(db).filter((row) => row.occurrenceKey === null).length).toBeGreaterThan(1)

    let checkHit: unknown
    try {
      db.prepare(`UPDATE email_accounts SET port = 0 WHERE id = 'acct-1'`).run()
    } catch (error) {
      checkHit = error
    }
    expect(isUniqueConstraintError(checkHit)).toBe(false)
    expect(isUniqueConstraintError(new Error('rejected by the database'))).toBe(false)
  })

  test('SQL rejects a bad trigger, status, format, and outcome, and defaults status to active', () => {
    const db = ready()
    expect(() =>
      db
        .prepare(
          `INSERT INTO report_schedules (
             id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
             time_zone, subject, summary_style, status, created_at
           ) VALUES ('sched-bad-format', 'Monthly', 'project-1', '{"kind":"after_check"}', 'xlsx',
             '[]', '[]', '[]', 'acct-1', 'UTC', 'Report', NULL, 'active', '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO report_schedules (
             id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
             time_zone, subject, summary_style, status, created_at
           ) VALUES ('sched-bad-status', 'Monthly', 'project-1', '{"kind":"after_check"}', 'pdf',
             '[]', '[]', '[]', 'acct-1', 'UTC', 'Report', NULL, 'retired', '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, created_at
       ) VALUES ('sched-default', 'Weekly', 'project-1', '{"kind":"after_check"}', 'summary',
         '[]', '[]', '[]', NULL, 'UTC', 'Report', NULL, '2026-04-01T00:00:00.000Z')`
    ).run()
    expect(
      db
        .prepare<unknown[], { status: string }>(
          `SELECT status FROM report_schedules WHERE id = 'sched-default'`
        )
        .get()?.status
    ).toBe('active')
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-bad-trigger', 'sched-default', '2026-10-20T12:00:00.000Z', 'nope',
             'project-1', '[]', 1, NULL, 'sent', NULL)`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-bad-outcome', 'sched-default', '2026-10-20T12:00:00.000Z', 'weekly',
             'project-1', '[]', 0, NULL, 'queued', NULL)`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
  })
})

describe('project and page removal', () => {
  test('drops a project’s schedules and deliveries and keeps the others', () => {
    const db = appDb()
    insertProject(db, project())
    insertProject(db, project('project-2', 'northwind', 'Northwind'))
    insertEmailAccount(db, account())
    insertReportSchedule(db, schedule())
    insertReportSchedule(
      db,
      schedule({
        id: 'sched-all',
        name: 'All projects',
        projectId: null,
        accountId: null
      })
    )
    insertReportSchedule(db, schedule({ id: 'sched-2', name: 'Other', projectId: 'project-2' }))
    insertDelivery(db, delivery())
    insertDelivery(
      db,
      delivery({
        id: 'del-all',
        scheduleId: 'sched-all',
        projectId: null,
        at: '2026-10-20T13:00:00.000Z'
      })
    )
    insertDelivery(
      db,
      delivery({
        id: 'del-2',
        scheduleId: 'sched-2',
        projectId: 'project-2',
        at: '2026-10-20T14:00:00.000Z'
      })
    )
    db.prepare(`DELETE FROM projects WHERE id = 'project-1'`).run()
    expect(listReportSchedules(db).map((row) => row.id)).toEqual(['sched-all', 'sched-2'])
    expect(listDeliveries(db).map((row) => row.id)).toEqual(['del-all', 'del-2'])
    expect(getEmailAccount(db, 'acct-1')?.id).toBe('acct-1')

    deleteEmailAccount(db, 'acct-1')
    expect(getReportSchedule(db, 'sched-2')?.accountId).toBeNull()

    deleteReportSchedule(db, 'sched-all')
    expect(getDelivery(db, 'del-all')).toEqual(
      delivery({
        id: 'del-all',
        scheduleId: null,
        projectId: null,
        at: '2026-10-20T13:00:00.000Z'
      })
    )
  })

  test('page removal does not touch email rows', () => {
    const db = appDb()
    for (const table of ['email_accounts', 'report_schedules', 'deliveries']) {
      const names = db
        .prepare<unknown[], { name: string }>(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => column.name)
      expect(names).not.toContain('page_id')
    }
    insertProject(db, project())
    insertEmailAccount(db, account())
    insertReportSchedule(db, schedule({ accountId: null, marketIds: [] }))
    insertDelivery(db, delivery({ scheduleId: null }))
    const pages = track(openSqliteDatabase(':memory:'))
    ensureProjectSchema(pages)
    writeProjectProfile(pages, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: [],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    const page = samplePage()
    insertPage(pages, page)
    setPageStatus(pages, page.id, 'removed', page.projectId)
    expect(listEmailAccounts(db)).toHaveLength(1)
    expect(listReportSchedules(db)).toHaveLength(1)
    expect(listDeliveries(db)).toHaveLength(1)
  })
})

describe('email secrets', () => {
  test('rejects secrets in reference and text fields and redacts them in logs', () => {
    const db = appDb()
    const anthropic = `sk-ant-${'abcdefghij1234'}`
    const password = 'smtp_password=hunter2-not-stored'
    const slack = 'https://hooks.slack.com/services/T00/B00/secret'
    expect(() => insertEmailAccount(db, account({ keychainRef: 'a'.repeat(64) }))).toThrow(/secret/)
    expect(() => insertEmailAccount(db, account({ keychainRef: anthropic }))).toThrow(/secret/)
    expect(() => insertEmailAccount(db, account({ id: anthropic }))).toThrow(/secret/)
    let rejected: unknown
    try {
      insertEmailAccount(db, account({ fromName: password }))
    } catch (error) {
      rejected = error
    }
    expect(rejected).toBeInstanceOf(Error)
    expect((rejected as Error).message).toMatch(/secret/)
    expect((rejected as Error).message).not.toContain('hunter2')
    expect((rejected as Error).message).not.toContain(password)
    expect(() =>
      insertEmailAccount(
        db,
        account({
          lastTestAt: '2026-10-20T15:04:05.000Z',
          lastTestOk: false,
          lastTestMessage: anthropic,
          lastTestNextStep: null
        })
      )
    ).toThrow(/secret/)
    insertProject(db, project())
    insertEmailAccount(db, account())
    expect(() => insertReportSchedule(db, schedule({ subject: `Bearer ${anthropic}` }))).toThrow(
      /secret/
    )
    insertReportSchedule(db, schedule())
    expect(() => insertDelivery(db, delivery({ error: slack }))).toThrow(/secret/)
    expect(listEmailAccounts(db)).toHaveLength(1)
    expect(listDeliveries(db)).toEqual([])

    const directory = mkdtempSync(join(tmpdir(), 'citefox-email-'))
    directories.push(directory)
    const file = track(openAppDatabase(join(directory, 'app.sqlite')))
    insertProject(file, project())
    insertEmailAccount(file, account())
    closeDatabase(file)
    const dumped = readFileSync(join(directory, 'app.sqlite'))
    expect(dumped.includes(password)).toBe(false)
    expect(dumped.includes(anthropic)).toBe(false)
    expect(dumped.includes('citefox.smtp.acct-1')).toBe(true)

    const lines: string[] = []
    const logger = createLogger({
      write: (_level, line) => lines.push(line),
      secrets: () => [password, anthropic]
    })
    logger.error(`smtp send failed ${password}`, new Error(anthropic))
    const log = lines.join('\n')
    expect(log).not.toContain('hunter2')
    expect(log).not.toContain(anthropic)
    expect(log).toContain('[REDACTED]')
  })
})

const secondAccount = {
  fromAddress: 'other@example.com',
  username: 'other@example.com',
  keychainRef: 'citefox.smtp.acct-2'
} as const

function appDb(): SqliteDatabase {
  return track(openAppDatabase(':memory:'))
}

function ready(): SqliteDatabase {
  const db = appDb()
  insertProject(db, project())
  insertEmailAccount(db, account())
  return db
}

function track(db: SqliteDatabase): SqliteDatabase {
  databases.push(db)
  return db
}

function project(id = 'project-1', slug = 'textbolt', name = 'TextBolt'): ProjectRecord {
  return {
    id,
    name,
    slug,
    domain: `${slug}.example`,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  }
}

function account(overrides: Partial<EmailAccountRecord> = {}): EmailAccountRecord {
  return {
    id: 'acct-1',
    provider: 'gmail',
    fromName: 'CiteFox',
    fromAddress: 'reports@example.com',
    replyTo: null,
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    username: 'reports@example.com',
    keychainRef: 'citefox.smtp.acct-1',
    isDefault: true,
    lastTestAt: null,
    lastTestOk: null,
    lastTestMessage: null,
    lastTestNextStep: null,
    ...overrides
  }
}

function schedule(overrides: Partial<ReportScheduleRecord> = {}): ReportScheduleRecord {
  return {
    id: 'sched-1',
    name: 'Monthly client',
    projectId: 'project-1',
    timing: { kind: 'monthly', when: '1', time: '08:00' },
    format: 'pdf',
    sections: ['results', 'gaps'],
    marketIds: ['mkt-us'],
    recipients: ['client@example.com'],
    accountId: 'acct-1',
    timeZone: 'America/New_York',
    subject: '{project} {date_range} {market} {score}',
    summaryStyle: 'client_friendly',
    status: 'active',
    scope: null,
    report: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    ...overrides
  }
}

function delivery(overrides: Partial<EmailDeliveryRecord> = {}): EmailDeliveryRecord {
  return {
    id: 'del-1',
    scheduleId: 'sched-1',
    at: '2026-10-20T12:00:00.000Z',
    trigger: 'monthly',
    projectId: 'project-1',
    recipients: ['client@example.com'],
    ok: true,
    error: null,
    outcome: 'sent',
    occurrenceKey: null,
    nextStep: null,
    ...overrides
  }
}

function samplePage(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'project-1',
    url: 'https://textbolt.example/alerts',
    title: null,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}
