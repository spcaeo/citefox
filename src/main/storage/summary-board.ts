import { normalizeBoard, type SummaryBoard } from '@shared/summary-board'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp } from './values'

/**
 * The project's Summary widgets, kept in `saved_views` (migration 019) so no new table
 * is needed: one row, id `summary-board`, grid `summary-board`, state the board JSON.
 * Saved grid views never list it (their grid ids differ).
 */
const ROW_ID = 'summary-board'
const GRID = 'summary-board'
const NAME = 'Summary widgets'

/** The saved board, or null when there is none (or it no longer parses). */
export function getSummaryBoard(db: SqliteDatabase): SummaryBoard | null {
  const row = db
    .prepare<unknown[], { state_json: string }>(`SELECT state_json FROM saved_views WHERE id = ?`)
    .get(ROW_ID)
  if (row === undefined) return null
  try {
    return normalizeBoard(JSON.parse(row.state_json))
  } catch {
    return null
  }
}

/** Saves `board` (normalized first) and returns what was saved. */
export function setSummaryBoard(db: SqliteDatabase, board: unknown, at: string): SummaryBoard {
  const clean = normalizeBoard(board)
  if (clean === null) throw new StorageError('Invalid Summary board')
  const when = requireUtcTimestamp(at)
  db.prepare(
    `INSERT INTO saved_views (id, grid, name, state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(ROW_ID, GRID, NAME, JSON.stringify(clean), when, when)
  return clean
}
