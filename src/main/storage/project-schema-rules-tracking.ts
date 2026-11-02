import type { Migration } from './migrate'

/**
 * Project migration 057 (after 056 page history): two owner decisions.
 *
 * - `tracking_changes`: what the owner changed in what CiteFox tracks (questions or
 *   keywords added or removed, an engine turned on or off, a market added, the check
 *   schedule changed), so the charts can mark a jump that came from tracking, not from
 *   a fix. One row per change; the charts group a day's rows into one marker.
 * - `project_rules`: the owner's standing rules for this project ("don't call us a
 *   cloud service"), saved from a setup card's Redo box or typed in Project settings.
 *   Every later AI prompt for the project carries the rules that are on.
 */
export const RULES_TRACKING_VERSION = 57

export const RULES_TRACKING_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: RULES_TRACKING_VERSION,
    name: `${String(RULES_TRACKING_VERSION).padStart(3, '0')}_rules_tracking`,
    up(db) {
      db.exec(`
        CREATE TABLE tracking_changes (
          id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
          at TEXT NOT NULL CHECK (length(at) > 0),
          kind TEXT NOT NULL CHECK (kind IN (
            'questions_added', 'questions_removed', 'engine_on', 'engine_off',
            'market_added', 'schedule_changed'
          )),
          page_id TEXT CHECK (page_id IS NULL OR length(page_id) BETWEEN 1 AND 80),
          count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
          detail TEXT CHECK (detail IS NULL OR length(detail) <= 200)
        );
        CREATE INDEX tracking_changes_by_at ON tracking_changes (at);

        CREATE TABLE project_rules (
          id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
          text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          created_at TEXT NOT NULL CHECK (length(created_at) > 0),
          updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
        );
      `)
    }
  }
]
