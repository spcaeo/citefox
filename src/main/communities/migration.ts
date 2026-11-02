import { hostOf, normalizeUrl } from '../engine/checks/url'
import type { SqliteDatabase } from '../storage/database'
import type { Migration } from '../storage/migrate'
import { sourceTypeOf } from './source-type'

/**
 * Project migration 21: Communities and YouTube opportunities (SRS §4.17, §4.18).
 *
 * - `video_ideas` is SRS section 10. Columns past `sent_to_foxcue_at` are approved
 *   extras: the parsed video id, the user's deadline, the FR-18.6 checklist, when
 *   tracking started (the "before" check of FR-18.7), and row times.
 * - `reddit_threads` caches public Reddit data per cited thread (FR-17.4).
 * - `youtube_videos` caches YouTube Data API details per video id (FR-11.9).
 * - `community_settings` is the project's own YouTube channel. One row.
 * - Stored references are reprocessed: YouTube URLs get the one `watch?v=<id>`
 *   form, and every `source_type` is recomputed with the FR-17.1 rules, so old
 *   checks count each video once and classify review sites and forums too.
 */
export const COMMUNITIES_MIGRATION: Migration = {
  version: 21,
  name: '021_communities_and_video_ideas',
  up(db) {
    db.exec(`
      CREATE TABLE video_ideas (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        page_id TEXT NOT NULL,
        prompt_ids TEXT NOT NULL,
        step TEXT NOT NULL,
        brief_json TEXT,
        storyboard_json TEXT,
        video_url TEXT,
        sent_to_foxcue_at TEXT,
        video_id TEXT,
        deadline TEXT,
        checklist_json TEXT NOT NULL DEFAULT '[]',
        tracking_started_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (length(id) > 0),
        CHECK (length(question) > 0),
        CHECK (step IN ('idea', 'brief', 'sent', 'published', 'tracking')),
        CHECK (json_valid(prompt_ids) AND json_type(prompt_ids) = 'array'),
        CHECK (brief_json IS NULL OR (json_valid(brief_json) AND json_type(brief_json) = 'object')),
        CHECK (
          storyboard_json IS NULL
          OR (json_valid(storyboard_json) AND json_type(storyboard_json) = 'array')
        ),
        CHECK (json_valid(checklist_json) AND json_type(checklist_json) = 'array'),
        CHECK (video_url IS NULL OR length(video_url) BETWEEN 1 AND 2000),
        CHECK (video_id IS NULL OR length(video_id) = 11),
        CHECK (deadline IS NULL OR length(deadline) = 10),
        CHECK (step NOT IN ('published', 'tracking') OR video_url IS NOT NULL),
        FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
      );
      CREATE INDEX idx_video_ideas_page ON video_ideas (page_id);
      CREATE INDEX idx_video_ideas_video ON video_ideas (video_id) WHERE video_id IS NOT NULL;

      CREATE TABLE reddit_threads (
        url TEXT PRIMARY KEY,
        thread_id TEXT,
        subreddit TEXT,
        title TEXT,
        comments INTEGER,
        upvotes INTEGER,
        archived INTEGER,
        locked INTEGER,
        posted_at TEXT,
        brand_named INTEGER,
        checked_at TEXT NOT NULL,
        error TEXT,
        CHECK (length(url) > 0),
        CHECK (comments IS NULL OR comments >= 0),
        CHECK (archived IS NULL OR archived IN (0, 1)),
        CHECK (locked IS NULL OR locked IN (0, 1)),
        CHECK (brand_named IS NULL OR brand_named IN (0, 1)),
        CHECK (length(checked_at) > 0)
      );

      CREATE TABLE youtube_videos (
        video_id TEXT PRIMARY KEY,
        title TEXT,
        channel_id TEXT,
        channel_title TEXT,
        views INTEGER,
        published_at TEXT,
        duration_seconds INTEGER,
        fetched_at TEXT NOT NULL,
        missing INTEGER NOT NULL DEFAULT 0,
        CHECK (length(video_id) = 11),
        CHECK (views IS NULL OR views >= 0),
        CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        CHECK (missing IN (0, 1)),
        CHECK (length(fetched_at) > 0)
      );

      CREATE TABLE community_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        youtube_channel TEXT,
        youtube_channel_id TEXT,
        updated_at TEXT NOT NULL,
        CHECK (youtube_channel IS NULL OR length(youtube_channel) BETWEEN 1 AND 200),
        CHECK (youtube_channel_id IS NULL OR length(youtube_channel_id) BETWEEN 1 AND 64)
      );

      CREATE INDEX idx_aio_references_source ON aio_references (source_type, normalized_url);
    `)
    reprocessReferences(db)
  }
}

interface ReferenceRow {
  id: string
  url: string
  normalized_url: string
  domain: string
  source_type: string
}

/** Recompute the stored URL form and source type of every reference. */
export function reprocessReferences(db: SqliteDatabase): number {
  const rows = db
    .prepare<unknown[], ReferenceRow>(
      'SELECT id, url, normalized_url, domain, source_type FROM aio_references'
    )
    .all()
  const update = db.prepare(
    'UPDATE aio_references SET normalized_url = ?, domain = ?, source_type = ? WHERE id = ?'
  )
  let changed = 0
  for (const row of rows) {
    const normalized = normalizeUrl(row.url) ?? row.normalized_url
    const domain = hostOf(normalized) || row.domain
    const sourceType = sourceTypeOf(normalized)
    if (
      normalized === row.normalized_url &&
      domain === row.domain &&
      sourceType === row.source_type
    ) {
      continue
    }
    update.run(normalized, domain, sourceType, row.id)
    changed += 1
  }
  return changed
}

/**
 * Project migration 26: Reddit thread excerpts (FR-17.3, FR-17.4). "Check
 * threads" keeps the title and top post (`excerpt`) and the first sentence
 * that names the brand (`brand_quote`) from the public JSON it already reads,
 * so "Brand in thread?" can show where and a reply draft knows the question.
 * Threads read before this stay null until the next Check threads.
 */
export const THREAD_EXCERPT_VERSION = 26

export const THREAD_EXCERPT_MIGRATION: Migration = {
  version: THREAD_EXCERPT_VERSION,
  name: `${String(THREAD_EXCERPT_VERSION).padStart(3, '0')}_reddit_thread_excerpts`,
  up(db) {
    db.exec(`
      ALTER TABLE reddit_threads ADD COLUMN excerpt TEXT
        CHECK (excerpt IS NULL OR length(excerpt) BETWEEN 1 AND 2000);
      ALTER TABLE reddit_threads ADD COLUMN brand_quote TEXT
        CHECK (brand_quote IS NULL OR length(brand_quote) BETWEEN 1 AND 1000);
    `)
  }
}
