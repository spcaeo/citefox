import { afterEach, describe, expect, test } from 'vitest'
import { manualClock } from '../scheduler/clock'
import { monthKey } from '../scheduler/local-time'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import {
  insertApiKey,
  insertProject,
  type ApiKeyRecord,
  type ProjectRecord
} from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { createCheckQueue, type CheckQueue } from './check-queue'
import type { QueueWork } from './types'
import { persistCommittedSearch, usageSeedFromStorage } from './usage'

const NOW = Date.parse('2026-05-01T12:00:00.000Z')
const MONTH = monthKey(NOW, 'UTC')

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('committed searches and key_usage', () => {
  test('two writers commit together and a later sync keeps every search', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    insertProject(db, project())
    insertApiKey(db, key())
    const seenDuringWrite: number[] = []
    let watch: CheckQueue | null = null
    const write = persistCommittedSearch(db)
    const persistSearch: typeof write = (search) => {
      write(search)
      if (watch !== null) seenDuringWrite.push(projectUsed(watch))
    }
    const clock = manualClock(NOW)
    const tray = createCheckQueue({
      clock,
      timeZone: 'UTC',
      keys: [queueKey()],
      projects: [queueProject()],
      persistSearch
    })
    const headless = createCheckQueue({
      clock,
      timeZone: 'UTC',
      keys: [queueKey()],
      projects: [queueProject()],
      persistSearch
    })

    start(tray, 'tray-job', 2)
    start(headless, 'headless-job', 1)

    watch = tray
    expect(tray.takeKey('tray-job', 's0')).toMatchObject({ ok: true })
    expect(tray.commitSearch('tray-job', 's0')).toMatchObject({ ok: true, projectUsed: 1 })
    sync(headless, db)
    expect(projectUsed(headless)).toBe(1)

    watch = headless
    expect(headless.takeKey('headless-job', 's0')).toMatchObject({ ok: true })
    expect(headless.commitSearch('headless-job', 's0')).toMatchObject({
      ok: true,
      projectUsed: 2
    })
    sync(tray, db)
    expect(projectUsed(tray)).toBe(2)

    watch = tray
    expect(tray.takeKey('tray-job', 's1')).toMatchObject({ ok: true })
    expect(tray.commitSearch('tray-job', 's1')).toMatchObject({ ok: true, projectUsed: 3 })
    expect(tray.commitFollowUp('tray-job', 's1')).toMatchObject({ ok: true, projectUsed: 4 })
    sync(headless, db)
    expect(projectUsed(headless)).toBe(4)

    start(headless, 'headless-fail', 1)
    watch = headless
    expect(headless.takeKey('headless-fail', 's0')).toMatchObject({ ok: true })
    expect(
      headless.failSearch('headless-fail', 's0', { reason: 'failed', countFailedSearch: true })
    ).toMatchObject({ ok: false })
    expect(projectUsed(headless)).toBe(5)
    sync(tray, db)

    expect(seenDuringWrite).toEqual([0, 1, 2, 3, 4])
    expect(storedSearches(db)).toBe(5)
    expect(projectUsed(tray)).toBe(5)
    expect(projectUsed(headless)).toBe(5)
    expect(keyUsed(tray)).toBe(5)
    expect(keyUsed(headless)).toBe(5)
    expect(usageSeedFromStorage(db, MONTH).monthToDate()).toEqual([
      { keyId: 'key-1', projectId: 'proj-1', month: MONTH, searches: 5 }
    ])
  })
})

function start(queue: CheckQueue, id: string, maxSearches: number): void {
  queue.enqueue(work({ id, maxSearches }))
  const started = queue.dequeue()
  if (!started.ok) throw new Error(started.reason)
}

function sync(queue: CheckQueue, db: SqliteDatabase): void {
  queue.syncUsage(usageSeedFromStorage(db, MONTH).monthToDate())
}

function projectUsed(queue: CheckQueue): number {
  return queue.status().projects[0]?.used ?? 0
}

function keyUsed(queue: CheckQueue): number {
  return queue.status().keys[0]?.used ?? 0
}

function storedSearches(db: SqliteDatabase): number {
  const row = db.prepare('SELECT COALESCE(SUM(searches), 0) AS searches FROM key_usage').get() as {
    searches: number
  }
  return row.searches
}

function work(patch: Partial<QueueWork> = {}): QueueWork {
  const id = patch.id ?? 'job-1'
  return {
    id,
    projectId: 'proj-1',
    pageId: id,
    marketIds: ['us'],
    reason: 'scheduled',
    promptIds: null,
    needsClaude: false,
    maxSearches: 1,
    notBefore: new Date(NOW - 1).toISOString(),
    ...patch
  }
}

function queueKey(): {
  keyId: string
  name: string
  provider: 'serpapi'
  cap: null
  planLimit: null
  state: 'ok'
  rotationOrder: number
  projectIds: readonly string[]
} {
  return {
    keyId: 'key-1',
    name: 'Primary',
    provider: 'serpapi',
    cap: null,
    planLimit: null,
    state: 'ok',
    rotationOrder: 0,
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

function project(): ProjectRecord {
  return {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  }
}

function key(): ApiKeyRecord {
  return {
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
  }
}
