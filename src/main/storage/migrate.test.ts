import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { APP_MIGRATIONS, APP_TABLES, DEFERRED_APP_TABLES } from './app-schema'
import { openAppDatabase } from './app-database'
import { closeDatabase, openSqliteDatabase } from './database'
import { migrate, type Migration } from './migrate'
import {
  applied,
  closeTracked,
  column,
  columns,
  directories,
  tableNames,
  track
} from './migrate.test-helper'

/** The migration runner and the fresh app schema. Upgrade tests live in `*-migrations*.test.ts`. */

afterEach(() => {
  closeTracked()
})

describe('app migrations', () => {
  test('creates the section 10 app tables on a fresh database', () => {
    const db = track(openAppDatabase(':memory:'))
    expect(tableNames(db)).toEqual(expect.arrayContaining([...APP_TABLES, 'schema_migrations']))
    for (const name of DEFERRED_APP_TABLES) {
      expect(tableNames(db)).not.toContain(name)
    }
    expect(columns(db, 'projects').map((column) => column.name)).toEqual([
      'id',
      'name',
      'slug',
      'domain',
      'db_path',
      'client_name',
      'status'
    ])
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
      'last_reason',
      'plan',
      'cloro_remaining',
      'cloro_per_cycle',
      'cloro_resets_at'
    ])
    expect(columns(db, 'key_usage').map((column) => column.name)).toEqual([
      'id',
      'key_id',
      'project_id',
      'month',
      'searches',
      'calls',
      'tokens',
      'credits'
    ])
    expect(columns(db, 'email_accounts').map((column) => column.name)).toEqual([
      'id',
      'provider',
      'from_name',
      'from_address',
      'reply_to',
      'host',
      'port',
      'security',
      'username',
      'keychain_ref',
      'is_default',
      'last_test'
    ])
    expect(columns(db, 'report_schedules').map((column) => column.name)).toEqual([
      'id',
      'name',
      'project_id',
      'timing_json',
      'format',
      'sections',
      'markets',
      'recipients',
      'account_id',
      'time_zone',
      'subject',
      'summary_style',
      'status',
      'created_at',
      'deleted_at',
      'scope_json',
      'report_json'
    ])
    expect(columns(db, 'deliveries').map((column) => column.name)).toEqual([
      'id',
      'schedule_id',
      'at',
      'trigger',
      'project_id',
      'recipients',
      'ok',
      'error',
      'outcome',
      'occurrence_key',
      'next_step'
    ])
    expect(column(db, 'email_accounts', 'reply_to')?.notnull).toBe(0)
    expect(column(db, 'email_accounts', 'last_test')?.notnull).toBe(0)
    expect(column(db, 'email_accounts', 'keychain_ref')?.notnull).toBe(1)
    expect(column(db, 'report_schedules', 'project_id')?.notnull).toBe(0)
    expect(column(db, 'report_schedules', 'summary_style')?.notnull).toBe(0)
    expect(column(db, 'deliveries', 'schedule_id')?.notnull).toBe(0)
    expect(column(db, 'deliveries', 'error')?.notnull).toBe(0)
    expect(column(db, 'deliveries', 'outcome')?.notnull).toBe(1)
    expect(column(db, 'deliveries', 'occurrence_key')?.notnull).toBe(0)
    expect(column(db, 'report_schedules', 'status')?.dflt_value).toBe("'active'")
    expect(column(db, 'report_schedules', 'created_at')?.notnull).toBe(1)
    expect(column(db, 'report_schedules', 'created_at')?.dflt_value).toBe(
      "'1970-01-01T00:00:00.000Z'"
    )
    expect(column(db, 'report_schedules', 'deleted_at')?.notnull).toBe(0)
    expect(column(db, 'report_schedules', 'deleted_at')?.dflt_value).toBeNull()
    expect(column(db, 'deliveries', 'next_step')?.notnull).toBe(0)
    expect(column(db, 'deliveries', 'next_step')?.dflt_value).toBeNull()
    expect(columns(db, 'connection_events').map((column) => column.name)).toEqual([
      'id',
      'key_id',
      'at',
      'kind',
      'detail'
    ])
    expect(columns(db, 'templates').map((column) => column.name)).toEqual([
      'id',
      'name',
      'version',
      'hash',
      'body',
      'schema',
      'settings_json',
      'kind',
      'notes',
      'deleted_at',
      'is_default',
      'is_shipped',
      'created_at',
      'updated_at'
    ])
    expect(columns(db, 'claude_checkups').map((column) => column.name)).toEqual([
      'id',
      'ran_at',
      'binary_ok',
      'login_ok',
      'roundtrip_ok',
      'detail_json'
    ])
    expect(column(db, 'claude_checkups', 'detail_json')?.notnull).toBe(1)
    expect(column(db, 'api_keys', 'cap')?.notnull).toBe(0)
    expect(column(db, 'api_keys', 'last_reason')?.notnull).toBe(0)
    expect(column(db, 'projects', 'client_name')?.notnull).toBe(0)
    expect(column(db, 'connection_events', 'detail')?.notnull).toBe(0)
    expect(column(db, 'connection_events', 'key_id')?.notnull).toBe(1)
    expect(column(db, 'templates', 'schema')?.notnull).toBe(0)
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
  })

  test('does not store a secret column', () => {
    const db = track(openAppDatabase(':memory:'))
    const forbidden = [
      'secret',
      'password',
      'token',
      'ciphertext',
      'api_key',
      'webhook',
      'authorization'
    ]
    const names = APP_TABLES.flatMap((table) => columns(db, table).map((column) => column.name))
    for (const name of names) expect(forbidden).not.toContain(name)
  })

  test('is idempotent when run again', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS)
    migrate(db, APP_MIGRATIONS)
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
    expect(tableNames(db).filter((name) => name === 'projects')).toHaveLength(1)
    expect(tableNames(db).filter((name) => name === 'claude_checkups')).toHaveLength(1)
  })

  test('applies versions in order when the list is registered out of order', () => {
    const seen: number[] = []
    const migrations: Migration[] = [
      {
        version: 2,
        name: 'second',
        up: (db) => {
          db.exec('INSERT INTO steps (n) VALUES (2)')
          seen.push(2)
        }
      },
      {
        version: 1,
        name: 'first',
        up: (db) => {
          db.exec('CREATE TABLE steps (n INTEGER)')
          seen.push(1)
        }
      }
    ]
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, migrations)
    expect(seen).toEqual([1, 2])
    expect(applied(db).map((row) => row.version)).toEqual([1, 2])
    const steps = db.prepare<unknown[], { n: number }>('SELECT n FROM steps').all()
    expect(steps.map((row) => row.n)).toEqual([2])
  })

  test('refuses a gap in the migration list', () => {
    const db = track(openSqliteDatabase(':memory:'))
    expect(() =>
      migrate(db, [
        { version: 1, name: 'one', up: () => undefined },
        { version: 3, name: 'three', up: () => undefined }
      ])
    ).toThrow(/contiguous/)
  })

  test('refuses a database that is newer than this app', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, [{ version: 1, name: 'one', up: () => undefined }])
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, ?, ?)').run(
      'future',
      '2026-10-19T00:00:00.000Z'
    )
    expect(() => migrate(db, [{ version: 1, name: 'one', up: () => undefined }])).toThrow(/newer/)
  })

  test('refuses to skip a migration that a later applied version jumped over', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'one', up: () => undefined },
      { version: 2, name: 'two', up: () => undefined }
    ]
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, migrations)
    db.prepare('DELETE FROM schema_migrations WHERE version = 1').run()
    expect(() => migrate(db, migrations)).toThrow(/missing/)
  })

  test('rolls back a migration that throws', () => {
    const db = track(openSqliteDatabase(':memory:'))
    const broken: Migration[] = [
      {
        version: 1,
        name: 'broken',
        up: (database) => {
          database.exec('CREATE TABLE boom (id INTEGER)')
          throw new Error('fail the migration')
        }
      }
    ]
    expect(() => migrate(db, broken)).toThrow(/fail the migration/)
    expect(tableNames(db)).not.toContain('boom')
    expect(applied(db)).toEqual([])
    migrate(db, [
      { version: 1, name: 'fixed', up: (database) => database.exec('CREATE TABLE ok (id INTEGER)') }
    ])
    expect(tableNames(db)).toContain('ok')
    expect(applied(db)).toEqual([{ version: 1, name: 'fixed' }])
  })

  test('opens a file database twice and keeps it private to the user', () => {
    const directory = mkdtempSync(join(tmpdir(), 'citefox-db-'))
    directories.push(directory)
    const filename = join(directory, 'app.sqlite')
    const first = openAppDatabase(filename)
    closeDatabase(first)
    const second = track(openAppDatabase(filename))
    expect(applied(second)).toEqual([
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
    expect(statSync(filename).mode & 0o777).toBe(0o600)
  })
})
