import type { Migration } from './migrate'
import { MAX_PROMPT_COUNT } from './pages'

/**
 * Project migrations 027 and 028: topics (Docs/TOPICS-SPEC.md section 2).
 *
 * 027 rebuilds `pages` with a `kind` column (`page` for every existing row,
 * `topic` for a tracked subject with no single URL) and a nullable `url`. A
 * topic row has no URL; a page row still needs one. `UNIQUE (url)` stays: SQLite
 * lets several rows hold NULL in a unique column. Thirteen tables reference
 * `pages (id)` (several with ON DELETE CASCADE), so the rebuild runs with foreign
 * keys off (`foreignKeysOff`), copies every row and column, checks every
 * reference with `PRAGMA foreign_key_check` before the commit, and recreates
 * the pinned index. A copy of the file is kept first (`rebuildsTables`).
 *
 * 028 adds the topic side tables:
 * - `topics`: one row per topic page (seed, how it started, website, about, what
 *   to generate, depth settings and the two target bands).
 * - `topic_prompts`: one row per prompt in a topic's prompt set (kind, journey
 *   stage, source, keyword group, intent, funnel, page type, target page and the
 *   match). `stable_key` survives a new prompt-set version, so a target the user
 *   set and the progress line follow the same question across versions.
 * - `topic_drafts`: the Add wizard's state as JSON, so the wizard survives a restart.
 * - `topic_site_reads`: homepage, key pages and competitor pages read for the
 *   wizard (Jina or a direct read), cached per project. No SerpApi search.
 * - `topic_check_batches`: the "N now and the rest over 7 days" plan. Each row is
 *   one batch of prompts (by stable key) due on a day; a started batch keeps its job.
 *
 * 029 adds `topic_summaries`: the Claude summary line, executive summary and next
 * three actions written from saved results (`topic_summary`), one row per write.
 */
export const TOPIC_PAGES_VERSION = 27
export const TOPIC_TABLES_VERSION = 28
export const TOPIC_SUMMARIES_VERSION = 29

const STAGES = `'problem', 'options', 'doubts', 'fit', 'compare', 'decide'`
const PAGE_TYPES = `'landing page', 'blog', 'comparison page', 'listicle', 'glossary', 'product page'`

