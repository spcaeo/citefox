import type { Migration } from './migrate'

/**
 * Project migration 18: site structure (SRS 4.19, FR-20.6, section 10).
 *
 * Section 10 tables: `sitemaps`, `clusters`, `cluster_pages`, `groups`,
 * `group_pages`. `sitemaps.sync_rules_json` is kept for a per-sitemap rule
 * override; v1 leaves it NULL and reads the project rules from
 * `sitemap_settings`.
 *
 * Approved extras, the same way `generations` is:
 * - `sitemap_settings`: one row of FR-19.2 rules and the last sync time.
 * - `sitemap_entries`: one row per page URL a sitemap listed, with its
 *   `lastmod`, so a sync can tell new, removed, and changed pages apart.
 * - `sitemap_syncs`: FR-19.3 reports (the latest few are kept).
 * - `cluster_snapshots`: the previous clusters, saved for undo (FR-19.4).
 * - `silos`: per-folder settings (FR-19.6). Folders themselves come from URLs.
 * - `structure_state`: when and how pages were last clustered.
 *
 * `clusters.made_by` adds `rules` (no Claude) to the SRS `claude` and `user`.
 * A page is in at most one cluster (`cluster_pages.page_id` is unique) and in
 * any number of groups. Page ids are not foreign keys so a removed page's
 * history stays.
 */
export const STRUCTURE_MIGRATION: Migration = {
  version: 18,
  name: '018_site_structure',
  up(db) {
    db.exec(`
      CREATE TABLE sitemaps (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        parent_id TEXT,
        kind TEXT NOT NULL DEFAULT 'unknown',
        source TEXT NOT NULL,
        included INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'pending',
        last_read TEXT,
        last_changed TEXT,
        page_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        sync_rules_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (url),
        CHECK (length(url) BETWEEN 1 AND 2000),
        CHECK (kind IN ('index', 'urlset', 'unknown')),
        CHECK (source IN ('robots', 'guess', 'index', 'user')),
        CHECK (included IN (0, 1)),
        CHECK (state IN ('pending', 'read', 'error')),
        CHECK (page_count >= 0),
        CHECK (sync_rules_json IS NULL OR json_valid(sync_rules_json))
      );

      CREATE TABLE sitemap_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        frequency TEXT NOT NULL,
        on_new TEXT NOT NULL,
        on_removed TEXT NOT NULL,
        on_changed TEXT NOT NULL,
        last_sync_at TEXT,
        CHECK (frequency IN ('daily', 'weekly', 'manual')),
        CHECK (on_new IN ('add_untracked', 'track_default', 'ask')),
        CHECK (on_removed IN ('pause', 'delete')),
        CHECK (on_changed IN ('reread_gaps', 'reread', 'nothing'))
      );

      CREATE TABLE sitemap_entries (
        url TEXT PRIMARY KEY,
        sitemap_id TEXT NOT NULL,
        page_id TEXT,
        lastmod TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        removed_at TEXT,
        CHECK (length(url) BETWEEN 1 AND 2000)
      );
      CREATE INDEX idx_sitemap_entries_page ON sitemap_entries (page_id);
      CREATE INDEX idx_sitemap_entries_sitemap ON sitemap_entries (sitemap_id);

      CREATE TABLE sitemap_syncs (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        status TEXT NOT NULL,
        new_count INTEGER NOT NULL,
        removed_count INTEGER NOT NULL,
        changed_count INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        CHECK (trigger IN ('first_read', 'manual', 'scheduled')),
        CHECK (status IN ('ok', 'partial', 'error')),
        CHECK (new_count >= 0 AND removed_count >= 0 AND changed_count >= 0),
        CHECK (json_valid(report_json) AND json_type(report_json) = 'object')
      );
      CREATE INDEX idx_sitemap_syncs_started ON sitemap_syncs (started_at);

      CREATE TABLE clusters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pillar_page_id TEXT,
        made_by TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        renamed_by_user INTEGER NOT NULL DEFAULT 0,
        edited_by_user INTEGER NOT NULL DEFAULT 0,
        track_whole INTEGER NOT NULL DEFAULT 0,
        topic_key TEXT,
        themes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        CHECK (length(name) BETWEEN 1 AND 120),
        CHECK (made_by IN ('rules', 'claude', 'user')),
        CHECK (version >= 1),
        CHECK (renamed_by_user IN (0, 1)),
        CHECK (edited_by_user IN (0, 1)),
        CHECK (track_whole IN (0, 1)),
        CHECK (json_valid(themes_json) AND json_type(themes_json) = 'array')
      );

      CREATE TABLE cluster_pages (
        cluster_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        role TEXT NOT NULL,
        moved_by_user INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (cluster_id, page_id),
        UNIQUE (page_id),
        CHECK (role IN ('pillar', 'supporting', 'orphan')),
        CHECK (moved_by_user IN (0, 1)),
        FOREIGN KEY (cluster_id) REFERENCES clusters (id) ON DELETE CASCADE
      );

      CREATE TABLE cluster_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taken_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        body_json TEXT NOT NULL,
        CHECK (json_valid(body_json) AND json_type(body_json) = 'object')
      );

      CREATE TABLE structure_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_clustered_at TEXT,
        last_cluster_method TEXT,
        CHECK (last_cluster_method IS NULL OR last_cluster_method IN ('topic', 'queries', 'links'))
      );

      CREATE TABLE silos (
        path TEXT PRIMARY KEY,
        track_all INTEGER NOT NULL DEFAULT 0,
        market_ids_json TEXT,
        CHECK (length(path) BETWEEN 1 AND 500 AND substr(path, 1, 1) = '/'),
        CHECK (track_all IN (0, 1)),
        CHECK (market_ids_json IS NULL OR (json_valid(market_ids_json) AND json_type(market_ids_json) = 'array'))
      );

      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        CHECK (length(name) BETWEEN 1 AND 80),
        CHECK (note IS NULL OR length(note) <= 300)
      );

      CREATE TABLE group_pages (
        group_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (group_id, page_id),
        FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE
      );
      CREATE INDEX idx_group_pages_page ON group_pages (page_id);
    `)
  }
}
