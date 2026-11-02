import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase } from '../storage/database'
import { migrate } from '../storage/migrate'
import { applied, closeTracked, columns, tableNames, track } from '../storage/migrate.test-helper'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { THREAD_EXCERPT_VERSION } from './migration'

afterEach(() => {
  closeTracked()
})

const BEFORE = PROJECT_MIGRATIONS.filter((migration) => migration.version <= 15)

function seedReference(
  db: ReturnType<typeof openSqliteDatabase>,
  id: string,
  url: string,
  normalized: string,
  domain: string,
  sourceType: string
): void {
  db.prepare(
    `INSERT INTO aio_references (id, serp_result_id, position, url, normalized_url, domain, title,
       classification, untracked, source_type)
     VALUES (?, 'serp-1', 1, ?, ?, ?, NULL, 'other', 0, ?)`
  ).run(id, url, normalized, domain, sourceType)
}

describe('021_communities_and_video_ideas', () => {
  test('creates the community tables and reprocesses stored references', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, BEFORE)
    db.pragma('foreign_keys = OFF')
    seedReference(
      db,
      'ref-1',
      'https://youtu.be/dQw4w9WgXcQ?t=49',
      'https://youtu.be/dQw4w9WgXcQ?t=49',
      'youtu.be',
      'youtube'
    )
    seedReference(
      db,
      'ref-2',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'youtube.com',
      'youtube'
    )
    seedReference(
      db,
      'ref-3',
      'https://www.trustradius.com/products/textbolt/reviews',
      'https://trustradius.com/products/textbolt/reviews',
      'trustradius.com',
      'web'
    )
    seedReference(
      db,
      'ref-4',
      'https://community.spiceworks.com/t/sms/1',
      'https://community.spiceworks.com/t/sms/1',
      'community.spiceworks.com',
      'forum'
    )
    db.pragma('foreign_keys = ON')

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db).map((row) => row.name)).toContain('021_communities_and_video_ideas')
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'video_ideas',
        'reddit_threads',
        'youtube_videos',
        'community_settings'
      ])
    )
    expect(columns(db, 'video_ideas').map((column) => column.name)).toEqual([
      'id',
      'question',
      'page_id',
      'prompt_ids',
      'step',
      'brief_json',
      'storyboard_json',
      'video_url',
      'sent_to_foxcue_at',
      'video_id',
      'deadline',
      'checklist_json',
      'tracking_started_at',
      'created_at',
      'updated_at'
    ])
    const rows = db
      .prepare<
        unknown[],
        { id: string; normalized_url: string; domain: string; source_type: string }
      >('SELECT id, normalized_url, domain, source_type FROM aio_references ORDER BY id')
      .all()
    expect(rows).toEqual([
      {
        id: 'ref-1',
        normalized_url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        domain: 'youtube.com',
        source_type: 'youtube'
      },
      {
        id: 'ref-2',
        normalized_url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        domain: 'youtube.com',
        source_type: 'youtube'
      },
      {
        id: 'ref-3',
        normalized_url: 'https://trustradius.com/products/textbolt/reviews',
        domain: 'trustradius.com',
        source_type: 'review'
      },
      {
        id: 'ref-4',
        normalized_url: 'https://community.spiceworks.com/t/sms/1',
        domain: 'community.spiceworks.com',
        source_type: 'forum'
      }
    ])
  })

  test('video ideas reject a bad step and a published idea with no URL', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS)
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    const insert = (step: string, videoUrl: string | null): void => {
      db.prepare(
        `INSERT INTO video_ideas (id, question, page_id, prompt_ids, step, video_url, created_at, updated_at)
         VALUES (?, 'Q?', 'page-1', '["p1"]', ?, ?, 'now', 'now')`
      ).run(`vi-${step}-${videoUrl ?? 'none'}`, step, videoUrl)
    }
    expect(() => insert('done', null)).toThrow(/CHECK/)
    expect(() => insert('tracking', null)).toThrow(/CHECK/)
    insert('tracking', 'https://youtube.com/watch?v=dQw4w9WgXcQ')
    insert('idea', null)
  })
})

describe('reddit thread excerpts', () => {
  test('adds nullable excerpt and brand_quote columns and keeps cached threads', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((migration) => migration.version < THREAD_EXCERPT_VERSION)
    )
    db.prepare(
      `INSERT INTO reddit_threads (url, title, checked_at) VALUES ('https://reddit.com/r/a/comments/x1', 'T', 'now')`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db).at(-1)?.version).toBeGreaterThanOrEqual(THREAD_EXCERPT_VERSION)
    expect(columns(db, 'reddit_threads').map((info) => info.name)).toEqual(
      expect.arrayContaining(['excerpt', 'brand_quote'])
    )
    const row = db
      .prepare<unknown[], { title: string; excerpt: string | null; brand_quote: string | null }>(
        'SELECT title, excerpt, brand_quote FROM reddit_threads'
      )
      .get()
    expect(row).toEqual({ title: 'T', excerpt: null, brand_quote: null })
    expect(() =>
      db.prepare(`UPDATE reddit_threads SET excerpt = '' WHERE title = 'T'`).run()
    ).toThrow(/CHECK/)
  })
})
