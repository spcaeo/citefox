import type { Migration } from './migrate'

/**
 * Project migration 053: saved page comparisons (Fixes › What to fix › Pick which
 * page owns it › Why Google picks).
 *
 * - `owner_whys`: the last comparison CiteFox AI wrote for an owner fix: the
 *   verdict, what the answer needs, what the cited page has and the content changes.
 *   The key is the page fix's opaque id (`pageFixIdOf`), like `page_edits`. A new
 *   one for the same fix replaces it.
 */
export const OWNER_WHYS_VERSION = 53

export const OWNER_WHYS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: OWNER_WHYS_VERSION,
    name: `${String(OWNER_WHYS_VERSION).padStart(3, '0')}_owner_whys`,
    up(db) {
      db.exec(`
        CREATE TABLE owner_whys (
          fix_id TEXT PRIMARY KEY CHECK (length(fix_id) BETWEEN 1 AND 80),
          why_json TEXT NOT NULL CHECK (length(why_json) BETWEEN 2 AND 200000),
          saved_at TEXT NOT NULL CHECK (length(saved_at) > 0)
        );
      `)
    }
  }
]
