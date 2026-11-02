import { StorageError } from './errors'
import type { Migration } from './migrate'

/**
 * App migrations 016 and later for the scheduler, queue, and usage tables.
 * Spread into `APP_MIGRATIONS` after 015.
 */
export const SCHEDULING_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 16,
    name: '016_queue_pause',
    up(db) {
      // SCH-11. Pause all and pause for today, shared by the tray and the
      // headless --check-due process. No row means the queue runs.
      // paused_on is the local date of a today-pause; it expires at midnight.
      db.exec(`
        CREATE TABLE queue_pause (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state TEXT NOT NULL,
          paused_on TEXT,
          CHECK (state IN ('paused_all', 'paused_today')),
          CHECK (
            (state = 'paused_all' AND paused_on IS NULL) OR
            (state = 'paused_today' AND paused_on IS NOT NULL AND length(paused_on) = 10)
          )
        );
      `)
    }
  },
  {
    version: 17,
    name: '017_usage_kept_and_project_delete',
    rebuildsTables: true,
    up(db) {
      // key_usage no longer references api_keys: removing a key keeps the
      // searches it spent, so project caps (FR-11.4) do not reset. A deleted
      // project's usage stays counted on its key (project_id set to NULL).
      // tray_history rows go with their project. Every row is copied.
      db.exec(`
        CREATE TABLE key_usage_017 (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          project_id TEXT,
          month TEXT NOT NULL,
          searches INTEGER NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          tokens INTEGER NOT NULL DEFAULT 0,
          CHECK (length(key_id) > 0),
          CHECK (searches >= 0),
          CHECK (calls >= 0),
          CHECK (tokens >= 0),
          CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          CHECK (project_id IS NULL OR length(project_id) > 0),
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
        );

        INSERT INTO key_usage_017 (id, key_id, project_id, month, searches, calls, tokens)
        SELECT id, key_id, project_id, month, searches, calls, tokens
        FROM key_usage ORDER BY rowid ASC;

        DROP TABLE key_usage;
        ALTER TABLE key_usage_017 RENAME TO key_usage;

        CREATE UNIQUE INDEX idx_key_usage_key_project_month
          ON key_usage (key_id, ifnull(project_id, ''), month);
        CREATE INDEX idx_key_usage_month ON key_usage (month);

        CREATE TABLE tray_history_017 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          label TEXT NOT NULL,
          score INTEGER,
          "change" INTEGER,
          finished_at TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(project_id) > 0),
          CHECK (length(page_id) > 0),
          CHECK (length(label) > 0 AND length(label) <= 300),
          CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
          CHECK ("change" IS NULL OR ("change" BETWEEN -100 AND 100)),
          CHECK (length(finished_at) > 0),
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

        INSERT INTO tray_history_017 (id, project_id, page_id, label, score, "change", finished_at)
        SELECT id, project_id, page_id, label, score, "change", finished_at
        FROM tray_history ORDER BY rowid ASC;

        DROP TABLE tray_history;
        ALTER TABLE tray_history_017 RENAME TO tray_history;

        CREATE INDEX idx_tray_history_finished ON tray_history (finished_at);
      `)
      const broken = db.prepare('PRAGMA foreign_key_check').all()
      if (broken.length > 0) throw new StorageError('Could not migrate key usage')
    }
  }
]
