import {
  GRID_ID_PATTERN,
  SAVED_VIEW_NAME_MAX,
  type GridViewState,
  type SavedGridView
} from '@shared/domain'
import { normalizeGridViewState } from './grid-view-state'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, requireLabel, requireUtcTimestamp } from './values'

/**
 * Section 10 `saved_views` in the project file (FR-21.2). One row per view.
 * Names are unique per grid. A stored state that no longer parses is skipped
 * on read, so one bad row cannot hide the others.
 */
export interface NewSavedView {
  id: string
  grid: string
  name: string
  state: GridViewState
  at: string
}

export function listSavedViews(db: SqliteDatabase, grid: string): SavedGridView[] {
  const id = requireGrid(grid)
  return db
    .prepare<unknown[], SavedViewSql>(
      `SELECT id, grid, name, state_json, created_at, updated_at
         FROM saved_views WHERE grid = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(id)
    .flatMap((row) => {
      const view = fromSql(row)
      return view === null ? [] : [view]
    })
}

export function getSavedView(db: SqliteDatabase, id: string): SavedGridView | null {
  assertId(id)
  const row = db
    .prepare<unknown[], SavedViewSql>(
      `SELECT id, grid, name, state_json, created_at, updated_at FROM saved_views WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : fromSql(row)
}

/** Inserts the view, or replaces name and state when `id` already exists in that grid. */
export function saveView(db: SqliteDatabase, input: NewSavedView): SavedGridView {
  const id = assertId(input.id)
  const grid = requireGrid(input.grid)
  const name = requireLabel(input.name, 'view name', SAVED_VIEW_NAME_MAX)
  const at = requireUtcTimestamp(input.at)
  const state = normalizeGridViewState(input.state)
  if (state === null) throw new StorageError('Invalid view state')
  const existing = getSavedView(db, id)
  if (existing !== null && existing.grid !== grid) throw new StorageError('Unknown view')
  try {
    if (existing === null) {
      db.prepare(
        `INSERT INTO saved_views (id, grid, name, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, grid, name, JSON.stringify(state), at, at)
    } else {
      db.prepare(
        `UPDATE saved_views SET name = ?, state_json = ?, updated_at = ? WHERE id = ?`
      ).run(name, JSON.stringify(state), at, id)
    }
  } catch (error) {
    if (isSqliteError(error) && error.message.includes('UNIQUE')) {
      throw new StorageError('A view with this name already exists')
    }
    throw new StorageError('Could not save the view')
  }
  const saved = getSavedView(db, id)
  if (saved === null) throw new StorageError('Could not save the view')
  return saved
}

export function deleteSavedView(db: SqliteDatabase, id: string): boolean {
  assertId(id)
  return db.prepare(`DELETE FROM saved_views WHERE id = ?`).run(id).changes > 0
}

function requireGrid(value: string): string {
  if (typeof value !== 'string' || !GRID_ID_PATTERN.test(value)) {
    throw new StorageError('Invalid grid')
  }
  return value
}

interface SavedViewSql {
  id: string
  grid: string
  name: string
  state_json: string
  created_at: string
  updated_at: string
}

function fromSql(row: SavedViewSql): SavedGridView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.state_json)
  } catch {
    return null
  }
  const state = normalizeGridViewState(parsed)
  if (state === null) return null
  return {
    id: row.id,
    grid: row.grid,
    name: row.name,
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
