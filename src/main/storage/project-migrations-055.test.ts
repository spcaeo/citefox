import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import {
  applied,
  closeTracked,
  foreignKeys,
  indexSql,
  tableSql,
  track
} from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { CHECK_INTERVALS_VERSION } from './project-schema-check-intervals'
import { readProjectSchedule } from './project-schedule'

/** Project upgrade 055: every day (1) and every 7 days allowed; saved intervals kept. */

afterEach(() => {
  closeTracked()
})

function before055(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((migration) => migration.version < CHECK_INTERVALS_VERSION)
  )
  db.prepare(
    `INSERT INTO pages (id, url, title, label, folder, status, interval_days, samples,
       prompt_count, kind)
     VALUES
       ('page-14', 'https://example.com/a', NULL, NULL, NULL, 'tracked', 14, 1, 1, 'page'),
       ('page-90', 'https://example.com/b', NULL, NULL, NULL, 'paused', 90, 2, 3, 'page'),
       ('topic-30', NULL, 'Crew alerts', 'Crew alerts', NULL, 'tracked', 30, 1, 1, 'topic')`
  ).run()
  db.prepare(
    `INSERT INTO topics (page_id, seed, source, created_at, updated_at)
     VALUES ('topic-30', 'Crew alerts', 'seed', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`
  ).run()
  db.prepare(
    `INSERT INTO project_schedule (id, default_interval_days, daily_check_time, spread_across_day,
       catch_up, paused, pages_due_today)
     VALUES (1, 14, '09:00', 0, 1, 0, 0)`
  ).run()
  return db
}

function intervals(db: SqliteDatabase): Record<string, number> {
  const rows = db
    .prepare<unknown[], { id: string; interval_days: number }>(
      'SELECT id, interval_days FROM pages ORDER BY id'
    )
    .all()
  return Object.fromEntries(rows.map((row) => [row.id, row.interval_days]))
}

describe('project migration 055_check_intervals', () => {
  test('follows 054; old files refuse 1 and 7 before it', () => {
    const db = before055()
    expect(() =>
      db.prepare(`UPDATE pages SET interval_days = 1 WHERE id = 'page-14'`).run()
    ).toThrow(/CHECK/)
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 55, name: '055_check_intervals' })
  })

  test('keeps every saved interval, row, index and reference', () => {
    const db = before055()
    const pageIndexes = indexSql(db, 'pages')
    const topicRefs = foreignKeys(db, 'topics')
    migrate(db, PROJECT_MIGRATIONS)
    expect(intervals(db)).toEqual({ 'page-14': 14, 'page-90': 90, 'topic-30': 30 })
    expect(readProjectSchedule(db, 'proj-1').defaultIntervalDays).toBe(14)
    expect(indexSql(db, 'pages')).toEqual(pageIndexes)
    expect(foreignKeys(db, 'topics')).toEqual(topicRefs)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(tableSql(db, 'pages')).toContain('CHECK (interval_days IN (1, 7, 14, 30, 60, 90))')
    expect(tableSql(db, 'project_schedule')).toContain(
      'CHECK (default_interval_days IN (1, 7, 14, 30, 60, 90))'
    )
  })

  test('allows every day and every 7 days, and still refuses other values', () => {
    const db = before055()
    migrate(db, PROJECT_MIGRATIONS)
    db.prepare(`UPDATE pages SET interval_days = 1 WHERE id = 'page-14'`).run()
    db.prepare(`UPDATE pages SET interval_days = 7 WHERE id = 'topic-30'`).run()
    db.prepare(`UPDATE project_schedule SET default_interval_days = 7 WHERE id = 1`).run()
    expect(intervals(db)).toEqual({ 'page-14': 1, 'page-90': 90, 'topic-30': 7 })
    expect(readProjectSchedule(db, 'proj-1').defaultIntervalDays).toBe(7)
    expect(() =>
      db.prepare(`UPDATE pages SET interval_days = 2 WHERE id = 'page-14'`).run()
    ).toThrow(/CHECK/)
    expect(() =>
      db.prepare(`UPDATE project_schedule SET default_interval_days = 0 WHERE id = 1`).run()
    ).toThrow(/CHECK/)
  })

  test('deleting a topic page still cascades to its topic row after the rebuild', () => {
    const db = before055()
    migrate(db, PROJECT_MIGRATIONS)
    db.prepare(`DELETE FROM pages WHERE id = 'topic-30'`).run()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM topics`).get()).toEqual({ n: 0 })
  })
})
