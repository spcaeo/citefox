import type { GridViewState } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { normalizeGridViewState } from './grid-view-state'
import { listIgnoredCitations, setCitationIgnored } from './ignored-citations'
import { ensureProjectSchema } from './project-profile'
import { PROJECT_MIGRATIONS } from './project-schema'
import { deleteSavedView, getSavedView, listSavedViews, saveView } from './saved-views'

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

const STATE: GridViewState = {
  search: 'pricing',
  filters: { status: ['tracked'], folder: ['blog', ''] },
  ranges: { score: { min: 20, below: null } },
  sort: [
    { key: 'folder', dir: 'asc' },
    { key: 'score', dir: 'desc' }
  ],
  hidden: ['citations'],
  widths: { page: 320, folder: 120 },
  density: 'compact',
  view: 'table',
  groupBy: 'status',
  treeBy: null,
  pageSize: 50
}

describe('saved views (FR-21.2)', () => {
  test('migration 019 creates saved_views and ignored_cited_urls', () => {
    const db = projectDb()
    const names = db
      .prepare<unknown[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((row) => row.name)
    expect(names).toEqual(expect.arrayContaining(['saved_views', 'ignored_cited_urls']))
    const versions = PROJECT_MIGRATIONS.map((migration) => migration.version)
    expect(versions).toContain(19)
    expect(PROJECT_MIGRATIONS.find((item) => item.version === 19)?.name).toBe(
      '019_saved_views_and_ignored_citations'
    )
  })

  test('stores search, filters, sort, columns, density, view and widths, per grid', () => {
    const db = projectDb()
    const saved = saveView(db, {
      id: 'view-1',
      grid: 'all-pages',
      name: 'Money pages',
      state: STATE,
      at: '2026-10-19T12:00:00.000Z'
    })
    expect(saved.state).toEqual(STATE)
    saveView(db, {
      id: 'view-2',
      grid: 'report-schedules',
      name: 'Money pages',
      state: { ...STATE, view: 'cards' },
      at: '2026-10-19T12:00:01.000Z'
    })
    expect(listSavedViews(db, 'all-pages').map((view) => view.id)).toEqual(['view-1'])
    expect(listSavedViews(db, 'report-schedules').map((view) => view.state.view)).toEqual(['cards'])
  })

  test('overwrites by id, rejects a duplicate name in one grid, and deletes', () => {
    const db = projectDb()
    const base = { grid: 'all-pages', state: STATE, at: '2026-10-19T12:00:00.000Z' }
    saveView(db, { ...base, id: 'view-1', name: 'One' })
    saveView(db, { ...base, id: 'view-2', name: 'Two' })
    expect(() => saveView(db, { ...base, id: 'view-3', name: 'One' })).toThrow(/already exists/)
    const renamed = saveView(db, {
      ...base,
      id: 'view-1',
      name: 'Renamed',
      state: { ...STATE, density: 'comfortable' },
      at: '2026-10-20T08:00:00.000Z'
    })
    expect(renamed.name).toBe('Renamed')
    expect(renamed.createdAt).toBe('2026-10-19T12:00:00.000Z')
    expect(renamed.updatedAt).toBe('2026-10-20T08:00:00.000Z')
    expect(renamed.state.density).toBe('comfortable')
    expect(deleteSavedView(db, 'view-1')).toBe(true)
    expect(getSavedView(db, 'view-1')).toBeNull()
    expect(deleteSavedView(db, 'view-1')).toBe(false)
  })

  test('rejects a bad grid id, name, or state, and skips a stored row that no longer parses', () => {
    const db = projectDb()
    const base = { id: 'view-1', name: 'Ok', state: STATE, at: '2026-10-19T12:00:00.000Z' }
    expect(() => saveView(db, { ...base, grid: 'All Pages' })).toThrow(/Invalid grid/)
    expect(() => saveView(db, { ...base, grid: 'all-pages', name: ' padded ' })).toThrow()
    expect(() =>
      saveView(db, {
        ...base,
        grid: 'all-pages',
        state: { ...STATE, density: 'tiny' } as unknown as GridViewState
      })
    ).toThrow(/Invalid view state/)
    saveView(db, { ...base, grid: 'all-pages' })
    db.prepare(`UPDATE saved_views SET state_json = '{"search":1}' WHERE id = 'view-1'`).run()
    expect(listSavedViews(db, 'all-pages')).toEqual([])
  })
})

describe('normalizeGridViewState', () => {
  test('keeps a valid state, clamps widths, drops empty filters and unknown fields', () => {
    const state = normalizeGridViewState({
      ...STATE,
      filters: { status: ['tracked', 'tracked'], folder: [] },
      ranges: { score: { min: null, below: null } },
      widths: { page: 5000, folder: 10 },
      extra: 'ignored'
    })
    expect(state).toEqual({
      ...STATE,
      filters: { status: ['tracked'] },
      ranges: {},
      widths: { page: 960, folder: 48 }
    })
  })

  test('rejects wrong shapes', () => {
    expect(normalizeGridViewState(null)).toBeNull()
    expect(normalizeGridViewState({ ...STATE, pageSize: 30 })).toBeNull()
    expect(normalizeGridViewState({ ...STATE, view: 'list' })).toBeNull()
    expect(
      normalizeGridViewState({
        ...STATE,
        sort: [
          { key: 'a', dir: 'asc' },
          { key: 'a', dir: 'desc' }
        ]
      })
    ).toBeNull()
    expect(normalizeGridViewState({ ...STATE, hidden: ['bad key'] })).toBeNull()
    expect(normalizeGridViewState({ ...STATE, search: 'x'.repeat(301) })).toBeNull()
  })
})

describe('ignored citations (FR-20.5)', () => {
  test('ignores a URL and undoes it', () => {
    const db = projectDb()
    setCitationIgnored(db, {
      normalizedUrl: 'textbolt.com/login',
      url: 'https://textbolt.com/login',
      ignored: true,
      at: '2026-10-19T12:00:00.000Z'
    })
    setCitationIgnored(db, {
      normalizedUrl: 'textbolt.com/login',
      url: 'https://textbolt.com/login?utm=1',
      ignored: true,
      at: '2026-10-19T12:00:01.000Z'
    })
    expect([...listIgnoredCitations(db)]).toEqual(['textbolt.com/login'])
    setCitationIgnored(db, {
      normalizedUrl: 'textbolt.com/login',
      url: 'https://textbolt.com/login',
      ignored: false,
      at: '2026-10-19T12:00:02.000Z'
    })
    expect(listIgnoredCitations(db).size).toBe(0)
  })
})
