import type { Migration } from './migrate'

/**
 * Project migration 020: brand sentiment (SRS 4.16, section 10).
 *
 * - `brand_prompts`: versioned per page. Saving creates the next version; past
 *   captures keep the prompt row they searched. One row per language and position.
 * - `brand_facts`: project-level short true statements (FR-16.6).
 * - `brand_captures`: one SerpApi capture of a brand prompt in a run (1 sample).
 *   Kept apart from `serp_results`, so brand prompts can never enter visibility
 *   counts (FR-16.1). Searches still count toward the job and key usage.
 * - `sentiment_reads`: one Claude reading of one overview (a buyer `serp_results`
 *   row or a `brand_captures` row). `aio_hash` and `input_hash` make a re-read of
 *   an unchanged overview free (NFR-7). `capture_id` has no foreign key because
 *   it points at one of two tables; `source` says which.
 * - `claims`: section 10 `claims`. `serp_result_id` or `brand_capture_id` is set,
 *   never both. Rows go with their reading.
 *
 * `generations` is rebuilt so its kind check accepts `brand_prompts` and
 * `sentiment_claims` (and later kinds; the kind is validated in code). Because
 * `analyses.generation_id` references `generations`, `analyses` is copied aside
 * and rebuilt with the same definition and indexes. Every row is kept.
 */
