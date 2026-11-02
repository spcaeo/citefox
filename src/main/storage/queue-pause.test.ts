import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { getQueuePause, setQueuePause, sqliteQueuePauseStore } from './queue-pause'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('queue pause row', () => {
  test('stores pause all, pause today with its day, and a resume', () => {
    const db = memory()
    expect(getQueuePause(db)).toBeNull()
    setQueuePause(db, { state: 'paused_all' })
    expect(getQueuePause(db)).toEqual({ state: 'paused_all' })
    setQueuePause(db, { state: 'paused_today', day: '2026-05-01' })
    expect(getQueuePause(db)).toEqual({ state: 'paused_today', day: '2026-05-01' })
    setQueuePause(db, null)
    expect(getQueuePause(db)).toBeNull()
  })

  test('the store adapter reads the row every time, so another process is seen', () => {
    const db = memory()
    const store = sqliteQueuePauseStore(db)
    setQueuePause(db, { state: 'paused_all' })
    expect(store.read()).toEqual({ state: 'paused_all' })
    store.write(null)
    expect(getQueuePause(db)).toBeNull()
  })

  test('rejects a today-pause without a real local date', () => {
    const db = memory()
    expect(() => setQueuePause(db, { state: 'paused_today', day: '2026-02-31' })).toThrow(
      /local date/
    )
    expect(getQueuePause(db)).toBeNull()
  })
})

function memory(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}
