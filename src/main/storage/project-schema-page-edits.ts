import type { Migration } from './migrate'

/**
 * Project migration 052: saved page edits (Fixes › What to fix › Page edits).
 *
 * - `page_edits`: the last page-with-edits CiteFox AI wrote for a page fix: the
 *   page's blocks as read, the suggested changes (struck out, added) and a summary
 *   line. The key is the page fix's opaque id (`pageFixIdOf`), like
 *   `page_fix_briefs`. A new one for the same fix replaces it.
 */
export const PAGE_EDITS_VERSION = 52

export const PAGE_EDITS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: PAGE_EDITS_VERSION,
    name: `${String(PAGE_EDITS_VERSION).padStart(3, '0')}_page_edits`,
    up(db) {
      db.exec(`
        CREATE TABLE page_edits (
          fix_id TEXT PRIMARY KEY CHECK (length(fix_id) BETWEEN 1 AND 80),
          edit_json TEXT NOT NULL CHECK (length(edit_json) BETWEEN 2 AND 1000000),
          saved_at TEXT NOT NULL CHECK (length(saved_at) > 0)
        );
      `)
    }
  }
]
