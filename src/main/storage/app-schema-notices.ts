import type { Migration } from './migrate'

/**
 * App migration 021: "ask me" notices (FR-11.4, FR-11.7) and the background
 * setup runner's settings (FR-20.6, SCH-12). It follows the template editor's
 * app migration 020.
 */
export const NOTICES_APP_VERSION = 21

export const NOTICES_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: NOTICES_APP_VERSION,
    name: `${String(NOTICES_APP_VERSION).padStart(3, '0')}_notices_and_setup_runner`,
    up(db) {
      // One open notice per `dedupe_key` (a cap notice once per project and month,
      // a Claude notice once per project until it is answered). `actions_json` is the
      // list of { id, label, primary } choices; `data_json` is what the chosen action
      // needs (project id, month). Plain words only: never a secret or a prompt.
      // `setup_runner` is one row: the pause switch and the pages-per-hour throttle.
      db.exec(`
        CREATE TABLE notices (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          project_id TEXT,
          dedupe_key TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          actions_json TEXT NOT NULL,
          data_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolution TEXT,
          CHECK (length(kind) BETWEEN 1 AND 40),
          CHECK (length(dedupe_key) BETWEEN 1 AND 200),
          CHECK (length(title) BETWEEN 1 AND 200),
          CHECK (length(body) <= 1000),
          CHECK (json_valid(actions_json) AND json_type(actions_json) = 'array'),
          CHECK (json_valid(data_json) AND json_type(data_json) = 'object'),
          CHECK (length(created_at) > 0),
          CHECK ((resolved_at IS NULL) = (resolution IS NULL)),
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX idx_notices_open_key ON notices (dedupe_key) WHERE resolved_at IS NULL;
        CREATE INDEX idx_notices_created ON notices (created_at);

        CREATE TABLE setup_runner (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          paused INTEGER NOT NULL DEFAULT 0,
          pages_per_hour INTEGER NOT NULL,
          CHECK (paused IN (0, 1)),
          CHECK (pages_per_hour BETWEEN 1 AND 200)
        );
      `)
    }
  }
]