export const TOPIC_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: TOPIC_PAGES_VERSION,
    name: '027_page_kind_topic',
    rebuildsTables: true,
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE pages_next (
          id TEXT PRIMARY KEY,
          url TEXT,
          title TEXT,
          label TEXT,
          folder TEXT,
          status TEXT NOT NULL,
          interval_days INTEGER NOT NULL,
          samples INTEGER NOT NULL,
          prompt_count INTEGER NOT NULL,
          default_market_id TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          score REAL,
          pinned_at TEXT,
          kind TEXT NOT NULL DEFAULT 'page',
          CHECK (status IN ('not_tracked', 'setting_up', 'tracked', 'paused', 'removed')),
          CHECK (interval_days IN (14, 30, 60, 90)),
          CHECK (samples BETWEEN 1 AND 5),
          CHECK (prompt_count BETWEEN 1 AND ${MAX_PROMPT_COUNT}),
          CHECK (pinned IN (0, 1)),
          CHECK (kind IN ('page', 'topic')),
          CHECK (
            (kind = 'page' AND url IS NOT NULL AND length(url) > 0 AND length(url) <= 2000)
            OR (kind = 'topic' AND url IS NULL)
          ),
          CHECK (kind = 'page' OR (title IS NOT NULL AND length(trim(title)) > 0)),
          UNIQUE (url)
        );

        INSERT INTO pages_next (
          id, url, title, label, folder, status, interval_days, samples, prompt_count,
          default_market_id, pinned, score, pinned_at, kind
        )
        SELECT
          id, url, title, label, folder, status, interval_days, samples, prompt_count,
          default_market_id, pinned, score, pinned_at, 'page'
        FROM pages;

        DROP TABLE pages;
        ALTER TABLE pages_next RENAME TO pages;
        CREATE INDEX idx_pages_pinned ON pages (pinned);
        CREATE INDEX idx_pages_kind ON pages (kind);
      `)
    }
  },
  {
    version: TOPIC_TABLES_VERSION,
    name: '028_topics',
    up(db) {
      db.exec(`
        CREATE TABLE topics (
          page_id TEXT PRIMARY KEY,
          seed TEXT NOT NULL,
          source TEXT NOT NULL,
          competitor_url TEXT,
          website TEXT,
          about TEXT,
          generate TEXT NOT NULL DEFAULT 'questions',
          depth_json TEXT NOT NULL DEFAULT '{}',
          question_band_lo INTEGER NOT NULL DEFAULT 50,
          question_band_hi INTEGER NOT NULL DEFAULT 70,
          keyword_band_lo INTEGER NOT NULL DEFAULT 25,
          keyword_band_hi INTEGER NOT NULL DEFAULT 40,
          draft_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (length(seed) > 0 AND length(seed) <= 500),
          CHECK (source IN ('seed', 'questions', 'competitor')),
          CHECK (competitor_url IS NULL OR (length(competitor_url) > 0 AND length(competitor_url) <= 2000)),
          CHECK (website IS NULL OR length(website) <= 300),
          CHECK (about IS NULL OR length(about) <= 4000),
          CHECK (generate IN ('questions', 'keywords', 'both')),
          CHECK (json_valid(depth_json) AND json_type(depth_json) = 'object'),
          CHECK (question_band_lo BETWEEN 0 AND 100 AND question_band_hi BETWEEN 0 AND 100),
          CHECK (question_band_lo <= question_band_hi),
          CHECK (keyword_band_lo BETWEEN 0 AND 100 AND keyword_band_hi BETWEEN 0 AND 100),
          CHECK (keyword_band_lo <= keyword_band_hi),
          CHECK (length(created_at) > 0 AND length(updated_at) > 0),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );

        CREATE TABLE topic_prompts (
          prompt_id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          stable_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          stage TEXT,
          source TEXT NOT NULL,
          source_note TEXT,
          kw_group TEXT,
          kw_group_kind TEXT,
          intent TEXT,
          funnel TEXT,
          page_type TEXT,
          target_page_id TEXT,
          target_url TEXT,
          match_confidence INTEGER,
          match_reason TEXT,
          match_set_by TEXT,
          match_confirmed INTEGER NOT NULL DEFAULT 0,
          CHECK (length(stable_key) > 0),
          CHECK (kind IN ('question', 'keyword')),
          CHECK (stage IS NULL OR stage IN (${STAGES})),
          CHECK (source IN ('claude', 'imported', 'competitor', 'user')),
          CHECK (source_note IS NULL OR length(source_note) <= 500),
          CHECK (kw_group IS NULL OR (length(kw_group) > 0 AND length(kw_group) <= 120)),
          CHECK (kw_group_kind IS NULL OR kw_group_kind IN ('coverage', 'intent')),
          CHECK (intent IS NULL OR intent IN ('informational', 'commercial', 'navigational')),
          CHECK (funnel IS NULL OR funnel IN ('tofu', 'mofu', 'bofu')),
          CHECK (page_type IS NULL OR page_type IN (${PAGE_TYPES})),
          CHECK (target_url IS NULL OR (length(target_url) > 0 AND length(target_url) <= 2000)),
          CHECK (target_page_id IS NULL OR target_url IS NOT NULL),
          CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 100),
          CHECK (match_reason IS NULL OR length(match_reason) <= 500),
          CHECK (match_set_by IS NULL OR match_set_by IN ('claude', 'user')),
          CHECK (match_confirmed IN (0, 1)),
          FOREIGN KEY (prompt_id) REFERENCES prompts (id) ON DELETE CASCADE,
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE,
          FOREIGN KEY (target_page_id) REFERENCES pages (id)
        );
        CREATE INDEX idx_topic_prompts_page ON topic_prompts (page_id, stable_key);
        CREATE INDEX idx_topic_prompts_target ON topic_prompts (target_page_id)
          WHERE target_page_id IS NOT NULL;

        CREATE TABLE topic_drafts (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          step TEXT NOT NULL,
          topic_page_id TEXT,
          state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          discarded_at TEXT,
          CHECK (length(id) > 0),
          CHECK (path IN ('seed', 'questions', 'competitor')),
          CHECK (length(step) > 0 AND length(step) <= 40),
          CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
          CHECK (length(created_at) > 0 AND length(updated_at) > 0),
          FOREIGN KEY (topic_page_id) REFERENCES pages (id) ON DELETE SET NULL
        );
        CREATE INDEX idx_topic_drafts_open ON topic_drafts (updated_at)
          WHERE discarded_at IS NULL;

        CREATE TABLE topic_site_reads (
          url TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          ok INTEGER NOT NULL,
          title TEXT,
          meta_description TEXT,
          h1 TEXT,
          outline_json TEXT NOT NULL DEFAULT '[]',
          faq_count INTEGER NOT NULL DEFAULT 0,
          word_count INTEGER NOT NULL DEFAULT 0,
          text TEXT NOT NULL DEFAULT '',
          method TEXT,
          read_at TEXT NOT NULL,
          CHECK (length(url) > 0 AND length(url) <= 2000),
          CHECK (role IN ('home', 'pricing', 'features', 'faq', 'about', 'use_cases', 'other', 'competitor')),
          CHECK (ok IN (0, 1)),
          CHECK (json_valid(outline_json) AND json_type(outline_json) = 'array'),
          CHECK (faq_count >= 0 AND word_count >= 0),
          CHECK (method IS NULL OR method IN ('direct', 'jina', 'fixture')),
          CHECK (length(read_at) > 0)
        );

        CREATE TABLE topic_check_batches (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          batch_no INTEGER NOT NULL,
          market_ids TEXT NOT NULL,
          prompt_keys TEXT NOT NULL,
          due_at TEXT NOT NULL,
          job_id TEXT,
          started_at TEXT,
          cancelled_at TEXT,
          CHECK (batch_no >= 1),
          CHECK (json_valid(market_ids) AND json_type(market_ids) = 'array'),
          CHECK (json_valid(prompt_keys) AND json_type(prompt_keys) = 'array'),
          CHECK (json_array_length(prompt_keys) >= 1),
          CHECK (length(due_at) > 0),
          UNIQUE (page_id, batch_no),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_topic_batches_due ON topic_check_batches (due_at)
          WHERE started_at IS NULL AND cancelled_at IS NULL;
      `)
    }
  },
  {
    version: TOPIC_SUMMARIES_VERSION,
    name: '029_topic_summaries',
    up(db) {
      db.exec(`
        CREATE TABLE topic_summaries (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          run_id TEXT,
          line TEXT NOT NULL,
          executive TEXT NOT NULL,
          actions_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (length(line) > 0 AND length(line) <= 600),
          CHECK (length(executive) <= 3000),
          CHECK (json_valid(actions_json) AND json_type(actions_json) = 'array'),
          CHECK (length(created_at) > 0),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_topic_summaries_page ON topic_summaries (page_id, market_id, created_at);
      `)
    }
  }
]
