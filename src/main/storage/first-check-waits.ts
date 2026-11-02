import type { SqliteDatabase } from './database'
import { runWrite } from './record-values'
import { assertId, requireUtcTimestamp } from './values'

/**
 * `first_check_waits` (project migration 033): pages whose first check waits for
 * the user's "Start first check". The due planner leaves their never-checked
 * markets alone, so automatic setup never spends a search on its own.
 */

/** Marks the page as waiting. A page already waiting keeps its first time. */
export function markFirstCheckWaits(db: SqliteDatabase, pageId: string, since: string): void {
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO first_check_waits (page_id, since) VALUES (?, ?)
           ON CONFLICT (page_id) DO NOTHING`
        )
        .run(assertId(pageId), requireUtcTimestamp(since)),
    'Could not save the first-check choice'
  )
}

/** Releases the page: its first check may run (Start first check, or check when ready). */
export function clearFirstCheckWaits(db: SqliteDatabase, pageId: string): boolean {
  return (
    db.prepare(`DELETE FROM first_check_waits WHERE page_id = ?`).run(assertId(pageId)).changes > 0
  )
}

/**
 * The page's own "Add and check now" (migration 042): its first check starts
 * once setup is ready. Kept on the page's wait row, so it outlives a restart.
 * False when the page is not waiting (it was checked, or never held).
 */
export function markCheckWhenReady(db: SqliteDatabase, pageId: string): boolean {
  let changes = 0
  runWrite(() => {
    changes = db
      .prepare(`UPDATE first_check_waits SET check_when_ready = 1 WHERE page_id = ?`)
      .run(assertId(pageId)).changes
  }, 'Could not save the first-check choice')
  return changes > 0
}

/** True when the page waits for its first check and was added with "Add and check now". */
export function pageCheckWhenReady(db: SqliteDatabase, pageId: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM first_check_waits WHERE page_id = ? AND check_when_ready = 1`)
      .get(assertId(pageId)) !== undefined
  )
}

export function firstCheckWaits(db: SqliteDatabase, pageId: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM first_check_waits WHERE page_id = ?`).get(assertId(pageId)) !==
    undefined
  )
}

/** Every waiting page id, for the due planner (one query per project). */
export function listFirstCheckWaits(db: SqliteDatabase): Set<string> {
  return new Set(
    db
      .prepare<unknown[], { page_id: string }>(`SELECT page_id FROM first_check_waits`)
      .all()
      .map((row) => row.page_id)
  )
}

/** `project_options.check_when_ready`: start the first check once setup is ready. Default off. */
export function readCheckWhenReady(db: SqliteDatabase): boolean {
  const row = db
    .prepare<unknown[], { check_when_ready: number }>(
      `SELECT check_when_ready FROM project_options WHERE id = 1`
    )
    .get()
  return row?.check_when_ready === 1
}

export function writeCheckWhenReady(db: SqliteDatabase, on: boolean): void {
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO project_options (id, check_when_ready) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET check_when_ready = excluded.check_when_ready`
        )
        .run(on ? 1 : 0),
    'Could not save the project setting'
  )
}
