import { randomUUID } from 'node:crypto'
import { isTrackingChangeKind, type TrackingChange, type TrackingChangeKind } from '@shared/ipc'
import type { SqliteDatabase } from './database'

/**
 * Changes to what a project tracks (project migration 057), recorded where they are
 * saved: a page's or topic's questions (`insertPromptSet`, `activatePromptSet`), the
 * project's engines (`saveEngineSettings`), a market (`insertMarket`) and the check
 * schedule (`writeProjectSchedule`). The charts mark them in grey.
 *
 * Recording never fails the save it follows: a project file from before 057, or any
 * other write problem, records nothing.
 */

/** Rows kept per project; the oldest go first. */
export const TRACKING_CHANGES_KEPT = 2000

export interface NewTrackingChange {
  at: string
  kind: TrackingChangeKind
  pageId?: string | null
  count?: number
  detail?: string | null
}

export function recordTrackingChange(db: SqliteDatabase, change: NewTrackingChange): void {
  const count = Math.max(1, Math.round(change.count ?? 1))
  const detail = change.detail ? change.detail.slice(0, 200) : null
  try {
    db.prepare(
      `INSERT INTO tracking_changes (id, at, kind, page_id, count, detail) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(`tc-${randomUUID()}`, change.at, change.kind, change.pageId ?? null, count, detail)
    db.prepare(
      `DELETE FROM tracking_changes WHERE id IN (
         SELECT id FROM tracking_changes ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`
    ).run(TRACKING_CHANGES_KEPT)
  } catch {
    // A file from before 057, or a full disk: the save itself still stands.
  }
}

/**
 * Records what a page's questions gained and lost: `before` and `after` are the
 * texts that are on in its active set before and after the save.
 */
export function recordQuestionChanges(
  db: SqliteDatabase,
  pageId: string,
  before: readonly string[],
  after: readonly string[],
  at: string
): void {
  const key = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLowerCase()
  const was = new Set(before.map(key))
  const now = new Set(after.map(key))
  const added = [...now].filter((text) => !was.has(text)).length
  const removed = [...was].filter((text) => !now.has(text)).length
  if (added > 0) recordTrackingChange(db, { at, kind: 'questions_added', pageId, count: added })
  if (removed > 0) {
    recordTrackingChange(db, { at, kind: 'questions_removed', pageId, count: removed })
  }
}

interface ChangeSql {
  id: string
  at: string
  kind: string
  page_id: string | null
  count: number
  detail: string | null
}

/** Every change, oldest first. */
export function listTrackingChanges(db: SqliteDatabase): TrackingChange[] {
  let rows: ChangeSql[]
  try {
    rows = db
      .prepare<unknown[], ChangeSql>(
        `SELECT id, at, kind, page_id, count, detail FROM tracking_changes ORDER BY at, rowid`
      )
      .all()
  } catch {
    return []
  }
  return rows.flatMap((row) =>
    isTrackingChangeKind(row.kind)
      ? [
          {
            id: row.id,
            at: row.at,
            kind: row.kind,
            pageId: row.page_id,
            count: row.count,
            detail: row.detail
          }
        ]
      : []
  )
}
