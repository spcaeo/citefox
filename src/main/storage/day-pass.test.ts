import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { getDayPass, hasDayPass, setDayPass } from './day-pass'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('day pass', () => {
  test('stores a local-date marker the tray and a second process can share', () => {
    const db = memory()
    expect(hasDayPass(db, '2026-04-06')).toBe(false)
    expect(getDayPass(db, '2026-04-06')).toBeNull()
    setDayPass(db, '2026-04-06')
    expect(hasDayPass(db, '2026-04-06')).toBe(true)
    expect(hasDayPass(db, '2026-04-07')).toBe(false)
    expect(getDayPass(db, '2026-04-06')).toEqual({ day: '2026-04-06', jobIds: [], pages: 0 })

    setDayPass(db, '2026-04-06', {
      jobIds: ['due:2026-04-06:project-1:page-1:scheduled:mkt-us:'],
      pages: 1
    })
    expect(getDayPass(db, '2026-04-06')).toEqual({
      day: '2026-04-06',
      jobIds: ['due:2026-04-06:project-1:page-1:scheduled:mkt-us:'],
      pages: 1
    })
    setDayPass(db, '2026-04-07', { jobIds: [], pages: 0 })
    expect(hasDayPass(db, '2026-04-06')).toBe(true)
    expect(getDayPass(db, '2026-04-07')?.pages).toBe(0)
  })

  test('rejects a date that is not a real local calendar day', () => {
    const db = memory()
    expect(() => setDayPass(db, '2026-02-31')).toThrow(/local date/)
    expect(() => setDayPass(db, '06-04-2026')).toThrow(/local date/)
    expect(() => hasDayPass(db, '2026-04-06T00:00:00.000Z')).toThrow(/local date/)
    expect(getDayPass(db, '2026-04-06')).toBeNull()
  })
})

function memory(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}
