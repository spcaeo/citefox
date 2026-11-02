import type { Migration } from './migrate'

/**
 * Project migration 051: saved page fix briefs (Fixes › What to fix).
 *
 * - `page_fix_briefs`: the last brief CiteFox AI wrote for a page fix, kept so the
 *   fix's Status reads "Brief ready" and its drawer shows the brief again. The key
 *   is the page fix's opaque id (`pageFixIdOf`), stable while its page and topics
 *   stay the same. `brief_json` is the brief as the drawer shows it (title, summary,
 *   items, the text "Log a fix" hands on). A new brief for the same fix replaces it.
 */
export const PAGE_FIX_BRIEFS_VERSION = 51

export const PAGE_FIX_BRIEFS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: PAGE_FIX_BRIEFS_VERSION,
    name: `${String(PAGE_FIX_BRIEFS_VERSION).padStart(3, '0')}_page_fix_briefs`,
    up(db) {
      db.exec(`
        CREATE TABLE page_fix_briefs (
          fix_id TEXT PRIMARY KEY CHECK (length(fix_id) BETWEEN 1 AND 80),
          brief_json TEXT NOT NULL CHECK (length(brief_json) BETWEEN 2 AND 40000),
          saved_at TEXT NOT NULL CHECK (length(saved_at) > 0)
        );
      `)
    }
  }
]
