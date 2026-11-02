import type { Migration } from './migrate'

/**
 * Project migration 037: `site_kinds`, the kind of site Claude gave a cited domain once
 * (Docs/REPORT-SPEC.md "Who else the AI answers cite"). One row per bare domain; it is
 * never asked again. Saved competitors and the built-in list of well-known hosts are
 * decided at read time and are not stored here. `sorted_at` is ISO-8601 UTC.
 */
export const SITE_KINDS_VERSION = 37

export const SITE_KINDS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: SITE_KINDS_VERSION,
    name: `${String(SITE_KINDS_VERSION).padStart(3, '0')}_site_kinds`,
    up(db) {
      db.exec(`
        CREATE TABLE site_kinds (
          domain TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          sorted_at TEXT NOT NULL,
          CHECK (length(domain) > 0 AND length(domain) <= 253),
          CHECK (kind IN ('video_social', 'analysts_media', 'big_tech', 'services', 'other')),
          CHECK (length(sorted_at) > 0)
        );
      `)
    }
  }
]
