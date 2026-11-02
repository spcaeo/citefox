import type { Migration } from './migrate'

/**
 * Project migration 025: automatic exports to a folder (FR-22.6). It follows
 * background page setup (024).
 */
export const AUTO_EXPORT_VERSION = 25

export const AUTO_EXPORT_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: AUTO_EXPORT_VERSION,
    name: `${String(AUTO_EXPORT_VERSION).padStart(3, '0')}_auto_exports`,
    up(db) {
      // `auto_exports`: one row per Export screen scope. `scope_key` is '' for the
      // project default and the page id for a page's Export screen. `folder` is an
      // absolute path the user picked in the native folder dialog; the renderer
      // never sends one. `spec_json` is the `ExportSpec` repeated after every
      // scheduled check (no logo bytes). It is null until the first save.
      // `auto_export_runs`: one row per attempt, newest kept (history is trimmed
      // per scope, never the files). `outcome` is `ok` or `failed`; `reason` and
      // `next_step` are plain words, redacted before they are stored.
      db.exec(`
        CREATE TABLE auto_exports (
          scope_key TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          destination TEXT NOT NULL DEFAULT 'folder',
          folder TEXT,
          spec_json TEXT,
          updated_at TEXT NOT NULL,
          CHECK (enabled IN (0, 1)),
          CHECK (destination IN ('folder', 'email')),
          CHECK (folder IS NULL OR (length(folder) > 0 AND length(folder) <= 4096)),
          CHECK (length(updated_at) > 0)
        );

        CREATE TABLE auto_export_runs (
          id TEXT PRIMARY KEY,
          scope_key TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          outcome TEXT NOT NULL,
          format TEXT NOT NULL,
          filename TEXT,
          bytes INTEGER,
          reason TEXT,
          next_step TEXT,
          CHECK (length(id) > 0),
          CHECK (outcome IN ('ok', 'failed')),
          CHECK (filename IS NULL OR length(filename) <= 512),
          CHECK (bytes IS NULL OR bytes >= 0),
          CHECK (reason IS NULL OR length(reason) <= 500),
          CHECK (next_step IS NULL OR length(next_step) <= 300)
        );
        CREATE INDEX idx_auto_export_runs_scope ON auto_export_runs (scope_key, finished_at);
      `)
    }
  }
]
