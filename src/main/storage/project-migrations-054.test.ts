import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { getFixFollowUp, setFixWorkedNoted } from './fix-follow-ups'
import { migrate } from './migrate'
import { applied, closeTracked, column, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { FIX_VERDICTS_VERSION } from './project-schema-fix-verdicts'

/** Project upgrade 054: a fix's page address, its page fix, and its "working" note. */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-29T12:00:00.000Z'

function before054(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((migration) => migration.version < FIX_VERDICTS_VERSION)
  )
  db.prepare(
    `INSERT INTO pages (id, url, title, label, folder, status, interval_days, samples,
       prompt_count, kind)
     VALUES
       ('topic-1', NULL, 'Crew alerts', 'Crew alerts', NULL, 'tracked', 14, 1, 1, 'topic'),
       ('topic-2', NULL, 'No target', 'No target', NULL, 'tracked', 14, 1, 1, 'topic'),
       ('page-1', 'https://example.com/blog/post', NULL, NULL, NULL, 'tracked', 14, 1, 1, 'page')`
  ).run()
  db.prepare(
    `INSERT INTO topics (page_id, seed, source, created_at, updated_at, target_url)
     VALUES ('topic-1', 'Crew alerts', 'seed', ?, ?, 'https://example.com/crew'),
            ('topic-2', 'No target', 'seed', ?, ?, NULL)`
  ).run(NOW, NOW, NOW, NOW)
  const insert = db.prepare(
    `INSERT INTO fixes (id, page_id, number, description, live_on, recheck_rule, markets, kind)
     VALUES (?, ?, 1, 'Added a table.', '2026-10-01T00:00:00.000Z', 'after_3_days', '["us"]', 'fix')`
  )
  insert.run('fix-topic', 'topic-1')
  insert.run('fix-bare-topic', 'topic-2')
  insert.run('fix-page', 'page-1')
  return db
}

describe('project migration 054_fix_verdicts', () => {
  test('follows 053; a topic fix takes its target page, every other fix keeps none', () => {
    const db = before054()
    expect(column(db, 'fixes', 'url')).toBeUndefined()
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 54, name: '054_fix_verdicts' })
    expect(column(db, 'fixes', 'url')).toMatchObject({ notnull: 0, dflt_value: null })
    expect(column(db, 'fixes', 'page_fix_id')).toMatchObject({ notnull: 0 })
    expect(column(db, 'fixes', 'worked_noted_at')).toMatchObject({ notnull: 0 })
    expect(getFixFollowUp(db, 'fix-topic')).toMatchObject({
      url: 'https://example.com/crew',
      pageFixId: null,
      workedNotedAt: null
    })
    expect(getFixFollowUp(db, 'fix-bare-topic')?.url).toBeNull()
    expect(getFixFollowUp(db, 'fix-page')?.url).toBeNull()
  })

  test('stores the working note once and refuses empty values', () => {
    const db = before054()
    migrate(db, PROJECT_MIGRATIONS)
    setFixWorkedNoted(db, 'fix-page', NOW)
    expect(getFixFollowUp(db, 'fix-page')?.workedNotedAt).toBe(NOW)
    expect(() => db.prepare(`UPDATE fixes SET url = '' WHERE id = 'fix-page'`).run()).toThrow(
      /CHECK/
    )
    expect(() =>
      db.prepare(`UPDATE fixes SET page_fix_id = '' WHERE id = 'fix-page'`).run()
    ).toThrow(/CHECK/)
  })
})
