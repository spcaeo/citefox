import type { Migration } from './migrate'

/**
 * Project migration 033: automatic page setup (owner feedback 5).
 *
 * - `first_check_waits`: one row per page whose first check waits for the user's
 *   "Start first check". A page added on its own is set up by the background
 *   runner (read, buyer profile, prompts, content gaps) without spending a
 *   search; the due planner leaves its never-checked markets alone while the row
 *   exists. The row goes when a check starts for the page, or when the project
 *   checks automatically once setup is ready.
 * - `project_options.check_when_ready`: the project's "check automatically when
 *   ready" choice, off by default.
 */
export const AUTO_SETUP_VERSION = 33

export const AUTO_SETUP_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: AUTO_SETUP_VERSION,
    name: `${String(AUTO_SETUP_VERSION).padStart(3, '0')}_auto_setup`,
    up(db) {
      db.exec(`
        CREATE TABLE first_check_waits (
          page_id TEXT PRIMARY KEY,
          since TEXT NOT NULL,
          CHECK (length(since) > 0),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        ALTER TABLE project_options ADD COLUMN check_when_ready INTEGER NOT NULL DEFAULT 0
          CHECK (check_when_ready IN (0, 1));
      `)
    }
  }
]
