import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { getKeyUsageForMonth } from './key-usage'
import {
  addKeyUsage,
  insertApiKey,
  insertKeyUsage,
  insertProject,
  type ApiKeyRecord,
  type KeyUsageRecord,
  type ProjectRecord
} from './records'
import { projectDatabaseRelativePath } from './slug'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('key usage month', () => {
  test('sums month-to-date usage per key and across keys', () => {
    const db = memory()
    insertProject(db, project('project-1', 'textbolt'))
    insertProject(db, project('project-2', 'client'))
    insertApiKey(db, key('key-1', 'serpapi', 'citefox.serpapi.key-1', 0))
    insertApiKey(db, key('key-2', 'jina', 'citefox.jina.key-2', 1))
    insertKeyUsage(db, row('usage-1', 'key-1', 'project-1', '2026-04', 4, 1, 20))
    insertKeyUsage(db, row('usage-2', 'key-1', 'project-2', '2026-04', 6, 0, 5))
    insertKeyUsage(db, row('usage-3', 'key-2', 'project-1', '2026-04', 2, 3, 8))
    insertKeyUsage(db, row('usage-4', 'key-2', 'project-1', '2026-03', 99, 9, 9))

    expect(getKeyUsageForMonth(db, '2026-04')).toEqual({
      month: '2026-04',
      keys: [
        {
          keyId: 'key-1',
          searches: 10,
          calls: 1,
          tokens: 25,
          projects: [
            { projectId: 'project-1', searches: 4, calls: 1, tokens: 20 },
            { projectId: 'project-2', searches: 6, calls: 0, tokens: 5 }
          ]
        },
        {
          keyId: 'key-2',
          searches: 2,
          calls: 3,
          tokens: 8,
          projects: [{ projectId: 'project-1', searches: 2, calls: 3, tokens: 8 }]
        }
      ],
      totals: { searches: 12, calls: 4, tokens: 33 }
    })
    expect(getKeyUsageForMonth(db, '2026-05')).toEqual({
      month: '2026-05',
      keys: [],
      totals: { searches: 0, calls: 0, tokens: 0 }
    })
    expect(() => getKeyUsageForMonth(db, '2026-13')).toThrow(/month/)
    expect(() => getKeyUsageForMonth(db, 'April')).toThrow(/month/)
  })

  test('counts rows with no project', () => {
    const db = memory()
    insertProject(db, project('project-1', 'textbolt'))
    insertApiKey(db, key('key-1', 'serpapi', 'citefox.serpapi.key-1', 0))
    insertKeyUsage(db, row('usage-1', 'key-1', 'project-1', '2026-10', 3, 0, 0))
    addKeyUsage(db, row('usage-2', 'key-1', null, '2026-10', 2, 0, 0))
    addKeyUsage(db, row('usage-3', 'key-1', null, '2026-10', 1, 0, 0))

    expect(getKeyUsageForMonth(db, '2026-10')).toEqual({
      month: '2026-10',
      keys: [
        {
          keyId: 'key-1',
          searches: 6,
          calls: 0,
          tokens: 0,
          projects: [
            { projectId: null, searches: 3, calls: 0, tokens: 0 },
            { projectId: 'project-1', searches: 3, calls: 0, tokens: 0 }
          ]
        }
      ],
      totals: { searches: 6, calls: 0, tokens: 0 }
    })
  })
})

function memory(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

function project(id: string, slug: string): ProjectRecord {
  return {
    id,
    name: slug,
    slug,
    domain: `${slug}.example`,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  }
}

function key(
  id: string,
  provider: 'serpapi' | 'jina',
  keychainRef: string,
  rotationOrder: number
): ApiKeyRecord {
  return {
    id,
    provider,
    name: id,
    keychainRef,
    rotationOrder,
    cap: 100,
    on: true,
    projectIds: [] as string[],
    hint: 'ab12',
    state: 'ok' as const,
    lastReason: null,
    serpapiUsage: null
  }
}

function row(
  id: string,
  keyId: string,
  projectId: string | null,
  month: string,
  searches: number,
  calls: number,
  tokens: number
): KeyUsageRecord {
  return { id, keyId, projectId, month, searches, calls, tokens }
}
