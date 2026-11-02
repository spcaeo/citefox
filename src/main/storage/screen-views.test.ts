import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { ensureProjectSchema } from './project-profile'
import { listSavedViews } from './saved-views'
import { getScreenView, setScreenView } from './screen-views'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  return db
}

describe('remembered screen views', () => {
  test('keeps one last view per screen and replaces it', () => {
    const db = projectDb()
    expect(getScreenView(db, 'topic')).toBeNull()
    setScreenView(db, 'topic', 'grid', '2026-10-29T10:00:00.000Z')
    setScreenView(db, 'pages', 'tree', '2026-10-29T10:00:00.000Z')
    expect(getScreenView(db, 'topic')).toBe('grid')
    setScreenView(db, 'topic', 'list', '2026-10-29T11:00:00.000Z')
    expect(getScreenView(db, 'topic')).toBe('list')
    expect(getScreenView(db, 'pages')).toBe('tree')
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM saved_views`).get() as { n: number }
    expect(rows.n).toBe(2)
  })

  test('never shows up as a saved grid view', () => {
    const db = projectDb()
    setScreenView(db, 'all-pages', 'tree', '2026-10-29T10:00:00.000Z')
    expect(listSavedViews(db, 'all-pages')).toEqual([])
    expect(listSavedViews(db, 'screen-all-pages')).toEqual([])
  })

  test('refuses bad screen keys and views', () => {
    const db = projectDb()
    expect(() => setScreenView(db, 'Topic', 'grid', '2026-10-29T10:00:00.000Z')).toThrow()
    expect(() => setScreenView(db, 'topic', 'grid view', '2026-10-29T10:00:00.000Z')).toThrow()
    expect(() => setScreenView(db, 'topic', 'grid', 'yesterday')).toThrow()
    expect(() => getScreenView(db, '../x')).toThrow()
  })

  test('reads a damaged row as no view', () => {
    const db = projectDb()
    db.prepare(
      `INSERT INTO saved_views (id, grid, name, state_json, created_at, updated_at)
       VALUES ('screen-view:topic', 'screen-topic', 'Last view', '{"screenView":"<b>"}', 'x', 'x')`
    ).run()
    expect(getScreenView(db, 'topic')).toBeNull()
  })
})
