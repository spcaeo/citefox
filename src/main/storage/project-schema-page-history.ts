import type { Migration } from './migrate'

/**
 * Project migration 056 (after 054 fix verdicts and 055 check intervals):
 * page change history.
 *
 * - `page_reads`: every read of a tracked page: the snapshot it kept (a read of
 *   unchanged text keeps the earlier snapshot) and the dates the page stated that
 *   time. The blocks of each version are the snapshot's own text, so nothing is
 *   stored twice. Each page keeps the reads of its newest 24 versions.
 * - `page_changes`: a change seen between two reads that is more than noise
 *   (dates, spacing, the footer): its counts, the sections it touched, and whether
 *   someone said "Not a fix". A fix going live within 3 days of it links it; that
 *   is worked out when the list is read, so a fix logged later links it too.
 *
 * Existing snapshots become the first reads, so the next read compares against
 * the page as it was; old snapshot pairs raise no change (no flood on upgrade).
 */
export const PAGE_HISTORY_VERSION = 56

export const PAGE_HISTORY_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: PAGE_HISTORY_VERSION,
    name: `${String(PAGE_HISTORY_VERSION).padStart(3, '0')}_page_history`,
    up(db) {
      db.exec(`
        CREATE TABLE page_reads (
          id INTEGER PRIMARY KEY,
          page_id TEXT NOT NULL,
          snapshot_id TEXT NOT NULL CHECK (length(snapshot_id) BETWEEN 1 AND 80),
          read_at TEXT NOT NULL CHECK (length(read_at) > 0),
          published_at TEXT CHECK (published_at IS NULL OR length(published_at) BETWEEN 1 AND 40),
          modified_at TEXT CHECK (modified_at IS NULL OR length(modified_at) BETWEEN 1 AND 40),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        CREATE INDEX page_reads_by_page ON page_reads (page_id, read_at);

        CREATE TABLE page_changes (
          id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
          page_id TEXT NOT NULL,
          from_snapshot_id TEXT NOT NULL CHECK (length(from_snapshot_id) BETWEEN 1 AND 80),
          to_snapshot_id TEXT NOT NULL CHECK (length(to_snapshot_id) BETWEEN 1 AND 80),
          detected_at TEXT NOT NULL CHECK (length(detected_at) > 0),
          changed_at TEXT NOT NULL CHECK (length(changed_at) > 0),
          modified_at TEXT CHECK (modified_at IS NULL OR length(modified_at) BETWEEN 1 AND 40),
          previous_modified_at TEXT
            CHECK (previous_modified_at IS NULL OR length(previous_modified_at) BETWEEN 1 AND 40),
          sections_added INTEGER NOT NULL CHECK (sections_added >= 0),
          sections_removed INTEGER NOT NULL CHECK (sections_removed >= 0),
          headings_changed INTEGER NOT NULL CHECK (headings_changed >= 0),
          text_changed INTEGER NOT NULL CHECK (text_changed >= 0),
          sections_json TEXT NOT NULL
            CHECK (json_valid(sections_json) AND json_type(sections_json) = 'array'),
          dismissed_at TEXT CHECK (dismissed_at IS NULL OR length(dismissed_at) > 0),
          UNIQUE (page_id, to_snapshot_id),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        CREATE INDEX page_changes_by_page ON page_changes (page_id, changed_at);

        INSERT INTO page_reads (page_id, snapshot_id, read_at, published_at, modified_at)
        SELECT page_id, id, fetched_at,
          substr(NULLIF(published_at, ''), 1, 40), substr(NULLIF(modified_at, ''), 1, 40)
        FROM snapshots
        ORDER BY fetched_at, rowid;
      `)
    }
  }
]
