import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'

/**
 * App migration 021 `setup_runner`. The default rate sets up 2,000 imported pages
 * in about a week, the same window first checks are staggered over (SCH-12),
 * at three or four Claude calls a page.
 */
export const DEFAULT_SETUP_PAGES_PER_HOUR = 12
export const MAX_SETUP_PAGES_PER_HOUR = 200

export interface SetupRunnerSettings {
  paused: boolean
  pagesPerHour: number
}

export function readSetupRunnerSettings(db: SqliteDatabase): SetupRunnerSettings {
  const row = db
    .prepare<unknown[], { paused: number; pages_per_hour: number }>(
      `SELECT paused, pages_per_hour FROM setup_runner WHERE id = 1`
    )
    .get()
  if (row === undefined) return { paused: false, pagesPerHour: DEFAULT_SETUP_PAGES_PER_HOUR }
  return { paused: row.paused === 1, pagesPerHour: row.pages_per_hour }
}

export function writeSetupRunnerSettings(db: SqliteDatabase, settings: SetupRunnerSettings): void {
  const rate = settings.pagesPerHour
  if (!Number.isInteger(rate) || rate < 1 || rate > MAX_SETUP_PAGES_PER_HOUR) {
    throw new StorageError('Invalid pages per hour')
  }
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO setup_runner (id, paused, pages_per_hour) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             paused = excluded.paused, pages_per_hour = excluded.pages_per_hour`
        )
        .run(settings.paused ? 1 : 0, rate),
    'Could not save the setup settings'
  )
}
