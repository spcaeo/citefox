import { afterEach, describe, expect, test } from 'vitest'
import { getTopicTargetPage, setTopicTargetPage } from '../topics/records'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, column, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { TOPIC_TARGET_VERSION } from './project-schema-topic-target'

/** Project upgrade 047: `topics.target_url`, a topic's target page. */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-29T12:00:00.000Z'

function before047(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((migration) => migration.version < TOPIC_TARGET_VERSION)
  )
  db.prepare(
    `INSERT INTO pages (id, url, title, label, folder, status, interval_days, samples,
       prompt_count, kind)
     VALUES ('topic-1', NULL, 'Crew alerts', 'Crew alerts', NULL, 'tracked', 14, 1, 1, 'topic')`
  ).run()
  db.prepare(
    `INSERT INTO topics (page_id, seed, source, created_at, updated_at)
     VALUES ('topic-1', 'Crew alerts', 'seed', ?, ?)`
  ).run(NOW, NOW)
  return db
}

describe('project migration 047_topic_target_page', () => {
  test('follows 046 and leaves every old topic without a target page', () => {
    const db = before047()
    expect(column(db, 'topics', 'target_url')).toBeUndefined()

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db)).toContainEqual({ version: 47, name: '047_topic_target_page' })
    expect(column(db, 'topics', 'target_url')).toMatchObject({ notnull: 0, dflt_value: null })
    expect(getTopicTargetPage(db, 'topic-1')).toBeNull()
    expect(db.prepare('SELECT seed FROM topics').all()).toEqual([{ seed: 'Crew alerts' }])
  })

  test('stores, clears and refuses an empty target page', () => {
    const db = before047()
    migrate(db, PROJECT_MIGRATIONS)

    setTopicTargetPage(db, 'topic-1', 'https://textbolt.com/pricing', NOW)
    expect(getTopicTargetPage(db, 'topic-1')).toBe('https://textbolt.com/pricing')
    setTopicTargetPage(db, 'topic-1', null, NOW)
    expect(getTopicTargetPage(db, 'topic-1')).toBeNull()
    expect(getTopicTargetPage(db, 'missing')).toBeNull()
    expect(() =>
      db.prepare(`UPDATE topics SET target_url = '' WHERE page_id = 'topic-1'`).run()
    ).toThrow(/CHECK/)
  })
})
