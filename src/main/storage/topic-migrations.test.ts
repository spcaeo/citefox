import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, column, foreignKeys, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { TOPIC_PAGES_VERSION, TOPIC_TABLES_VERSION } from './project-schema-topics'

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-01T00:00:00.000Z'

function seedOldPage(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    `INSERT INTO pages (id, url, title, label, folder, status, interval_days, samples, prompt_count,
       default_market_id, pinned, score, pinned_at)
     VALUES ('page-1', 'https://textbolt.com/a/', 'A', NULL, NULL, 'tracked', 14, 1, 10, NULL, 1, 42, ?)`
  ).run(NOW)
  db.prepare(
    `INSERT INTO page_markets (page_id, market_id, added_at, baseline_run_id) VALUES ('page-1', 'mkt-us', ?, NULL)`
  ).run(NOW)
  db.prepare(
    `INSERT INTO fixes (id, page_id, number, description, live_on, recheck_rule, markets)
     VALUES ('fix-1', 'page-1', 1, 'Added FAQ', '2026-10-01', 'after_3_days', '["mkt-us"]')`
  ).run()
  db.prepare(
    `INSERT INTO notes (id, page_id, date, text, created_at, updated_at)
     VALUES ('note-1', 'page-1', '2026-10-01', 'n', ?, ?)`
  ).run(NOW, NOW)
}

describe('project migrations 027 and 028 (topics)', () => {
  test('pages gain kind, keep every row, and child rows with ON DELETE CASCADE survive', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, TOPIC_PAGES_VERSION - 1))
    seedOldPage(db)
    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db).map((row) => row.version)).toContain(TOPIC_TABLES_VERSION)
    expect(db.prepare('SELECT id, url, kind, pinned, score, pinned_at FROM pages').all()).toEqual([
      {
        id: 'page-1',
        url: 'https://textbolt.com/a/',
        kind: 'page',
        pinned: 1,
        score: 42,
        pinned_at: NOW
      }
    ])
    // The rebuild must not cascade-delete fixes and notes.
    expect(db.prepare('SELECT id FROM fixes').all()).toEqual([{ id: 'fix-1' }])
    expect(db.prepare('SELECT id FROM notes').all()).toEqual([{ id: 'note-1' }])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(column(db, 'pages', 'url')?.notnull).toBe(0)
    expect(foreignKeys(db, 'notes').map((row) => row.table)).toEqual(['pages'])
  })

  test('a topic row needs no URL and a name; a page row still needs a URL', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS)
    const insert = db.prepare(
      `INSERT INTO pages (id, url, title, status, interval_days, samples, prompt_count, kind)
       VALUES (?, ?, ?, 'tracked', 14, 1, 30, ?)`
    )
    insert.run('topic-1', null, 'Text alerts', 'topic')
    insert.run('topic-2', null, 'Second topic', 'topic')
    expect(() => insert.run('topic-3', null, null, 'topic')).toThrow()
    expect(() => insert.run('topic-4', 'https://x.com/', 'T', 'topic')).toThrow()
    expect(() => insert.run('page-9', null, 'P', 'page')).toThrow()
    db.prepare(
      `INSERT INTO topics (page_id, seed, source, created_at, updated_at)
       VALUES ('topic-1', 'Text alerts for teams', 'seed', ?, ?)`
    ).run(NOW, NOW)
    expect(
      db
        .prepare(
          'SELECT question_band_lo, question_band_hi, keyword_band_lo, keyword_band_hi, generate FROM topics'
        )
        .get()
    ).toEqual({
      question_band_lo: 50,
      question_band_hi: 70,
      keyword_band_lo: 25,
      keyword_band_hi: 40,
      generate: 'questions'
    })
    expect(() =>
      db
        .prepare(
          `INSERT INTO topics (page_id, seed, source, question_band_lo, question_band_hi, created_at, updated_at)
           VALUES ('topic-2', 's', 'seed', 80, 60, ?, ?)`
        )
        .run(NOW, NOW)
    ).toThrow()
  })

  test('a reference broken before the upgrade does not block it', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, TOPIC_PAGES_VERSION - 1))
    db.pragma('foreign_keys = OFF')
    db.prepare(
      `INSERT INTO notes (id, page_id, date, text, created_at, updated_at)
       VALUES ('note-x', 'missing-page', '2026-10-01', 'n', ?, ?)`
    ).run(NOW, NOW)
    db.pragma('foreign_keys = ON')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db).map((row) => row.version)).toContain(TOPIC_TABLES_VERSION)
    expect(column(db, 'pages', 'kind')?.notnull).toBe(1)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
