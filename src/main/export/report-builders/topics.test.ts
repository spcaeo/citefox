import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../../storage/database'
import { migrate } from '../../storage/migrate'
import { PROJECT_MIGRATIONS } from '../../storage/project-schema'
import { savedSummary, topicCoverageFromStorage } from './topics'

const open: SqliteDatabase[] = []
afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db)
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  open.push(db)
  migrate(db, PROJECT_MIGRATIONS)
  db.prepare(
    `INSERT INTO pages (id, url, title, status, interval_days, samples, prompt_count, kind)
     VALUES ('topic-1', NULL, 'Text alerts', 'tracked', 14, 1, 30, 'topic'),
            ('page-1', 'https://textbolt.com/a/', 'A', 'tracked', 14, 1, 10, 'page')`
  ).run()
  return db
}

describe('topic coverage from storage', () => {
  test('reads the latest saved summary and its actions', () => {
    const db = projectDb()
    const insert = db.prepare(
      `INSERT INTO topic_summaries (id, page_id, market_id, run_id, line, executive, actions_json, created_at)
       VALUES (?, 'topic-1', 'mkt-us', NULL, ?, ?, ?, ?)`
    )
    insert.run('s1', 'Old line', 'Old summary', '[]', '2026-10-05T00:00:00.000Z')
    insert.run(
      's2',
      'Since Oct 5: 4 more cited.',
      'Cited in 11 of 26.',
      JSON.stringify([
        { text: 'Strengthen Q6', verify: 'Check the price' },
        'Write a page for Q21',
        7
      ]),
      '2026-10-19T00:00:00.000Z'
    )
    expect(savedSummary(db, 'topic-1', 'mkt-us')).toEqual({
      line: 'Since Oct 5: 4 more cited.',
      executive: 'Cited in 11 of 26.',
      actions: [
        { text: 'Strengthen Q6', verify: 'Check the price' },
        { text: 'Write a page for Q21', verify: null }
      ],
      createdAt: '2026-10-19T00:00:00.000Z'
    })
    expect(savedSummary(db, 'topic-1', 'mkt-ca')).toBeNull()
  })

  test('a report with no topic subject gets no section', () => {
    const db = projectDb()
    const context = {
      rows: [],
      references: [],
      pages: [
        {
          id: 'page-1',
          url: 'https://textbolt.com/a/',
          path: '/a/',
          title: 'A',
          role: 'tracked' as const
        }
      ],
      markets: [{ id: 'mkt-us', code: 'US-EN', label: 'US · EN', flag: '' }],
      ownDomain: 'textbolt.com',
      brands: [],
      competitors: [],
      count: () => ({ n: 0, drill: null })
    }
    const input = {
      projectId: 'proj-1',
      domain: 'textbolt.com',
      builtAt: '2026-10-21T00:00:00.000Z'
    }
    expect(topicCoverageFromStorage(db, input, context)).toBeNull()
    // A topic that cannot be loaded (no topics row yet) still marks the section, empty.
    const withTopic = {
      ...context,
      pages: [{ id: 'topic-1', url: '', path: '', title: 'Text alerts', role: 'tracked' as const }]
    }
    expect(topicCoverageFromStorage(db, input, withTopic)?.topics).toEqual([])
  })
})
