import type { Migration } from './migrate'

/**
 * Project migration 048: the user's own word on cited sites (src/shared/site-overrides.ts).
 *
 * - `site_overrides`: one row per bare domain, with the type of site (a built-in type
 *   or `custom:<id>`) and the role ("Who it is") the user picked. Null in a column is
 *   automatic; a row with both null is deleted rather than kept.
 * - `custom_site_types`: the types of site the project added, each with a chip colour.
 *   Deleting one clears every override that used it (the storage does this, so the
 *   domains go back to automatic).
 *
 * Timestamps are ISO-8601 UTC.
 */
export const SITE_OVERRIDES_VERSION = 48

export const SITE_OVERRIDES_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: SITE_OVERRIDES_VERSION,
    name: `${String(SITE_OVERRIDES_VERSION).padStart(3, '0')}_site_overrides`,
    up(db) {
      db.exec(`
        CREATE TABLE site_overrides (
          domain TEXT PRIMARY KEY,
          site_type TEXT,
          role TEXT,
          updated_at TEXT NOT NULL,
          CHECK (length(domain) > 0 AND length(domain) <= 253),
          CHECK (site_type IS NULL OR (length(site_type) > 0 AND length(site_type) <= 80)),
          CHECK (role IS NULL OR role IN (
            'neutral', 'community', 'qa', 'social', 'video', 'encyclopedia', 'review', 'media'
          )),
          CHECK (site_type IS NOT NULL OR role IS NOT NULL),
          CHECK (length(updated_at) > 0)
        );
        CREATE TABLE custom_site_types (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tone TEXT NOT NULL DEFAULT 'neutral',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          CHECK (length(id) > 0 AND length(id) <= 64),
          CHECK (length(name) > 0 AND length(name) <= 40),
          CHECK (tone IN ('neutral', 'info', 'ok', 'warn', 'bad', 'fox')),
          CHECK (length(created_at) > 0)
        );
        CREATE UNIQUE INDEX custom_site_types_name ON custom_site_types (name COLLATE NOCASE);
      `)
    }
  }
]
