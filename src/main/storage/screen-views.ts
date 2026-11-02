import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp } from './values'

/**
 * The view a screen was last shown in (Tree, Grid, List, Pages, Progress), per
 * project and per screen, kept in `saved_views` (migration 019) so no new
 * table is needed. One row per screen: grid `screen-<screen>`, id
 * `screen-view:<screen>`, state `{"screenView":"<view>"}`. Saved grid views
 * never list these rows: their grid ids differ and the state is not a grid
 * state, so `listSavedViews` skips it.
 */
export const SCREEN_KEY_PATTERN = /^[a-z][a-z0-9-]{0,47}$/
export const SCREEN_VIEW_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const NAME = 'Last view'

function rowId(screen: string): string {
  return `screen-view:${screen}`
}

function requireScreen(screen: string): string {
  if (typeof screen !== 'string' || !SCREEN_KEY_PATTERN.test(screen)) {
    throw new StorageError('Invalid screen')
  }
  return screen
}

/** The screen's last view, or null when it has none (or the stored one no longer parses). */
export function getScreenView(db: SqliteDatabase, screen: string): string | null {
  const row = db
    .prepare<unknown[], { state_json: string }>(`SELECT state_json FROM saved_views WHERE id = ?`)
    .get(rowId(requireScreen(screen)))
  if (row === undefined) return null
  try {
    const value = (JSON.parse(row.state_json) as { screenView?: unknown }).screenView
    return typeof value === 'string' && SCREEN_VIEW_PATTERN.test(value) ? value : null
  } catch {
    return null
  }
}

/** Remembers `view` as the screen's last view. */
export function setScreenView(
  db: SqliteDatabase,
  screen: string,
  view: string,
  at: string
): string {
  const key = requireScreen(screen)
  if (typeof view !== 'string' || !SCREEN_VIEW_PATTERN.test(view)) {
    throw new StorageError('Invalid view')
  }
  const when = requireUtcTimestamp(at)
  db.prepare(
    `INSERT INTO saved_views (id, grid, name, state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(rowId(key), `screen-${key}`, NAME, JSON.stringify({ screenView: view }), when, when)
  return view
}
