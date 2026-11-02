import type { Migration } from './migrate'

/**
 * Project migration 030: the first-run "Your site" plan (owner feedback 4).
 * One row: the last homework (sitemap sections, recommended pages and topics)
 * as JSON, so the start screen opens without a new Claude call. It follows
 * topic summaries (029).
 */
export const SITE_START_VERSION = 30

export const SITE_START_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: SITE_START_VERSION,
    name: `${String(SITE_START_VERSION).padStart(3, '0')}_site_start`,
    up(db) {
      db.exec(`
        CREATE TABLE site_start (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          plan_json TEXT NOT NULL,
          built_at TEXT NOT NULL,
          CHECK (json_valid(plan_json) AND json_type(plan_json) = 'object'),
          CHECK (length(built_at) > 0)
        );
      `)
    }
  }
]

/**
 * Project migration 032: edits the user made along the first-run journey
 * (while the autopilot ran, on "What we found" and on the plan). One row per
 * edit, in order; `undone_at` marks an undone edit; `parent_id` ties a
 * follow-up CiteFox made (a rewritten question) to the edit that caused it.
 */
export const SITE_START_EDITS_VERSION = 32

export const SITE_START_EDIT_MIGRATIONS: readonly Migration[] = [
  {
    version: SITE_START_EDITS_VERSION,
    name: `${String(SITE_START_EDITS_VERSION).padStart(3, '0')}_site_start_edits`,
    up(db) {
      db.exec(`
        CREATE TABLE site_start_edits (
          id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          edit_json TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL,
          undone_at TEXT,
          parent_id TEXT,
          system INTEGER NOT NULL DEFAULT 0,
          CHECK (json_valid(edit_json) AND json_type(edit_json) = 'object'),
          CHECK (length(summary) BETWEEN 1 AND 300),
          CHECK (length(created_at) > 0),
          CHECK (system IN (0, 1))
        );
        CREATE INDEX idx_site_start_edits_seq ON site_start_edits (seq);
      `)
    }
  }
]
