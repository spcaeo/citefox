import type { QueuePauseStore, StoredQueuePause } from '../queue/pause-store'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { requireLocalDate } from './values'

/**
 * SCH-11. The one `queue_pause` row (migration 016). No row means the queue
 * runs. The tray, the renderer, and `citefox --check-due` all read it, so a
 * pause holds across restarts and in the headless job.
 */
export function getQueuePause(db: SqliteDatabase): StoredQueuePause | null {
  const row = db
    .prepare<unknown[], { state: string; paused_on: string | null }>(
      `SELECT state, paused_on FROM queue_pause WHERE id = 1`
    )
    .get()
  if (row === undefined) return null
  if (row.state === 'paused_all') return { state: 'paused_all' }
  if (row.state === 'paused_today' && row.paused_on !== null) {
    return { state: 'paused_today', day: requireLocalDate(row.paused_on) }
  }
  throw new StorageError('Invalid queue pause')
}

/** Null clears the pause. */
export function setQueuePause(db: SqliteDatabase, pause: StoredQueuePause | null): void {
  try {
    if (pause === null) {
      db.prepare(`DELETE FROM queue_pause WHERE id = 1`).run()
      return
    }
    const day = pause.state === 'paused_today' ? requireLocalDate(pause.day) : null
    db.prepare(
      `INSERT INTO queue_pause (id, state, paused_on) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET state = excluded.state, paused_on = excluded.paused_on`
    ).run(pause.state, day)
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save queue pause')
    throw error
  }
}

export function sqliteQueuePauseStore(db: SqliteDatabase): QueuePauseStore {
  return {
    read: () => getQueuePause(db),
    write: (pause) => {
      setQueuePause(db, pause)
    }
  }
}
