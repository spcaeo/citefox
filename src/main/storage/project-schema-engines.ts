import type { Migration } from './migrate'

/**
 * Project migration 045: multi-engine tracking (Google AI Overview, ChatGPT, Perplexity,
 * Google AI Mode, Gemini, Copilot), cloro as a provider, and credits and cost per check.
 *
 * - `serp_results.engine` is `google_aio` on every row, old and new: Google AI Overview
 *   samples stay in this table whichever provider ran them, so every screen reading it is
 *   unchanged. `provider` is `serpapi` on old rows. `credits` (cloro's charge) and
 *   `cost_micros` (USD × 1,000,000 at the plan in effect) are 0 on old rows.
 *   `aio_markdown` is cloro's overview as markdown.
 * - `brand_captures.credits` and `cost_micros`: what a brand prompt search spent.
 * - `runs.engines_json`: the engines the check ran, `["google_aio"]` on old rows.
 *   `runs.google_aio` is 1 when Google AI Overview was one of them; the Google views
 *   read only those runs, so a check of other engines alone moves no Google number.
 * - `check_jobs.provider`, `credits_used`, `cost_micros`: who ran the job's Google search
 *   (null on old rows: SerpApi) and what the job spent.
 * - `engine_answers` and `engine_sources`: one answer engine's reply per run, question,
 *   sample and engine, and the sources it cited. `status` is cited, named, not_cited,
 *   no_answer, unavailable or error (see `EngineAnswerStatus`).
 * - `engine_settings` (one row): the engines the project checks and its provider choice.
 *   No row means Google AI Overview only, provider `auto`: what every project did before.
 * - `page_engines`: a page's or topic's own engines, over the project's.
 */
export const ENGINES_VERSION = 45

const ANSWER_ENGINES = `'chatgpt', 'perplexity', 'google_ai_mode', 'gemini', 'copilot'`

export const ENGINES_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: ENGINES_VERSION,
    name: `${String(ENGINES_VERSION).padStart(3, '0')}_engines`,
    up(db) {
      db.exec(`
        ALTER TABLE serp_results ADD COLUMN engine TEXT NOT NULL DEFAULT 'google_aio'
          CHECK (engine = 'google_aio');
        ALTER TABLE serp_results ADD COLUMN provider TEXT NOT NULL DEFAULT 'serpapi'
          CHECK (provider IN ('serpapi', 'cloro'));
        ALTER TABLE serp_results ADD COLUMN credits INTEGER NOT NULL DEFAULT 0
          CHECK (credits >= 0);
        ALTER TABLE serp_results ADD COLUMN cost_micros INTEGER NOT NULL DEFAULT 0
          CHECK (cost_micros >= 0);
        ALTER TABLE serp_results ADD COLUMN aio_markdown TEXT;

        ALTER TABLE brand_captures ADD COLUMN credits INTEGER NOT NULL DEFAULT 0
          CHECK (credits >= 0);
        ALTER TABLE brand_captures ADD COLUMN cost_micros INTEGER NOT NULL DEFAULT 0
          CHECK (cost_micros >= 0);

        ALTER TABLE runs ADD COLUMN engines_json TEXT NOT NULL DEFAULT '["google_aio"]'
          CHECK (json_valid(engines_json) AND json_type(engines_json) = 'array');
        ALTER TABLE runs ADD COLUMN google_aio INTEGER NOT NULL DEFAULT 1
          CHECK (google_aio IN (0, 1));

        ALTER TABLE check_jobs ADD COLUMN provider TEXT
          CHECK (provider IS NULL OR provider IN ('serpapi', 'cloro'));
        ALTER TABLE check_jobs ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0
          CHECK (credits_used >= 0);
        ALTER TABLE check_jobs ADD COLUMN cost_micros INTEGER NOT NULL DEFAULT 0
          CHECK (cost_micros >= 0);

        CREATE TABLE engine_answers (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          sample_no INTEGER NOT NULL,
          engine TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'cloro',
          key_id TEXT,
          status TEXT NOT NULL,
          cited_url TEXT,
          position INTEGER,
          named INTEGER NOT NULL DEFAULT 0,
          answer_text TEXT,
          answer_markdown TEXT,
          error_code TEXT,
          message TEXT,
          searches INTEGER NOT NULL DEFAULT 0,
          credits INTEGER NOT NULL DEFAULT 0,
          cost_micros INTEGER NOT NULL DEFAULT 0,
          raw_json TEXT,
          checked_at TEXT NOT NULL,
          UNIQUE (run_id, prompt_id, sample_no, engine),
          CHECK (sample_no BETWEEN 1 AND 5),
          CHECK (engine IN (${ANSWER_ENGINES})),
          CHECK (provider = 'cloro'),
          CHECK (status IN ('cited', 'named', 'not_cited', 'no_answer', 'unavailable', 'error')),
          CHECK (named IN (0, 1)),
          CHECK (position IS NULL OR position >= 1),
          CHECK (searches >= 0),
          CHECK (credits >= 0),
          CHECK (cost_micros >= 0),
          CHECK (status <> 'unavailable' OR credits = 0),
          CHECK (status = 'cited' OR cited_url IS NULL),
          CHECK (length(checked_at) > 0),
          FOREIGN KEY (run_id) REFERENCES runs (id)
        );

        CREATE TABLE engine_sources (
          id TEXT PRIMARY KEY,
          answer_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL,
          domain TEXT NOT NULL,
          title TEXT,
          classification TEXT NOT NULL,
          CHECK (position >= 1),
          CHECK (classification IN ('target', 'own', 'competitor', 'other')),
          FOREIGN KEY (answer_id) REFERENCES engine_answers (id) ON DELETE CASCADE
        );

        CREATE TABLE engine_settings (
          id INTEGER PRIMARY KEY,
          engines_json TEXT NOT NULL DEFAULT '["google_aio"]',
          provider TEXT NOT NULL DEFAULT 'auto',
          updated_at TEXT NOT NULL,
          CHECK (id = 1),
          CHECK (json_valid(engines_json) AND json_type(engines_json) = 'array'),
          CHECK (provider IN ('auto', 'cloro', 'serpapi'))
        );

        CREATE TABLE page_engines (
          page_id TEXT PRIMARY KEY,
          engines_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (json_valid(engines_json) AND json_type(engines_json) = 'array'),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );

        CREATE INDEX idx_engine_answers_run ON engine_answers (run_id, prompt_id, engine);
        CREATE INDEX idx_engine_answers_prompt ON engine_answers (prompt_id, engine);
        CREATE INDEX idx_engine_sources_answer ON engine_sources (answer_id, position);
        CREATE INDEX idx_runs_google ON runs (page_id, market_id, google_aio, started_at);
      `)
    }
  }
]