export const SENTIMENT_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: 20,
    name: '020_brand_sentiment',
    rebuildsTables: true,
    up(db) {
      db.exec(`
        CREATE TABLE analyses_020 AS SELECT * FROM analyses;
        DROP TABLE analyses;

        CREATE TABLE generations_020 (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          template_id TEXT NOT NULL,
          template_hash TEXT NOT NULL,
          started_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL,
          cache_creation_tokens INTEGER NOT NULL,
          serpapi_searches INTEGER NOT NULL,
          model TEXT,
          connection TEXT NOT NULL,
          ok INTEGER NOT NULL,
          error TEXT,
          input_hash TEXT NOT NULL,
          output_json TEXT,
          CHECK (length(kind) > 0 AND length(kind) <= 40),
          CHECK (connection IN ('claude-code', 'anthropic-api')),
          CHECK (length(template_hash) = 64),
          CHECK (length(started_at) > 0),
          CHECK (duration_ms >= 0),
          CHECK (input_tokens >= 0),
          CHECK (output_tokens >= 0),
          CHECK (cache_read_tokens >= 0),
          CHECK (cache_creation_tokens >= 0),
          CHECK (serpapi_searches >= 0),
          CHECK (ok IN (0, 1)),
          CHECK (length(input_hash) = 64),
          CHECK (ok = 0 OR output_json IS NOT NULL),
          FOREIGN KEY (page_id) REFERENCES pages (id)
        );
        INSERT INTO generations_020 SELECT
          id, page_id, kind, template_id, template_hash, started_at, duration_ms,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
          model, connection, ok, error, input_hash, output_json
        FROM generations;
        DROP TABLE generations;
        ALTER TABLE generations_020 RENAME TO generations;
        CREATE INDEX idx_generations_input ON generations (kind, input_hash, ok);

        CREATE TABLE analyses (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          snapshot_id TEXT,
          kind TEXT NOT NULL,
          prompt_id TEXT,
          body_json TEXT NOT NULL,
          template_hash TEXT NOT NULL,
          done INTEGER NOT NULL,
          market_id TEXT,
          generation_id TEXT,
          CHECK (length(id) > 0),
          CHECK (kind IN ('gap_matrix', 'aio_gap', 'summary')),
          CHECK (
            (run_id IS NOT NULL AND snapshot_id IS NULL)
            OR (run_id IS NULL AND snapshot_id IS NOT NULL)
          ),
          CHECK (run_id IS NULL OR length(run_id) > 0),
          CHECK (snapshot_id IS NULL OR length(snapshot_id) > 0),
          CHECK (prompt_id IS NULL OR length(prompt_id) > 0),
          CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
          CHECK (length(template_hash) = 64),
          CHECK (done IN (0, 1)),
          CHECK (market_id IS NULL OR length(market_id) > 0),
          CHECK (run_id IS NULL OR market_id IS NOT NULL),
          CHECK (generation_id IS NULL OR length(generation_id) > 0),
          FOREIGN KEY (run_id) REFERENCES runs (id),
          FOREIGN KEY (snapshot_id) REFERENCES snapshots (id),
          FOREIGN KEY (prompt_id) REFERENCES prompts (id),
          FOREIGN KEY (generation_id) REFERENCES generations (id)
        );
        INSERT INTO analyses (
          id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done,
          market_id, generation_id
        )
        SELECT
          id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done,
          market_id, generation_id
        FROM analyses_020;
        DROP TABLE analyses_020;
        CREATE INDEX idx_analyses_run ON analyses (run_id) WHERE run_id IS NOT NULL;
        CREATE INDEX idx_analyses_snapshot ON analyses (snapshot_id) WHERE snapshot_id IS NOT NULL;
        CREATE INDEX idx_analyses_market ON analyses (market_id) WHERE market_id IS NOT NULL;
        CREATE INDEX idx_analyses_prompt ON analyses (prompt_id) WHERE prompt_id IS NOT NULL;
        CREATE INDEX idx_analyses_generation ON analyses (generation_id) WHERE generation_id IS NOT NULL;

        CREATE TABLE brand_prompts (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          position INTEGER NOT NULL,
          kind TEXT NOT NULL,
          language TEXT NOT NULL,
          text TEXT NOT NULL,
          saved_at TEXT NOT NULL,
          template_id TEXT,
          template_hash TEXT,
          CHECK (version >= 1),
          CHECK (position >= 1),
          CHECK (kind IN ('review', 'pricing', 'alternatives', 'comparison', 'use_case')),
          CHECK (length(language) > 0 AND length(language) <= 20),
          CHECK (length(text) >= 3 AND length(text) <= 300),
          CHECK (length(saved_at) > 0),
          CHECK (template_hash IS NULL OR length(template_hash) = 64),
          UNIQUE (page_id, version, language, position),
          FOREIGN KEY (page_id) REFERENCES pages (id)
        );
        CREATE INDEX idx_brand_prompts_page ON brand_prompts (page_id, version);

        CREATE TABLE brand_facts (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          source TEXT,
          added_at TEXT NOT NULL,
          CHECK (length(text) > 0 AND length(text) <= 300),
          CHECK (source IS NULL OR (length(source) > 0 AND length(source) <= 2000)),
          CHECK (length(added_at) > 0)
        );

        CREATE TABLE brand_captures (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          brand_prompt_id TEXT NOT NULL,
          prompt_text TEXT NOT NULL,
          key_id TEXT,
          has_aio INTEGER NOT NULL,
          needed_followup INTEGER NOT NULL,
          searches INTEGER NOT NULL,
          status TEXT NOT NULL,
          aio_text TEXT,
          references_json TEXT NOT NULL,
          error_code TEXT,
          message TEXT,
          raw_search_json TEXT,
          raw_aio_json TEXT,
          captured_at TEXT NOT NULL,
          CHECK (has_aio IN (0, 1)),
          CHECK (needed_followup IN (0, 1)),
          CHECK (searches >= 0),
          CHECK (status IN ('aio', 'no_aio', 'error')),
          CHECK (json_valid(references_json) AND json_type(references_json) = 'array'),
          CHECK (length(captured_at) > 0),
          UNIQUE (run_id, brand_prompt_id),
          FOREIGN KEY (run_id) REFERENCES runs (id),
          FOREIGN KEY (brand_prompt_id) REFERENCES brand_prompts (id)
        );

        CREATE TABLE sentiment_reads (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          source TEXT NOT NULL,
          capture_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          aio_hash TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          template_id TEXT NOT NULL,
          template_hash TEXT NOT NULL,
          generation_id TEXT,
          read_at TEXT NOT NULL,
          ok INTEGER NOT NULL,
          error TEXT,
          brands_named_json TEXT NOT NULL,
          reason TEXT,
          CHECK (source IN ('brand', 'buyer')),
          CHECK (length(aio_hash) = 64),
          CHECK (length(input_hash) = 64),
          CHECK (length(template_hash) = 64),
          CHECK (ok IN (0, 1)),
          CHECK (json_valid(brands_named_json) AND json_type(brands_named_json) = 'array'),
          CHECK (length(read_at) > 0),
          UNIQUE (run_id, capture_id),
          FOREIGN KEY (run_id) REFERENCES runs (id),
          FOREIGN KEY (generation_id) REFERENCES generations (id)
        );

        CREATE TABLE claims (
          id TEXT PRIMARY KEY,
          read_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          serp_result_id TEXT,
          brand_capture_id TEXT,
          position INTEGER NOT NULL,
          brand TEXT NOT NULL,
          is_own INTEGER NOT NULL,
          theme TEXT NOT NULL,
          attribute TEXT NOT NULL,
          polarity TEXT NOT NULL,
          sentence TEXT NOT NULL,
          url TEXT,
          fact_problem_json TEXT,
          CHECK (position >= 1),
          CHECK (length(brand) > 0),
          CHECK (is_own IN (0, 1)),
          CHECK (length(theme) > 0),
          CHECK (length(attribute) > 0),
          CHECK (polarity IN ('positive', 'neutral', 'negative')),
          CHECK (length(sentence) > 0),
          CHECK ((serp_result_id IS NULL) <> (brand_capture_id IS NULL)),
          CHECK (
            fact_problem_json IS NULL
            OR (json_valid(fact_problem_json) AND json_type(fact_problem_json) = 'object')
          ),
          FOREIGN KEY (read_id) REFERENCES sentiment_reads (id) ON DELETE CASCADE,
          FOREIGN KEY (run_id) REFERENCES runs (id),
          FOREIGN KEY (serp_result_id) REFERENCES serp_results (id),
          FOREIGN KEY (brand_capture_id) REFERENCES brand_captures (id)
        );
        CREATE INDEX idx_claims_run ON claims (run_id);
        CREATE INDEX idx_claims_read ON claims (read_id);
      `)
    }
  }
]
