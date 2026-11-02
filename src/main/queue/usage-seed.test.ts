import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import {
  addKeyUsage,
  insertApiKey,
  insertKeyUsage,
  insertProject,
  type ApiKeyRecord,
  type KeyUsageRecord,
  type ProjectRecord
} from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { UsageLedger, usageSeedFromStorage } from './usage'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('usage seed from storage', () => {
  test('seeds one row per key and project for the requested month', () => {
    const db = memory()
    insertProject(db, project('proj-1', 'textbolt'))
    insertProject(db, project('proj-2', 'client'))
    insertApiKey(db, key('key-1'))
    insertKeyUsage(db, row('usage-1', 'key-1', 'proj-1', '2026-04', 4))
    insertKeyUsage(db, row('usage-2', 'key-1', 'proj-2', '2026-04', 6))
    insertKeyUsage(db, row('usage-3', 'key-1', 'proj-1', '2026-03', 99))

    expect(usageSeedFromStorage(db, '2026-04').monthToDate()).toEqual([
      { keyId: 'key-1', projectId: 'proj-1', month: '2026-04', searches: 4 },
      { keyId: 'key-1', projectId: 'proj-2', month: '2026-04', searches: 6 }
    ])
    expect(usageSeedFromStorage(db, '2026-05').monthToDate()).toEqual([])
  })

  test('counts a row with no project toward the key and not a project', () => {
    const db = memory()
    insertProject(db, project('proj-1', 'textbolt'))
    insertApiKey(db, key('key-1'))
    addKeyUsage(db, row('usage-1', 'key-1', null, '2026-04', 3))
    insertKeyUsage(db, row('usage-2', 'key-1', 'proj-1', '2026-04', 4))

    const seed = usageSeedFromStorage(db, '2026-04').monthToDate()
    expect(seed).toEqual([
      { keyId: 'key-1', projectId: null, month: '2026-04', searches: 3 },
      { keyId: 'key-1', projectId: 'proj-1', month: '2026-04', searches: 4 }
    ])
    const ledger = new UsageLedger(seed)
    expect(ledger.keyUsed('key-1', '2026-04')).toBe(7)
    expect(ledger.projectUsed('proj-1', '2026-04')).toBe(4)
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

function key(id: string): ApiKeyRecord {
  return {
    id,
    provider: 'serpapi',
    name: id,
    keychainRef: `citefox.serpapi.${id}`,
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    hint: 'ab12',
    state: 'ok',
    lastReason: null,
    serpapiUsage: null
  }
}

function row(
  id: string,
  keyId: string,
  projectId: string | null,
  month: string,
  searches: number
): KeyUsageRecord {
  return { id, keyId, projectId, month, searches, calls: 0, tokens: 0 }
}
