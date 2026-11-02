import { afterEach, describe, expect, test, vi } from 'vitest'
import { manualClock } from '../scheduler/clock'
import { monthKey } from '../scheduler/local-time'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { addKeyUsage, insertApiKey, insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { createCheckQueue } from './check-queue'
import { applyCheckResult } from './runner'
import type { QueueKeyInput, QueueWork } from './types'
import { usageSeedFromStorage } from './usage'

const NOW = Date.parse('2026-05-01T12:00:00.000Z')
const MONTH = monthKey(NOW, 'UTC')
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('searches the runner already charged', () => {
  test('count on the key that made the search and are not written twice', () => {
    const persistSearch = vi.fn()
    const queue = createCheckQueue({
      clock: manualClock(NOW),
      timeZone: 'UTC',
      keys: [queueKey('key-1', 0), queueKey('key-2', 1)],
      projects: [queueProject()],
      persistSearch
    })
    queue.enqueue(work({ maxSearches: 1 }))
    const started = queue.dequeue()
    if (!started.ok) throw new Error(started.reason)
    // The queue reserved key-1, but key-1 failed and the search went to key-2.
    const applied = applyCheckResult(queue, started.job, {
      outcome: 'ok',
      searches: [{ slotId: 'search-1', keyId: 'key-2' }]
    })
    expect(applied).toMatchObject({ outcome: 'ok', searchesCommitted: 1, capBlocked: false })
    const used = Object.fromEntries(queue.status().keys.map((key) => [key.keyId, key.used]))
    expect(used).toEqual({ 'key-1': 0, 'key-2': 1 })
    expect(queue.status().projects[0]?.used).toBe(1)
    expect(persistSearch).not.toHaveBeenCalled()
  })

  test('a usage sync while the check runs does not count the search twice', () => {
    const db = seededDb()
    const seed = usageSeedFromStorage(db, MONTH)
    const queue = createCheckQueue({
      clock: manualClock(NOW),
      timeZone: 'UTC',
      keys: [queueKey('key-1', 0)],
      projects: [queueProject()],
      usageSeed: seed.monthToDate()
    })
    queue.enqueue(work({ maxSearches: 1 }))
    const started = queue.dequeue()
    if (!started.ok) throw new Error(started.reason)
    // The engine writes key_usage as the search is made (a crash cannot lose it).
    addKeyUsage(db, {
      id: 'u-1',
      keyId: 'key-1',
      projectId: 'proj-1',
      month: MONTH,
      searches: 1,
      calls: 1,
      tokens: 0
    })
    // The tray refreshes its status while the check is still running.
    queue.syncUsage(seed.monthToDate())
    applyCheckResult(queue, started.job, {
      outcome: 'ok',
      searches: [{ slotId: 'search-1', keyId: 'key-1' }]
    })
    queue.syncUsage(seed.monthToDate())
    expect(queue.status().keys[0]?.used).toBe(1)
    expect(queue.status().projects[0]?.used).toBe(1)
  })

  test('the stored month is read on every call, not pinned when the store is made', () => {
    const db = seededDb()
    let month = '2026-04'
    const seed = usageSeedFromStorage(db, () => month)
    addKeyUsage(db, {
      id: 'u-1',
      keyId: 'key-1',
      projectId: 'proj-1',
      month: '2026-05',
      searches: 3,
      calls: 3,
      tokens: 0
    })
    expect(seed.monthToDate()).toEqual([])
    month = '2026-05'
    expect(seed.monthToDate()).toEqual([
      { keyId: 'key-1', projectId: 'proj-1', month: '2026-05', searches: 3 }
    ])
  })
})

function seededDb(): SqliteDatabase {
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
  insertApiKey(db, {
    id: 'key-1',
    provider: 'serpapi',
    name: 'Primary',
    keychainRef: 'citefox.serpapi.key-1',
    hint: 'ab12',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null
  })
  return db
}

function work(patch: Partial<QueueWork> = {}): QueueWork {
  return {
    id: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    marketIds: ['us'],
    reason: 'scheduled',
    promptIds: null,
    needsClaude: false,
    maxSearches: 1,
    notBefore: new Date(NOW - 1).toISOString(),
    ...patch
  }
}

function queueKey(keyId: string, rotationOrder: number): QueueKeyInput {
  return {
    keyId,
    name: keyId,
    provider: 'serpapi',
    cap: null,
    planLimit: null,
    state: 'ok',
    rotationOrder,
    projectIds: []
  }
}

function queueProject(): {
  projectId: string
  name: string
  cap: null
  capRule: 'pause'
  dedicatedKeyId: null
  paused: false
} {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false
  }
}
