import { afterEach, describe, expect, test } from 'vitest'
import { APP_MIGRATIONS, APP_TABLES } from './app-schema'
import { PROJECT_MIGRATIONS } from './project-schema'
import { openSqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, column, columns, tableNames, track } from './migrate.test-helper'

/** App database upgrades for migrations 002 through 011. */

afterEach(() => {
  closeTracked()
})

describe('app migrations', () => {
  test('adds claude_checkups to a database that already has version 1', () => {
    const db = track(openSqliteDatabase(':memory:'))
    const first = APP_MIGRATIONS[0]
    if (first === undefined) throw new Error('missing migration')
    migrate(db, [first])
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    expect(tableNames(db)).not.toContain('claude_checkups')
    migrate(db, APP_MIGRATIONS)
    expect(columns(db, 'claude_checkups').map((column) => column.name)).toEqual([
      'id',
      'ran_at',
      'binary_ok',
      'login_ok',
      'roundtrip_ok',
      'detail_json'
    ])
    expect(applied(db)).toEqual([
      { version: 1, name: '001_app_tables' },
      { version: 2, name: '002_claude_checkups' },
      { version: 3, name: '003_onboarding_finished' },
      { version: 4, name: '004_api_keys_last_reason' },
      { version: 5, name: '005_named_templates' },
      { version: 6, name: '006_active_project' },
      { version: 7, name: '007_tray_history' },
      { version: 8, name: '008_day_pass' },
      { version: 9, name: '009_key_usage_nullable_project' },
      { version: 10, name: '010_email_tables' },
      { version: 11, name: '011_email_mode_throttle_pdfs' },
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
    const projects = db.prepare<unknown[], { id: string }>('SELECT id FROM projects').all()
    expect(projects.map((row) => row.id)).toEqual(['project-1'])
  })

  test('adds nullable last_reason to a database that already has version 3', () => {
    const db = track(openSqliteDatabase(':memory:'))
    const previous = APP_MIGRATIONS.slice(0, 3)
    migrate(db, previous)
    expect(applied(db).map((row) => row.version)).toEqual([1, 2, 3])
    expect(columns(db, 'api_keys').map((column) => column.name)).not.toContain('last_reason')
    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state
       ) VALUES ('key-1', 'serpapi', 'Primary', 'citefox.serpapi.key-1', 0, NULL, 1, '[]', 'ab12', 'warning')`
    ).run()
    migrate(db, APP_MIGRATIONS)
    expect(column(db, 'api_keys', 'last_reason')?.notnull).toBe(0)
    expect(applied(db)).toEqual([
      { version: 1, name: '001_app_tables' },
      { version: 2, name: '002_claude_checkups' },
      { version: 3, name: '003_onboarding_finished' },
      { version: 4, name: '004_api_keys_last_reason' },
      { version: 5, name: '005_named_templates' },
      { version: 6, name: '006_active_project' },
      { version: 7, name: '007_tray_history' },
      { version: 8, name: '008_day_pass' },
      { version: 9, name: '009_key_usage_nullable_project' },
      { version: 10, name: '010_email_tables' },
      { version: 11, name: '011_email_mode_throttle_pdfs' },
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
    const stored = db
      .prepare<unknown[], { state: string; last_reason: string | null }>(
        `SELECT state, last_reason FROM api_keys WHERE id = 'key-1'`
      )
      .get()
    expect(stored).toEqual({ state: 'warning', last_reason: null })
    for (const reason of ['rejected', 'out_of_searches', 'rate_limited', 'timeout', 'other']) {
      db.prepare(`UPDATE api_keys SET last_reason = ? WHERE id = 'key-1'`).run(reason)
      const row = db
        .prepare<unknown[], { last_reason: string }>(
          `SELECT last_reason FROM api_keys WHERE id = 'key-1'`
        )
        .get()
      expect(row?.last_reason).toBe(reason)
    }
    db.prepare(`UPDATE api_keys SET last_reason = NULL WHERE id = 'key-1'`).run()
    expect(() =>
      db.prepare(`UPDATE api_keys SET last_reason = 'nope' WHERE id = 'key-1'`).run()
    ).toThrow(/CHECK constraint failed/)
  })

  test('backfills seeded v4 templates into named rows with one default per kind', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 4))
    const insert = db.prepare(
      `INSERT INTO templates (id, name, version, hash, body, "schema", settings_json)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    )
    insert.run(
      'tpl-buyer-profile',
      'Buyer profile',
      1,
      'a'.repeat(64),
      'Profile {{ url }}',
      JSON.stringify({ kind: 'buyer_profile', keep: true })
    )
    insert.run(
      'tpl-buyer-profile-v2',
      'Buyer profile',
      2,
      'b'.repeat(64),
      'Newer profile {{ url }}',
      JSON.stringify({ kind: 'buyer_profile' })
    )
    insert.run(
      'tpl-buyer-prompts',
      'Buyer prompts',
      1,
      'c'.repeat(64),
      'Prompts {{ prompt_count }}',
      JSON.stringify({ kind: 'buyer_prompts' })
    )
    insert.run(
      'tpl-coverage',
      'Coverage',
      1,
      'd'.repeat(64),
      'Coverage {{ page_text }}',
      JSON.stringify({ kind: 'coverage' })
    )
    migrate(db, APP_MIGRATIONS)
    const rows = db
      .prepare<
        unknown[],
        {
          id: string
          name: string
          kind: string
          is_shipped: number
          is_default: number
          deleted_at: string | null
          settings_json: string | null
          body: string
        }
      >(
        `SELECT id, name, kind, is_shipped, is_default, deleted_at, settings_json, body
         FROM templates ORDER BY id`
      )
      .all()
    expect(rows).toEqual([
      {
        id: 'tpl-buyer-profile',
        name: 'CiteFox default',
        kind: 'buyer_profile',
        is_shipped: 1,
        is_default: 1,
        deleted_at: null,
        settings_json: JSON.stringify({ keep: true }),
        body: 'Profile {{ url }}'
      },
      {
        id: 'tpl-buyer-profile-v2',
        name: 'Buyer profile',
        kind: 'buyer_profile',
        is_shipped: 0,
        is_default: 0,
        deleted_at: null,
        settings_json: null,
        body: 'Newer profile {{ url }}'
      },
      {
        id: 'tpl-buyer-prompts',
        name: 'CiteFox default',
        kind: 'buyer_prompts',
        is_shipped: 1,
        is_default: 1,
        deleted_at: null,
        settings_json: null,
        body: 'Prompts {{ prompt_count }}'
      },
      {
        id: 'tpl-coverage',
        name: 'CiteFox default',
        kind: 'coverage',
        is_shipped: 1,
        is_default: 1,
        deleted_at: null,
        settings_json: null,
        body: 'Coverage {{ page_text }}'
      }
    ])
    expect(column(db, 'templates', 'kind')?.notnull).toBe(1)
    expect(column(db, 'templates', 'name')?.notnull).toBe(1)
    expect(column(db, 'templates', 'deleted_at')?.notnull).toBe(0)
    expect(column(db, 'templates', 'is_default')?.notnull).toBe(1)
    expect(column(db, 'templates', 'is_shipped')?.notnull).toBe(1)
    expect(() =>
      db.prepare(`UPDATE templates SET is_default = 1 WHERE id = 'tpl-buyer-profile-v2'`).run()
    ).toThrow(/UNIQUE/)
    db.prepare(`UPDATE templates SET is_default = 0 WHERE id = 'tpl-buyer-profile'`).run()
    db.prepare(`UPDATE templates SET is_default = 1 WHERE id = 'tpl-buyer-profile-v2'`).run()
    expect(() =>
      db
        .prepare(
          `UPDATE templates SET deleted_at = '2026-10-19T00:00:00.000Z' WHERE id = 'tpl-buyer-profile-v2'`
        )
        .run()
    ).toThrow(/CHECK/)
  })

  test('adds tray history and the day-pass table to a version 6 database', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 6))
    expect(tableNames(db)).not.toContain('tray_history')
    expect(tableNames(db)).not.toContain('day_pass')
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    migrate(db, APP_MIGRATIONS)
    expect(columns(db, 'tray_history').map((column) => column.name)).toEqual([
      'id',
      'project_id',
      'page_id',
      'label',
      'score',
      'change',
      'finished_at'
    ])
    expect(columns(db, 'day_pass').map((column) => column.name)).toEqual([
      'day',
      'job_ids',
      'pages'
    ])
    const projects = db.prepare<unknown[], { id: string }>('SELECT id FROM projects').all()
    expect(projects.map((row) => row.id)).toEqual(['project-1'])
  })

  test('makes key_usage.project_id nullable and keeps existing rows', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 8))
    expect(column(db, 'key_usage', 'project_id')?.notnull).toBe(1)
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state
       ) VALUES ('key-1', 'serpapi', 'Primary', 'citefox.serpapi.key-1', 0, NULL, 1, '[]', 'ab12', 'unchecked')`
    ).run()
    db.prepare(
      `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
       VALUES ('usage-1', 'key-1', 'project-1', '2026-10', 4, 1, 2)`
    ).run()
    migrate(db, APP_MIGRATIONS)
    expect(column(db, 'key_usage', 'project_id')?.notnull).toBe(0)
    expect(applied(db).map((row) => row.name)).toContain('009_key_usage_nullable_project')
    const kept = db
      .prepare<unknown[], { project_id: string; searches: number }>(
        `SELECT project_id, searches FROM key_usage WHERE id = 'usage-1'`
      )
      .get()
    expect(kept).toEqual({ project_id: 'project-1', searches: 4 })
    db.prepare(
      `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
       VALUES ('usage-2', 'key-1', NULL, '2026-10', 2, 0, 0)`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
           VALUES ('usage-3', 'key-1', NULL, '2026-10', 1, 0, 0)`
        )
        .run()
    ).toThrow(/UNIQUE/)
  })

  test('adds the section 10 email tables to a version 9 database', () => {
    expect(PROJECT_MIGRATIONS.map((item) => item.name)).toContain('010_fix_follow_ups')
    expect(PROJECT_MIGRATIONS.map((item) => item.name)).toContain('015_check_query_indexes')
    expect(PROJECT_MIGRATIONS.map((item) => item.version)).toEqual(
      PROJECT_MIGRATIONS.map((_, index) => index + 1)
    )
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 9))
    expect(tableNames(db)).not.toContain('email_accounts')
    expect(tableNames(db)).not.toContain('report_schedules')
    expect(tableNames(db)).not.toContain('deliveries')
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
    ).run()
    migrate(db, APP_MIGRATIONS)
    expect(applied(db).map((row) => row.name)).toContain('010_email_tables')
    const names = APP_TABLES.flatMap((table) => columns(db, table).map((column) => column.name))
    for (const forbidden of ['password', 'secret', 'token', 'webhook', 'authorization']) {
      expect(names).not.toContain(forbidden)
    }
    expect(() =>
      db
        .prepare(
          `INSERT INTO email_accounts (
             id, provider, from_name, from_address, reply_to, host, port, security, username,
             keychain_ref, is_default, last_test
           ) VALUES ('acct-1', 'gmail', 'CiteFox', 'a@example.com', NULL, 'smtp.gmail.com', 0,
             'starttls', 'a@example.com', 'citefox.smtp.acct-1', 1, NULL)`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    db.prepare(
      `INSERT INTO email_accounts (
         id, provider, from_name, from_address, reply_to, host, port, security, username,
         keychain_ref, is_default, last_test
       ) VALUES ('acct-1', 'gmail', 'CiteFox', 'a@example.com', NULL, 'smtp.gmail.com', 587,
         'starttls', 'a@example.com', 'citefox.smtp.acct-1', 1, NULL)`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO email_accounts (
             id, provider, from_name, from_address, reply_to, host, port, security, username,
             keychain_ref, is_default, last_test
           ) VALUES ('acct-2', 'gmail', 'Other', 'b@example.com', NULL, 'smtp.gmail.com', 587,
             'starttls', 'b@example.com', 'citefox.smtp.acct-2', 1, NULL)`
        )
        .run()
    ).toThrow(/UNIQUE/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO report_schedules (
             id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
             time_zone, subject, summary_style, status, created_at
           ) VALUES ('sched-1', 'Monthly', 'project-1', '{"kind":"after_check"}', 'xlsx', '[]', '[]',
             '[]', 'acct-1', 'UTC', 'Report', NULL, 'active', '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, created_at
       ) VALUES ('sched-default', 'Weekly', 'project-1', '{"kind":"after_check"}', 'pdf', '[]', '[]',
         '[]', 'acct-1', 'UTC', 'Report', NULL, '2026-04-01T00:00:00.000Z')`
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
           ) VALUES ('del-mismatch', 'sched-default', '2026-10-20T12:00:00.000Z', 'weekly',
             'project-1', '[]', 1, NULL, 'draft', NULL)`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
    const kept = db.prepare<unknown[], { id: string }>('SELECT id FROM projects').get()
    expect(kept?.id).toBe('project-1')
  })

  test('adds email mode, throttle, pdf index, and the schedule-less occurrence index', () => {
    const previous = track(openSqliteDatabase(':memory:'))
    migrate(previous, APP_MIGRATIONS.slice(0, 10))
    expect(tableNames(previous)).not.toContain('email_mode')
    expect(tableNames(previous)).not.toContain('email_throttle')
    expect(tableNames(previous)).not.toContain('pending_client_pdfs')
    previous
      .prepare(
        `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
         VALUES ('project-1', 'TextBolt', 'textbolt', 'textbolt.example', 'projects/textbolt.sqlite', NULL, 'active')`
      )
      .run()
    previous
      .prepare(
        `INSERT INTO deliveries (
           id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
         ) VALUES ('del-old', NULL, '2026-10-20T12:00:00.000Z', 'slack', 'project-1', '[]', 1, NULL,
           'sent', 'slack:project-1:check-1')`
      )
      .run()
    previous
      .prepare(
        `INSERT INTO deliveries (
           id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
         ) VALUES ('del-old-2', NULL, '2026-10-20T12:30:00.000Z', 'cap', 'project-1', '[]', 1, NULL,
           'sent', 'slack:project-1:check-1')`
      )
      .run()
    const duplicates = previous
      .prepare<unknown[], { n: number }>(
        `SELECT COUNT(*) AS n FROM deliveries WHERE occurrence_key = 'slack:project-1:check-1'`
      )
      .get()
    expect(duplicates?.n).toBe(2)
    migrate(previous, APP_MIGRATIONS)
    const keptDuplicate = previous
      .prepare<unknown[], { id: string; occurrence_key: string | null }>(
        `SELECT id, occurrence_key FROM deliveries ORDER BY rowid`
      )
      .all()
    expect(keptDuplicate).toEqual([
      { id: 'del-old', occurrence_key: 'slack:project-1:check-1' },
      { id: 'del-old-2', occurrence_key: null }
    ])
    expect(() =>
      previous
        .prepare(
          `INSERT INTO deliveries (
             id, schedule_id, at, trigger, project_id, recipients, ok, "error", outcome, occurrence_key
           ) VALUES ('del-old-3', NULL, '2026-10-20T13:00:00.000Z', 'slack', 'project-1', '[]', 1,
             NULL, 'sent', 'slack:project-1:check-1')`
        )
        .run()
    ).toThrow(/UNIQUE/)

    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 10))
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
    migrate(db, APP_MIGRATIONS)
    expect(applied(db).map((row) => row.name)).toContain('011_email_mode_throttle_pdfs')
    expect(columns(db, 'email_mode').map((column) => column.name)).toEqual(['id', 'mode'])
    expect(column(db, 'email_mode', 'mode')?.dflt_value).toContain('smtp')
    expect(
      db.prepare<unknown[], { mode: string }>(`SELECT mode FROM email_mode WHERE id = 1`).get()
        ?.mode
    ).toBe('smtp')
    expect(() => db.prepare(`UPDATE email_mode SET mode = 'imap'`).run()).toThrow(/CHECK/)
    expect(columns(db, 'email_throttle').map((column) => column.name)).toEqual(['key', 'marked_at'])
    expect(columns(db, 'pending_client_pdfs').map((column) => column.name)).toEqual([
      'id',
      'project_id',
      'project_name',
      'due_date',
      'filename',
      'bytes',
      'created_at'
    ])
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_client_pdfs (
             id, project_id, project_name, due_date, filename, bytes, created_at
           ) VALUES ('pdf-bad', 'project-1', 'TextBolt', '04/01/2026', 'client.pdf', 4,
             '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_client_pdfs (
             id, project_id, project_name, due_date, filename, bytes, created_at
           ) VALUES ('pdf-slash', 'project-1', 'TextBolt', '2026-04-01', 'a/b.pdf', 4,
             '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK/)
    const names = APP_TABLES.flatMap((table) => columns(db, table).map((column) => column.name))
    expect(names).not.toContain('webhook')
    const indexes = db
      .prepare<unknown[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'deliveries'`
      )
      .all()
      .map((row) => row.name)
    expect(indexes).toContain('idx_deliveries_occurrence')
    expect(indexes).toContain('idx_deliveries_unscheduled_occurrence')
    const pdfIndexes = db
      .prepare<unknown[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending_client_pdfs'`
      )
      .all()
      .map((row) => row.name)
    expect(pdfIndexes).toContain('idx_pending_client_pdfs_due')
    expect(pdfIndexes).toContain('idx_pending_client_pdfs_project_due')
    db.prepare(
      `INSERT INTO pending_client_pdfs (
         id, project_id, project_name, due_date, filename, bytes, created_at
       ) VALUES ('pdf-1', 'project-1', 'TextBolt', '2026-04-01', 'client.pdf', 4,
         '2026-04-01T00:00:00.000Z')`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_client_pdfs (
             id, project_id, project_name, due_date, filename, bytes, created_at
           ) VALUES ('pdf-2', 'project-1', 'TextBolt', '2026-04-01', 'other.pdf', 4,
             '2026-04-01T00:00:00.000Z')`
        )
        .run()
    ).toThrow(/UNIQUE/)
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-2', 'Other', 'other', 'other.example', 'projects/other.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO pending_client_pdfs (
         id, project_id, project_name, due_date, filename, bytes, created_at
       ) VALUES ('pdf-2', 'project-2', 'Other', '2026-04-01', 'client.pdf', 4,
         '2026-04-01T00:00:00.000Z')`
    ).run()
    const account = db
      .prepare<unknown[], { id: string }>(`SELECT id FROM email_accounts WHERE id = 'acct-1'`)
      .get()
    expect(account?.id).toBe('acct-1')
  })
})
