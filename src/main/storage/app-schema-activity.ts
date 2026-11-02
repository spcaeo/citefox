import type { Migration } from './migrate'

/**
 * App migration 018 (projects-at-scale): timestamped provider activity for
 * Connections' last 24 hours (FR-11.10) and Claude calls per project (FR-10.6).
 * Spread into `APP_MIGRATIONS` after the scheduling migrations.
 */
export const ACTIVITY_APP_MIGRATIONS: readonly Migration[] = [
  // ---- App migration 018: activity events (projects-at-scale) ----------------------------
  {
    version: 18,
    name: '018_activity_events',
    up(db) {
      // One row per SerpApi capture (count = searches it spent), Claude call, or Jina read,
      // plus Claude limit and fallback events and Jina failovers in plain words.
      // key_id is an api_keys id or NULL (Claude Code, keyless Jina). It is not a foreign
      // key: a removed key keeps its history. A deleted project's rows keep counting
      // toward the key with project_id set to NULL. Never a secret, never a prompt.
      db.exec(`
        CREATE TABLE activity_events (
          id TEXT PRIMARY KEY,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          key_id TEXT,
          project_id TEXT,
          count INTEGER NOT NULL DEFAULT 1,
          detail TEXT,
          CHECK (kind IN (
            'search', 'claude_call', 'jina_read', 'claude_limit', 'claude_fallback', 'jina_failover'
          )),
          CHECK (length(at) > 0),
          CHECK (key_id IS NULL OR length(key_id) > 0),
          CHECK (project_id IS NULL OR length(project_id) > 0),
          CHECK (count >= 1),
          CHECK (detail IS NULL OR length(detail) <= 500),
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
        );

        CREATE INDEX idx_activity_events_at ON activity_events (at);
        CREATE INDEX idx_activity_events_kind_at ON activity_events (kind, at);
      `)
    }
  }
]
