import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { ensureProjectSchema } from './project-profile'
import { listSavedViews } from './saved-views'
import { getSummaryBoard, setSummaryBoard } from './summary-board'

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

const AT = '2026-11-01T10:00:00.000Z'

describe('Summary board storage', () => {
  test('keeps one board per project file and replaces it', () => {
    const db = projectDb()
    expect(getSummaryBoard(db)).toBeNull()
    setSummaryBoard(
      db,
      {
        version: 1,
        preset: 'executive',
        widgets: [{ id: 'w1', kind: 'cited-rate', size: 's', engine: 'chatgpt', config: {} }]
      },
      AT
    )
    expect(getSummaryBoard(db)?.widgets.map((widget) => widget.engine)).toEqual(['chatgpt'])
    setSummaryBoard(db, { version: 1, preset: null, widgets: [] }, AT)
    expect(getSummaryBoard(db)).toEqual({ version: 1, preset: null, widgets: [] })
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM saved_views`).get() as { n: number }
    expect(rows.n).toBe(1)
  })

  test('drops widgets that do not parse and refuses a non-board', () => {
    const db = projectDb()
    const saved = setSummaryBoard(
      db,
      {
        version: 1,
        preset: 'nope',
        widgets: [
          { id: 'a', kind: 'headline', size: 'w', engine: 'all', config: { label: ' Hi ' } },
          { id: 'a', kind: 'trend', size: 'l', engine: 'all', config: {} },
          { id: 'b', kind: 'mystery', size: 'w', engine: 'all', config: {} },
          { id: 'c', kind: 'trend', size: 'x', engine: 'all', config: {} },
          { id: 'd', kind: 'competitor', size: 'm', engine: 'bing', config: { domain: 'A.com' } }
        ]
      },
      AT
    )
    expect(saved.preset).toBeNull()
    expect(saved.widgets.map((widget) => widget.id)).toEqual(['a', 'd'])
    expect(saved.widgets[0]?.config.label).toBe('Hi')
    expect(saved.widgets[1]).toMatchObject({ engine: 'all', config: { domain: 'a.com' } })
    expect(() => setSummaryBoard(db, { version: 2, widgets: [] }, AT)).toThrow()
  })

  test('never shows up as a saved grid view', () => {
    const db = projectDb()
    setSummaryBoard(db, { version: 1, preset: null, widgets: [] }, AT)
    expect(listSavedViews(db, 'summary-board')).toEqual([])
  })
})
