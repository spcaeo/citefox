import { afterEach, describe, expect, test } from 'vitest'
import {
  claudeCallsByProject,
  countActivitySince,
  latestActivityNotice,
  recordActivity,
  type ActivityRecord
} from './activity-events'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { deleteProject, insertProject } from './records'
import { projectDatabaseRelativePath } from './slug'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

function appDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  insertProject(db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  return db
}

let sequence = 0
function row(
  at: string,
  kind: ActivityRecord['kind'],
  extra?: Partial<ActivityRecord>
): ActivityRecord {
  sequence += 1
  return {
    id: `act-${sequence}`,
    at,
    kind,
    keyId: null,
    projectId: 'proj-1',
    count: 1,
    detail: null,
    ...extra
  }
}

describe('activity events (app migration 018)', () => {
  test('counts searches, Claude calls, and Jina reads in the window only', () => {
    const db = appDb()
    recordActivity(db, row('2026-10-19T10:00:00.000Z', 'search', { count: 2, keyId: 'key-1' }))
    recordActivity(db, row('2026-10-20T09:00:00.000Z', 'search', { count: 3, keyId: 'key-1' }))
    recordActivity(db, row('2026-10-20T09:01:00.000Z', 'claude_call'))
    recordActivity(db, row('2026-10-20T09:02:00.000Z', 'jina_read', { projectId: null }))
    recordActivity(db, row('2026-10-20T09:03:00.000Z', 'claude_limit', { detail: 'Limit.' }))
    expect(countActivitySince(db, '2026-10-19T12:00:00.000Z')).toEqual({
      searches: 3,
      claudeCalls: 1,
      jinaReads: 1
    })
  })

  test('Claude calls per project this month, with deleted projects counted under null', () => {
    const db = appDb()
    recordActivity(db, row('2026-10-02T00:00:00.000Z', 'claude_call'))
    recordActivity(db, row('2026-10-03T00:00:00.000Z', 'claude_call'))
    recordActivity(db, row('2026-09-30T23:00:00.000Z', 'claude_call'))
    recordActivity(db, row('2026-10-04T00:00:00.000Z', 'claude_call', { projectId: 'gone' }))
    const calls = claudeCallsByProject(db, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
    expect(calls.get('proj-1')).toBe(2)
    expect(calls.get(null)).toBe(1)
    deleteProject(db, 'proj-1')
    const after = claudeCallsByProject(db, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
    expect(after.get(null)).toBe(3)
  })

  test('the latest notice is the newest limit, fallback, or Jina failover', () => {
    const db = appDb()
    expect(latestActivityNotice(db)).toBeNull()
    recordActivity(db, row('2026-10-20T08:00:00.000Z', 'jina_failover', { detail: 'Moved.' }))
    recordActivity(db, row('2026-10-20T09:00:00.000Z', 'claude_fallback', { detail: 'Switched.' }))
    recordActivity(db, row('2026-10-20T10:00:00.000Z', 'claude_call'))
    expect(latestActivityNotice(db)).toMatchObject({ kind: 'claude_fallback', detail: 'Switched.' })
  })

  test('old rows are pruned on write and secret-shaped details are redacted', () => {
    const db = appDb()
    recordActivity(db, row('2026-01-01T00:00:00.000Z', 'claude_call'))
    recordActivity(
      db,
      row('2026-10-20T00:00:00.000Z', 'claude_limit', {
        detail: 'Rejected sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
      })
    )
    expect(countActivitySince(db, '2025-01-01T00:00:00.000Z').claudeCalls).toBe(0)
    expect(latestActivityNotice(db)?.detail).not.toContain('abcdefghijklmnop')
  })
})
