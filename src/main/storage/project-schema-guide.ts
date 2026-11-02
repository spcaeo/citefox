import type { Migration } from './migrate'

/**
 * Project migration 049: the first-run guide's progress (src/shared/guide.ts).
 *
 * - `guide_steps`: one row per step the user saw, did or skipped. No row is not started.
 * - `guide_signals`: real things that happened once (a target page saved, a competitor
 *   marked), so a step done before the guide reached it is already ticked.
 * - `guide_explainers`: screens whose "What is this page?" card was closed.
 * - `guide_state`: the one row with the step the guide is on, where the user left a
 *   step half-way (an in-app hash, never a web address), Hide guide, Turn tips off and
 *   the kick-off card. No row is a guide that never started.
 *
 * Restart deletes every row of the four tables. Timestamps are ISO-8601 UTC.
 */
export const GUIDE_VERSION = 49

export const GUIDE_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: GUIDE_VERSION,
    name: `${String(GUIDE_VERSION).padStart(3, '0')}_guide`,
    up(db) {
      db.exec(`
        CREATE TABLE guide_steps (
          step_id TEXT PRIMARY KEY CHECK (length(step_id) BETWEEN 1 AND 80),
          state TEXT NOT NULL CHECK (state IN ('shown', 'done', 'skipped')),
          updated_at TEXT NOT NULL
        );
        CREATE TABLE guide_signals (
          signal TEXT PRIMARY KEY CHECK (length(signal) BETWEEN 1 AND 80),
          first_at TEXT NOT NULL
        );
        CREATE TABLE guide_explainers (
          screen TEXT PRIMARY KEY CHECK (length(screen) BETWEEN 1 AND 80),
          seen_at TEXT NOT NULL
        );
        CREATE TABLE guide_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          current_step TEXT CHECK (current_step IS NULL OR length(current_step) BETWEEN 1 AND 80),
          paused_step TEXT CHECK (paused_step IS NULL OR length(paused_step) BETWEEN 1 AND 80),
          paused_route TEXT CHECK (paused_route IS NULL OR length(paused_route) BETWEEN 2 AND 2000),
          paused_at TEXT,
          hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
          tips_off INTEGER NOT NULL DEFAULT 0 CHECK (tips_off IN (0, 1)),
          kickoff TEXT NOT NULL DEFAULT 'none'
            CHECK (kickoff IN ('none', 'offered', 'started', 'later')),
          updated_at TEXT NOT NULL,
          CHECK ((paused_step IS NULL) = (paused_route IS NULL))
        );
      `)
    }
  }
]
