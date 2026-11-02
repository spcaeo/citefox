import { afterEach, describe, expect, test } from 'vitest'
import { APP_MIGRATIONS } from './app-schema'
import { REPORT_SCOPE_APP_VERSION } from './app-schema-report-scope'
import { openSqliteDatabase } from './database'
import { getReportSchedule } from './email-records'
import { migrate } from './migrate'
import { applied, closeTracked, column, columns, track } from './migrate.test-helper'

/** App database upgrade 022: the scope of a scheduled report. */

afterEach(() => {
  closeTracked()
})

describe('app migration 022_report_schedule_scope', () => {
  test('adds a nullable scope_json and keeps every existing schedule on the whole project', () => {
    const at = APP_MIGRATIONS.findIndex((item) => item.version === REPORT_SCOPE_APP_VERSION)
    expect(APP_MIGRATIONS[at]).toMatchObject({ version: 22, name: '022_report_schedule_scope' })
    expect(APP_MIGRATIONS[at - 1]?.version).toBe(21)
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, at))
    expect(columns(db, 'report_schedules').map((item) => item.name)).not.toContain('scope_json')
    db.prepare(
      `INSERT INTO projects (id, name, slug, domain, db_path, client_name, status)
       VALUES ('project-1', 'Acme', 'acme', 'acme.example', 'projects/acme.sqlite', NULL, 'active')`
    ).run()
    db.prepare(
      `INSERT INTO report_schedules (
         id, name, project_id, timing_json, format, sections, markets, recipients, account_id,
         time_zone, subject, summary_style, status, created_at
       ) VALUES ('sched-1', 'Monthly', 'project-1', '{"kind":"after_check"}', 'pdf', '["results"]',
         '["mkt-us"]', '["a@example.com"]', NULL, 'UTC', 'Report', NULL, 'active',
         '2026-04-01T00:00:00.000Z')`
    ).run()
    const before = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules`)
      .all()

    migrate(db, APP_MIGRATIONS)

    expect(applied(db).find((item) => item.version === 22)).toEqual({
      version: 22,
      name: '022_report_schedule_scope'
    })
    expect(column(db, 'report_schedules', 'scope_json')?.notnull).toBe(0)
    expect(column(db, 'report_schedules', 'scope_json')?.dflt_value).toBeNull()
    const after = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM report_schedules`)
      .all()
    for (const [name, value] of Object.entries(before[0] ?? {})) {
      expect(after[0]?.[name]).toBe(value)
    }
    expect(after[0]?.scope_json).toBeNull()
    expect(getReportSchedule(db, 'sched-1')?.scope).toBeNull()

    // Only a JSON object is stored.
    expect(() =>
      db.prepare(`UPDATE report_schedules SET scope_json = 'not json' WHERE id = 'sched-1'`).run()
    ).toThrow()
    expect(() =>
      db.prepare(`UPDATE report_schedules SET scope_json = '[1]' WHERE id = 'sched-1'`).run()
    ).toThrow()
    db.prepare(
      `UPDATE report_schedules SET scope_json = '{"kind":"group","ids":["grp-1"]}' WHERE id = 'sched-1'`
    ).run()
    expect(getReportSchedule(db, 'sched-1')?.scope).toEqual({ kind: 'group', ids: ['grp-1'] })
  })
})
