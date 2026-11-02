import { afterEach, describe, expect, test } from 'vitest'
import { APP_MIGRATIONS } from './app-schema'
import { PROJECT_MIGRATIONS } from './project-schema'
import { openSqliteDatabase } from './database'
import { getDelivery, getReportSchedule } from './email-records'
import { migrate } from './migrate'
import {
  applied,
  checkClauses,
  closeTracked,
  column,
  columns,
  foreignKeys,
  indexSql,
  tableNames,
  tableSql,
  track
} from './migrate.test-helper'

/** App database upgrades for migrations 012 through 015. */

afterEach(() => {
  closeTracked()
})

describe('app migrations', () => {
  test('backfills created_at and adds next_step without dropping schedule constraints', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 11))
    expect(columns(db, 'report_schedules').map((column) => column.name)).not.toContain('created_at')
    expect(columns(db, 'deliveries').map((column) => column.name)).not.toContain('next_step')
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-2', 'Other', 'other', 'other.example', 'projects/other.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO email_accounts (
         id, provider, from_name, from_address, reply_to, host, port, security, username,
         keychain_ref, is_default, last_test
       ) VALUES ('acct-1', 'gmail', 'CiteFox', 'a@example.com', NULL, 'smtp.gmail.com', 587,
         'starttls', 'a@example.com', 'citefox.smtp.acct-1', 1, NULL)`
    ).run()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status
       ) VALUES ('sched-1', 'Monthly', 'project-1', '{"kind":"after_check"}', 'pdf', '["results"]',
         '["mkt-us"]', '["a@example.com"]', 'acct-1', 'UTC', 'Report', 'standard', 'active')`
    ).run()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status
       ) VALUES ('sched-2', 'Weekly', 'project-1', '{"kind":"after_check"}', 'summary', '[]', '[]',
         '[]', NULL, 'America/New_York', 'Other', NULL, 'paused')`
    ).run()
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
       ) VALUES ('del-1', 'sched-1', '2026-10-20T12:00:00.000Z', 'monthly', 'project-1', '[]', 1,
         NULL, 'sent', 'monthly:sched-1:2026-10')`
    ).run()
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
       ) VALUES ('del-open', NULL, '2026-10-20T12:30:00.000Z', 'slack', 'project-1', '[]', 0,
         'nope', 'failed', 'slack:project-1:check-1')`
    ).run()

    const scheduleChecks = checkClauses(tableSql(db, 'report_schedules'))
    const deliveryChecks = checkClauses(tableSql(db, 'deliveries'))
    const scheduleForeignKeys = foreignKeys(db, 'report_schedules')
    const deliveryForeignKeys = foreignKeys(db, 'deliveries')
    const scheduleIndexes = indexSql(db, 'report_schedules')
    const deliveryIndexes = indexSql(db, 'deliveries')
    expect(scheduleIndexes.map((index) => index.name)).toContain('idx_report_schedules_project')
    expect(deliveryIndexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['idx_deliveries_occurrence', 'idx_deliveries_unscheduled_occurrence'])
    )

    const before = new Date().toISOString()
    migrate(db, APP_MIGRATIONS)
    const after = new Date().toISOString()

    expect(applied(db)).toContainEqual({
      version: 12,
      name: '012_schedule_created_at_delivery_next_step'
    })
    expect(column(db, 'report_schedules', 'created_at')?.notnull).toBe(1)
    expect(column(db, 'report_schedules', 'created_at')?.dflt_value).toBe(
      "'1970-01-01T00:00:00.000Z'"
    )
    expect(column(db, 'report_schedules', 'status')?.dflt_value).toBe("'active'")
    expect(column(db, 'deliveries', 'next_step')?.notnull).toBe(0)
    expect(column(db, 'deliveries', 'next_step')?.dflt_value).toBeNull()

    const stamped = db
      .prepare<unknown[], { id: string; created_at: string }>(
        `SELECT id, created_at FROM report_schedules ORDER BY id`
      )
      .all()
    expect(stamped.map((row) => row.id)).toEqual(['sched-1', 'sched-2'])
    const createdAt = stamped[0]?.created_at
    expect(createdAt).toBe(stamped[1]?.created_at)
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(createdAt ?? '').toISOString()).toBe(createdAt)
    expect(createdAt !== undefined && createdAt >= before && createdAt <= after).toBe(true)
    expect(getReportSchedule(db, 'sched-1')?.createdAt).toBe(createdAt)
    expect(getReportSchedule(db, 'sched-2')?.createdAt).toBe(createdAt)
    expect(getDelivery(db, 'del-1')).toMatchObject({
      scheduleId: 'sched-1',
      nextStep: null,
      occurrenceKey: 'monthly:sched-1:2026-10'
    })
    expect(getDelivery(db, 'del-open')?.nextStep).toBeNull()

    const scheduleChecksAfter = checkClauses(tableSql(db, 'report_schedules'))
    for (const check of scheduleChecks) expect(scheduleChecksAfter).toContain(check)
    expect(scheduleChecksAfter).toContain('CHECK (length(created_at) > 0)')
    expect(checkClauses(tableSql(db, 'deliveries'))).toEqual(deliveryChecks)
    expect(foreignKeys(db, 'report_schedules')).toEqual(scheduleForeignKeys)
    expect(foreignKeys(db, 'deliveries')).toEqual(deliveryForeignKeys)
    expect(indexSql(db, 'report_schedules')).toEqual(scheduleIndexes)
    expect(indexSql(db, 'deliveries')).toEqual(deliveryIndexes)

    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status
       ) VALUES ('sched-default-time', 'Monthly', 'project-1', '{"kind":"after_check"}', 'pdf',
         '[]', '[]', '[]', NULL, 'UTC', 'Report', NULL, 'active')`
    ).run()
    expect(
      db
        .prepare<unknown[], { created_at: string }>(
          `SELECT created_at FROM report_schedules WHERE id = 'sched-default-time'`
        )
        .get()?.created_at
    ).toBe('1970-01-01T00:00:00.000Z')
    expect(() =>
      db.prepare(`UPDATE report_schedules SET created_at = NULL WHERE id = 'sched-1'`).run()
    ).toThrow(/NOT NULL/)
    expect(() =>
      db.prepare(`UPDATE report_schedules SET created_at = '' WHERE id = 'sched-1'`).run()
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO report_schedules (
             id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
             time_zone, subject, summary_style, status, created_at
           ) VALUES ('sched-bad-format', 'Monthly', 'project-1', '{"kind":"after_check"}', 'xlsx',
             '[]', '[]', '[]', NULL, 'UTC', 'Report', NULL, 'active', '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO report_schedules (
             id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
             time_zone, subject, summary_style, status, created_at
           ) VALUES ('sched-bad-status', 'Monthly', 'project-1', '{"kind":"after_check"}', 'pdf',
             '[]', '[]', '[]', NULL, 'UTC', 'Report', NULL, 'retired', '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome,
             occurrence_key, next_step
           ) VALUES ('del-mismatch', 'sched-2', '2026-10-20T13:00:00.000Z', 'weekly', 'project-1',
             '[]', 1, NULL, 'draft', NULL, NULL)`
        )
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-bad-trigger', 'sched-2', '2026-10-20T13:00:00.000Z', 'nope', 'project-1',
             '[]', 1, NULL, 'sent', NULL)`
        )
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-dup', 'sched-1', '2026-10-20T14:00:00.000Z', 'monthly', 'project-1', '[]',
             1, NULL, 'sent', 'monthly:sched-1:2026-10')`
        )
        .run()
    ).toThrow(/UNIQUE/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-open-dup', NULL, '2026-10-20T14:30:00.000Z', 'cap', 'project-1', '[]', 1,
             NULL, 'sent', 'slack:project-1:check-1')`
        )
        .run()
    ).toThrow(/UNIQUE/)
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
       ) VALUES ('del-other-schedule', 'sched-2', '2026-10-20T15:00:00.000Z', 'weekly', 'project-1',
         '[]', 1, NULL, 'sent', 'monthly:sched-1:2026-10')`
    ).run()

    db.prepare(`DELETE FROM email_accounts WHERE id = 'acct-1'`).run()
    expect(
      db
        .prepare<unknown[], { account_id: string | null }>(
          `SELECT account_id FROM report_schedules WHERE id = 'sched-1'`
        )
        .get()?.account_id
    ).toBeNull()
    db.prepare(`DELETE FROM report_schedules WHERE id = 'sched-1'`).run()
    expect(getDelivery(db, 'del-1')?.scheduleId).toBeNull()

    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status, created_at
       ) VALUES ('sched-3', 'Other project', 'project-2', '{"kind":"after_check"}', 'pdf', '[]',
         '[]', '[]', NULL, 'UTC', 'Report', NULL, 'active', '2026-04-01T00:00:00.000Z')`
    ).run()
    db.prepare(`DELETE FROM projects WHERE id = 'project-2'`).run()
    expect(
      db
        .prepare<unknown[], { id: string }>(`SELECT id FROM report_schedules WHERE id = 'sched-3'`)
        .get()
    ).toBeUndefined()
    expect(getReportSchedule(db, 'sched-2')?.id).toBe('sched-2')
  })

  test('keeps both schedules and their deliveries when they share an occurrence key', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 11))
    const sharedKey = 'after:check-1'
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status
       ) VALUES ('sched-a', 'Monthly', NULL, '{"kind":"after_check"}', 'pdf', '["results"]',
         '["mkt-us"]', '["a@example.com"]', NULL, 'UTC', 'Report', 'standard', 'active')`
    ).run()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status
       ) VALUES ('sched-b', 'Weekly', NULL, '{"kind":"weekly"}', 'summary', '[]', '[]', '[]',
         NULL, 'America/New_York', 'Other', NULL, 'paused')`
    ).run()
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
       ) VALUES ('del-a', 'sched-a', '2026-10-20T12:00:00.000Z', 'after_check', NULL, '[]', 1,
         NULL, 'sent', ?)`
    ).run(sharedKey)
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
       ) VALUES ('del-b', 'sched-b', '2026-10-20T13:00:00.000Z', 'weekly', NULL, '[]', 0,
         'nope', 'failed', ?)`
    ).run(sharedKey)
    const schedulesBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules ORDER BY id`)
      .all()
    const deliveriesBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM deliveries ORDER BY id`)
      .all()
    const before = new Date().toISOString()
    migrate(db, APP_MIGRATIONS)
    const after = new Date().toISOString()
    const schedulesAfter = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules ORDER BY id`)
      .all()
    const deliveriesAfter = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM deliveries ORDER BY id`)
      .all()
    expect(schedulesAfter.map((row) => row.id)).toEqual(['sched-a', 'sched-b'])
    expect(deliveriesAfter.map((row) => row.id)).toEqual(['del-a', 'del-b'])
    for (const [index, original] of schedulesBefore.entries()) {
      const stored = schedulesAfter[index]
      expect(stored).toBeDefined()
      for (const [column, value] of Object.entries(original)) {
        expect(stored?.[column]).toBe(value)
      }
      const createdAt = stored?.created_at
      if (typeof createdAt !== 'string') throw new Error('created_at missing')
      expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(createdAt >= before && createdAt <= after).toBe(true)
      expect(createdAt).not.toBe('1970-01-01T00:00:00.000Z')
    }
    expect(schedulesAfter[0]?.created_at).toBe(schedulesAfter[1]?.created_at)
    for (const [index, original] of deliveriesBefore.entries()) {
      const stored = deliveriesAfter[index]
      expect(stored).toBeDefined()
      for (const [column, value] of Object.entries(original)) {
        expect(stored?.[column]).toBe(value)
      }
      expect(stored?.next_step).toBeNull()
    }
    expect(deliveriesAfter.map((row) => [row.schedule_id, row.occurrence_key])).toEqual([
      ['sched-a', sharedKey],
      ['sched-b', sharedKey]
    ])
  })

  test('applies 013_report_schedules_soft_delete in order and keeps schedules and deliveries', () => {
    expect(PROJECT_MIGRATIONS.map((item) => item.name)).toContain('015_check_query_indexes')
    expect(PROJECT_MIGRATIONS.map((item) => item.version)).toEqual(
      PROJECT_MIGRATIONS.map((_, index) => index + 1)
    )
    expect(PROJECT_MIGRATIONS.map((item) => item.name)).not.toContain(
      '013_report_schedules_soft_delete'
    )
    const registered = APP_MIGRATIONS.map((item) => ({ version: item.version, name: item.name }))
    expect(registered[11]).toEqual({
      version: 12,
      name: '012_schedule_created_at_delivery_next_step'
    })
    expect(registered[12]).toEqual({
      version: 13,
      name: '013_report_schedules_soft_delete'
    })
    expect(registered[13]).toEqual({
      version: 14,
      name: '014_api_keys_multi'
    })
    expect(registered[14]).toEqual({
      version: 15,
      name: '015_api_keys_plan'
    })

    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 12))
    expect(applied(db).at(-1)).toEqual({
      version: 12,
      name: '012_schedule_created_at_delivery_next_step'
    })
    expect(columns(db, 'report_schedules').map((column) => column.name)).not.toContain('deleted_at')
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO email_accounts (
         id, provider, from_name, from_address, reply_to, host, port, security, username,
         keychain_ref, is_default, last_test
       ) VALUES ('acct-1', 'gmail', 'CiteFox', 'a@example.com', NULL, 'smtp.gmail.com', 587,
         'starttls', 'a@example.com', 'citefox.smtp.acct-1', 1, NULL)`
    ).run()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status, created_at
       ) VALUES ('sched-1', 'Monthly', 'project-1', '{"kind":"after_check"}', 'pdf', '["results"]',
         '["mkt-us"]', '["a@example.com"]', 'acct-1', 'UTC', 'Report', 'standard', 'active',
         '2026-04-01T00:00:00.000Z')`
    ).run()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status, created_at
       ) VALUES ('sched-2', 'Weekly', NULL, '{"kind":"after_check"}', 'summary', '[]', '[]', '[]',
         NULL, 'America/New_York', 'Other', NULL, 'paused', '2026-04-02T00:00:00.000Z')`
    ).run()
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key,
         next_step
       ) VALUES ('del-1', 'sched-1', '2026-10-20T12:00:00.000Z', 'monthly', 'project-1',
         '["a@example.com"]', 1, NULL, 'sent', 'monthly:sched-1:2026-10', NULL)`
    ).run()
    db.prepare(
      `INSERT INTO deliveries (
         id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key,
         next_step
       ) VALUES ('del-2', 'sched-2', '2026-10-20T13:00:00.000Z', 'weekly', NULL, '[]', 0, 'nope',
         'failed', NULL, 'Retry later')`
    ).run()

    const schedulesBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules ORDER BY id`)
      .all()
    const deliveriesBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM deliveries ORDER BY id`)
      .all()
    const scheduleForeignKeys = foreignKeys(db, 'report_schedules')
    const deliveryForeignKeys = foreignKeys(db, 'deliveries')
    const deliveryColumns = columns(db, 'deliveries').map((column) => column.name)

    migrate(db, APP_MIGRATIONS)

    expect(applied(db).slice(11)).toEqual([
      { version: 12, name: '012_schedule_created_at_delivery_next_step' },
      { version: 13, name: '013_report_schedules_soft_delete' },
      { version: 14, name: '014_api_keys_multi' },
      { version: 15, name: '015_api_keys_plan' },
      { version: 16, name: '016_queue_pause' },
      { version: 17, name: '017_usage_kept_and_project_delete' },
      { version: 18, name: '018_activity_events' },
      { version: 19, name: '019_template_kinds_open' },
      { version: 20, name: '020_template_versions_and_llm_calls' },
      { version: 21, name: '021_notices_and_setup_runner' },
      { version: 22, name: '022_report_schedule_scope' },
      { version: 23, name: '023_cloro_keys' },
      { version: 24, name: '024_codex_connection' },
      { version: 25, name: '025_report_schedule_report' }
    ])
    expect(tableSql(db, 'report_schedules')).toContain('deleted_at TEXT')
    expect(column(db, 'report_schedules', 'deleted_at')?.notnull).toBe(0)
    expect(column(db, 'report_schedules', 'deleted_at')?.dflt_value).toBeNull()
    expect(
      columns(db, 'report_schedules')
        .map((column) => column.name)
        .slice(-3)
    ).toEqual(['deleted_at', 'scope_json', 'report_json'])

    const schedulesAfter = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules ORDER BY id`)
      .all()
    expect(schedulesAfter.map((row) => row.id)).toEqual(['sched-1', 'sched-2'])
    for (const [index, original] of schedulesBefore.entries()) {
      const stored = schedulesAfter[index]
      expect(stored).toBeDefined()
      for (const [name, value] of Object.entries(original)) {
        expect(stored?.[name]).toBe(value)
      }
      expect(stored?.deleted_at).toBeNull()
    }
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM deliveries ORDER BY id`).all()
    ).toEqual(deliveriesBefore)
    expect(columns(db, 'deliveries').map((column) => column.name)).toEqual(deliveryColumns)
    expect(foreignKeys(db, 'report_schedules')).toEqual(scheduleForeignKeys)
    expect(foreignKeys(db, 'deliveries')).toEqual(deliveryForeignKeys)
    expect(getDelivery(db, 'del-1')).toMatchObject({ id: 'del-1', scheduleId: 'sched-1' })
    expect(getDelivery(db, 'del-2')).toMatchObject({ id: 'del-2', scheduleId: 'sched-2' })

    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status, created_at
       ) VALUES ('sched-live', 'Live', NULL, '{"kind":"after_check"}', 'pdf', '[]', '[]', '[]',
         NULL, 'UTC', 'Report', NULL, 'active', '2026-04-03T00:00:00.000Z')`
    ).run()
    expect(
      db
        .prepare<unknown[], { deleted_at: string | null }>(
          `SELECT deleted_at FROM report_schedules WHERE id = 'sched-live'`
        )
        .get()?.deleted_at
    ).toBeNull()

    const schedulesStamped = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules ORDER BY id`)
      .all()
    const deliveriesStamped = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM deliveries ORDER BY id`)
      .all()
    migrate(db, APP_MIGRATIONS)
    expect(applied(db).filter((row) => row.name === '013_report_schedules_soft_delete')).toEqual([
      { version: 13, name: '013_report_schedules_soft_delete' }
    ])
    expect(applied(db).filter((row) => row.name === '014_api_keys_multi')).toEqual([
      { version: 14, name: '014_api_keys_multi' }
    ])
    expect(
      db
        .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules ORDER BY id`)
        .all()
    ).toEqual(schedulesStamped)
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM deliveries ORDER BY id`).all()
    ).toEqual(deliveriesStamped)
  })

  test('014_api_keys_multi keeps a single key and allows another for the same provider', () => {
    expect(APP_MIGRATIONS.find((item) => item.version === 14)).toMatchObject({
      version: 14,
      name: '014_api_keys_multi'
    })
    expect(
      APP_MIGRATIONS.map((item) => item.name).filter((name) => name.startsWith('014_'))
    ).toEqual(['014_api_keys_multi'])
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 13))
    expect(applied(db).at(-1)).toEqual({
      version: 13,
      name: '013_report_schedules_soft_delete'
    })
    expect(tableSql(db, 'api_keys')).toContain('UNIQUE (provider)')
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
         serpapi_used, serpapi_limit, serpapi_plan, last_reason
       ) VALUES (
         'key-1', 'serpapi', 'Primary', 'citefox.serpapi.key-1', 0, 100, 1, '["project-1"]', 'ab12',
         'ok', 12, 250, 'Developer', NULL
       )`
    ).run()
    db.prepare(
      `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
       VALUES ('usage-1', 'key-1', 'project-1', '2026-10', 4, 1, 2)`
    ).run()
    db.prepare(
      `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
       VALUES ('usage-2', 'key-1', NULL, '2026-10', 1, 0, 0)`
    ).run()
    db.prepare(
      `INSERT INTO connection_events (id, key_id, at, kind, detail)
       VALUES ('event-1', 'key-1', '2026-10-20T12:00:00.000Z', 'failover', 'Switched to the next key')`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO api_keys (
             id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state
           ) VALUES (
             'key-2', 'serpapi', 'Second', 'citefox.serpapi.key-2', 1, NULL, 1, '[]', 'cd34', 'unchecked'
           )`
        )
        .run()
    ).toThrow(/UNIQUE/)

    const keysBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`)
      .all()
    const usageBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM key_usage ORDER BY id`)
      .all()
    const eventsBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM connection_events ORDER BY id`)
      .all()

    migrate(db, APP_MIGRATIONS.slice(0, 14))

    expect(applied(db).at(-1)).toEqual({ version: 14, name: '014_api_keys_multi' })
    expect(tableSql(db, 'api_keys')).not.toContain('UNIQUE (provider)')
    expect(tableSql(db, 'api_keys')).toContain('UNIQUE (keychain_ref)')
    expect(columns(db, 'api_keys').map((column) => column.name)).toEqual([
      'id',
      'provider',
      'name',
      'keychain_ref',
      'rotation_order',
      'cap',
      'on',
      'project_ids',
      'hint',
      'state',
      'serpapi_used',
      'serpapi_limit',
      'serpapi_plan',
      'last_reason'
    ])
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`).all()
    ).toEqual(keysBefore)
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM key_usage ORDER BY id`).all()
    ).toEqual(usageBefore)
    expect(
      db
        .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM connection_events ORDER BY id`)
        .all()
    ).toEqual(eventsBefore)
    expect(
      foreignKeys(db, 'key_usage').map((row) => `${row.from}->${row.table}.${row.to}`)
    ).toEqual(['key_id->api_keys.id', 'project_id->projects.id'])
    expect(foreignKeys(db, 'connection_events')).toEqual([
      {
        table: 'api_keys',
        from: 'key_id',
        to: 'id',
        on_update: 'NO ACTION',
        on_delete: 'NO ACTION'
      }
    ])
    const names = columns(db, 'api_keys').map((column) => column.name)
    for (const forbidden of ['secret', 'password', 'token', 'api_key']) {
      expect(names).not.toContain(forbidden)
    }

    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
         serpapi_used, serpapi_limit, serpapi_plan, last_reason
       ) VALUES (
         'key-2', 'serpapi', 'Second', 'citefox.serpapi.key-2', 1, 50, 0, '[]', 'cd34', 'off',
         NULL, NULL, NULL, NULL
       )`
    ).run()
    expect(
      db
        .prepare<unknown[], { id: string; rotation_order: number; enabled: number; cap: number }>(
          `SELECT id, rotation_order, "on" AS enabled, cap FROM api_keys ORDER BY rotation_order`
        )
        .all()
    ).toEqual([
      { id: 'key-1', rotation_order: 0, enabled: 1, cap: 100 },
      { id: 'key-2', rotation_order: 1, enabled: 0, cap: 50 }
    ])
    expect(() =>
      db
        .prepare(
          `INSERT INTO api_keys (
             id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state
           ) VALUES (
             'key-3', 'serpapi', 'Third', 'citefox.serpapi.key-1', 2, NULL, 1, '[]', '', 'unchecked'
           )`
        )
        .run()
    ).toThrow(/UNIQUE/)
    expect(() => db.prepare(`DELETE FROM api_keys WHERE id = 'key-1'`).run()).toThrow(/FOREIGN KEY/)

    const after = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`)
      .all()
    migrate(db, APP_MIGRATIONS.slice(0, 14))
    expect(applied(db).filter((row) => row.name === '014_api_keys_multi')).toEqual([
      { version: 14, name: '014_api_keys_multi' }
    ])
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`).all()
    ).toEqual(after)
    expect(tableNames(db).filter((name) => name.endsWith('_014'))).toEqual([])
  })

  test('015_api_keys_plan adds a nullable user plan and leaves existing rows null', () => {
    expect(APP_MIGRATIONS[14]).toMatchObject({ version: 15, name: '015_api_keys_plan' })
    expect(
      APP_MIGRATIONS.map((item) => item.name).filter((name) => name.startsWith('015_'))
    ).toEqual(['015_api_keys_plan'])
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 14))
    expect(columns(db, 'api_keys').map((column) => column.name)).not.toContain('plan')
    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
         serpapi_used, serpapi_limit, serpapi_plan, last_reason
       ) VALUES (
         'key-1', 'serpapi', 'Primary', 'citefox.serpapi.key-1', 0, 100, 1, '[]', 'ab12', 'ok',
         12, 250, 'Developer', NULL
       )`
    ).run()
    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state
       ) VALUES (
         'key-2', 'jina', 'Reader', 'citefox.jina.key-2', 0, NULL, 1, '[]', 'cd34', 'unchecked'
       )`
    ).run()
    const before = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`)
      .all()

    migrate(db, APP_MIGRATIONS)

    const latest = APP_MIGRATIONS.at(-1)
    expect(applied(db).at(-1)).toEqual({ version: latest?.version, name: latest?.name })
    expect(column(db, 'api_keys', 'plan')?.notnull).toBe(0)
    expect(column(db, 'api_keys', 'plan')?.dflt_value).toBeNull()
    const after = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`)
      .all()
    expect(after.map((row) => row.id)).toEqual(['key-1', 'key-2'])
    for (const [index, original] of before.entries()) {
      const stored = after[index]
      expect(stored).toBeDefined()
      for (const [name, value] of Object.entries(original)) {
        expect(stored?.[name]).toBe(value)
      }
      expect(stored?.plan).toBeNull()
    }
    const names = columns(db, 'api_keys').map((column) => column.name)
    for (const forbidden of ['secret', 'password', 'token', 'api_key']) {
      expect(names).not.toContain(forbidden)
    }

    db.prepare(`UPDATE api_keys SET plan = 'Reader plan' WHERE id = 'key-2'`).run()
    db.prepare(`UPDATE api_keys SET plan = 'Team' WHERE id = 'key-1'`).run()
    expect(
      db
        .prepare<unknown[], { id: string; plan: string | null; serpapi_plan: string | null }>(
          `SELECT id, plan, serpapi_plan FROM api_keys ORDER BY id`
        )
        .all()
    ).toEqual([
      { id: 'key-1', plan: 'Team', serpapi_plan: 'Developer' },
      { id: 'key-2', plan: 'Reader plan', serpapi_plan: null }
    ])

    const stamped = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`)
      .all()
    migrate(db, APP_MIGRATIONS)
    expect(applied(db).filter((row) => row.name === '015_api_keys_plan')).toEqual([
      { version: 15, name: '015_api_keys_plan' }
    ])
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys ORDER BY id`).all()
    ).toEqual(stamped)
  })
})
