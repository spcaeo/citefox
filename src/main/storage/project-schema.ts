import { TOPIC_ALSO_PAGES_PROJECT_MIGRATIONS } from './project-schema-topic-also-pages'
import { COMMUNITIES_MIGRATION, THREAD_EXCERPT_MIGRATION } from '../communities/migration'
import type { Migration } from './migrate'
import { PROJECT_OPTION_MIGRATIONS } from './project-schema-options'
import { TEMPLATE_PROJECT_MIGRATIONS } from './template-schema'
import { MAX_PROMPT_COUNT } from './pages'
import { STRUCTURE_MIGRATION } from './project-schema-structure'
import { SENTIMENT_PROJECT_MIGRATIONS } from './project-schema-sentiment'
import { GRID_PROJECT_MIGRATIONS } from './project-schema-grid'
import { REPORTS_PROJECT_MIGRATIONS } from './project-schema-reports'
import { SETUP_PROJECT_MIGRATIONS } from './project-schema-setup'
import { AUTO_EXPORT_PROJECT_MIGRATIONS } from './project-schema-auto-export'
import { TOPIC_PROJECT_MIGRATIONS } from './project-schema-topics'
import { SITE_START_EDIT_MIGRATIONS, SITE_START_PROJECT_MIGRATIONS } from './project-schema-start'
import { BUYER_CONTEXT_PROJECT_MIGRATIONS } from './project-schema-buyer-context'
import { PROMPT_LINEAGE_PROJECT_MIGRATIONS } from './project-schema-prompt-lineage'
import { SITE_KINDS_PROJECT_MIGRATIONS } from './project-schema-site-kinds'
import { IMPORT_PROJECT_MIGRATIONS } from './project-schema-import'
import { COMPETITOR_ALIASES_PROJECT_MIGRATIONS } from './project-schema-competitor-aliases'
import { AUTO_SETUP_PROJECT_MIGRATIONS } from './project-schema-auto-setup'
import { PRODUCTS_PROJECT_MIGRATIONS } from './project-schema-products'
import { OVERVIEW_READS_PROJECT_MIGRATIONS } from './project-schema-overview-reads'
import { ALERT_RULES_PROJECT_MIGRATIONS } from './project-schema-alert-rules'
import { GAP_STATES_PROJECT_MIGRATIONS } from './project-schema-gap-states'
import { CHECK_ASKS_PROJECT_MIGRATIONS } from './project-schema-check-asks'
import { FIX_LOOP_PROJECT_MIGRATIONS } from './project-schema-fix-loop'
import { GOOGLE_EXTRAS_PROJECT_MIGRATIONS } from './project-schema-google-extras'
import { ENGINES_PROJECT_MIGRATIONS } from './project-schema-engines'
import { CODEX_CONNECTION_PROJECT_MIGRATIONS } from './schema-codex-connection'
import { TOPIC_TARGET_PROJECT_MIGRATIONS } from './project-schema-topic-target'
import { SITE_OVERRIDES_PROJECT_MIGRATIONS } from './project-schema-site-overrides'
import { GUIDE_PROJECT_MIGRATIONS } from './project-schema-guide'
import { TOPIC_FOLDERS_PROJECT_MIGRATIONS } from './project-schema-topic-folders'
import { PAGE_EDITS_PROJECT_MIGRATIONS } from './project-schema-page-edits'
import { OWNER_WHYS_PROJECT_MIGRATIONS } from './project-schema-owner-whys'
import { FIX_VERDICTS_PROJECT_MIGRATIONS } from './project-schema-fix-verdicts'
import { CHECK_INTERVALS_PROJECT_MIGRATIONS } from './project-schema-check-intervals'
import { PAGE_HISTORY_PROJECT_MIGRATIONS } from './project-schema-page-history'
import { RULES_TRACKING_PROJECT_MIGRATIONS } from './project-schema-rules-tracking'
import { PAGE_FIX_BRIEFS_PROJECT_MIGRATIONS } from './project-schema-page-fix-briefs'

/**
 * Project database (SRS section 10), one file per project.
 * Version 1 is the profile and its default market.
 * Version 2 is M2 page setup: pages, snapshots, buyer profiles, prompt-set
 * versions, coverage runs, and one usage row per generation.
 * Version 5 marks exactly one prompt set per page as active.
 * Version 6 is the project's schedule (SCH-9): one row, separate from the profile.
 * Version 7 records `last_checked_at` on each page market (FR-9.4).
 * Version 8 adds the project search cap, cap rule, and dedicated key id (FR-11.4).
 * Version 9 records `first_check_not_before` on each page market (SCH-12).
 * Version 10 stores fix follow-ups (section 10 `fixes` and `fix_prompts`, SCH-10).
 * Version 11 stores project notification toggles (FR-23.13, section 9.2).
 * Version 12 stores check jobs, runs, steps, SERP captures, and AI Overview references.
 * `check_jobs` and `check_steps` are not in section 10. They are an approved extra,
 * the same way `generations` is, so a reopened Checking screen can paint the job.
 * A missing row is all off. Slack stores a keychain ref, never a webhook URL (NFR-5).
 * A follow-up is completed when `followup_run_id` is set. There is no status column.
 * Site-structure tables are migration 18 (`project-schema-structure.ts`).
 * Version 13 stores section 10 `analyses` and allows `generations.kind` values
 * `aio_gap` and `summary` (FR-6.6, FR-12.3). The kind check is rebuilt in place
 * so existing generation rows stay. `market_id` and `generation_id` are not in
 * the SRS column list. They link a row to the run's market and the generation
 * that produced it. `market_id` is not a foreign key: `writeProjectProfile`
 * replaces `markets`.
 * Version 14 adds nullable `alert_settings.monthly_pdf_to`. Existing rows stay
 * NULL.
 * Version 16 stores section 10 `notes` and adds `fixes.created_at` and
 * `fixes.followup_job_id` (FR-14.6, FR-15.3).
 * Version 20 is brand sentiment (`project-schema-sentiment.ts`): brand prompts,
 * brand facts, brand captures, sentiment reads, and claims. It opens the
 * `generations.kind` check to `brand_prompts` and `sentiment_claims`.
 * Version 19 stores the data grid's saved views and All pages' ignored citations.
 * Version 23 is the answer-shape cache (`project-schema-reports.ts`).
 * Version 25 stores automatic exports (`project-schema-auto-export.ts`).
 * Version 26 keeps Reddit thread excerpts (`communities/migration.ts`).
 * Versions 27 and 28 are topics (`project-schema-topics.ts`): `pages.kind`, a
 * nullable `pages.url` for topic rows, and the topic side tables.
 *
 * Pages have no `project_id`. The file is already one project, and
 * `PageSummary.projectId` is filled from that project when a page is read.
 *
 * `page_markets.market_id` is not a foreign key. `writeProjectProfile` replaces
 * the markets table, and a foreign key would either block that write or delete
 * page links. The page repository checks that the market exists on insert.
 *
 * `generations` is an approved main-only addition to section 10. One row is
 * one model attempt. It stores `ModelUsage` (token counts and serpapiSearches).
 * There is no cost column: the contract has no place for `totalCostUsd`.
 * Kinds are `buyer_profile`, `buyer_prompts`, `coverage`, `aio_gap`, and `summary`.
 */

export const PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '001_project_profile',
    up(db) {
      db.exec(`
        CREATE TABLE project_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          include_subdomains INTEGER NOT NULL,
          brand_names TEXT NOT NULL,
          competitors TEXT NOT NULL,
          CHECK (include_subdomains IN (0, 1)),
          CHECK (json_valid(brand_names) AND json_type(brand_names) = 'array'),
          CHECK (json_valid(competitors) AND json_type(competitors) = 'array')
        );

        CREATE TABLE markets (
          id TEXT PRIMARY KEY,
          country TEXT NOT NULL,
          language TEXT NOT NULL,
          location TEXT,
          device TEXT NOT NULL,
          local_wording INTEGER NOT NULL,
          serpapi_location TEXT,
          is_default INTEGER NOT NULL,
          CHECK (device IN ('desktop', 'mobile')),
          CHECK (local_wording IN (0, 1)),
          CHECK (is_default IN (0, 1)),
          CHECK (length(country) = 2),
          CHECK (length(language) > 0)
        );
      `)
    }
  },
  {
    version: 2,
    name: '002_pages_and_prompts',
    up(db) {
      db.exec(`
        CREATE TABLE pages (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
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
          CHECK (status IN ('not_tracked', 'setting_up', 'tracked', 'paused', 'removed')),
          CHECK (interval_days IN (14, 30, 60, 90)),
          CHECK (samples BETWEEN 1 AND 5),
          CHECK (prompt_count BETWEEN 1 AND ${MAX_PROMPT_COUNT}),
          CHECK (pinned IN (0, 1)),
          CHECK (length(url) > 0 AND length(url) <= 2000),
          UNIQUE (url)
        );

        CREATE TABLE page_markets (
          page_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          added_at TEXT NOT NULL,
          baseline_run_id TEXT,
          PRIMARY KEY (page_id, market_id),
          CHECK (length(added_at) > 0),
          FOREIGN KEY (page_id) REFERENCES pages (id)
        );

        CREATE TABLE snapshots (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          method TEXT NOT NULL,
          http_status INTEGER,
          duration_ms INTEGER NOT NULL,
          title TEXT,
          meta_description TEXT,
          h1 TEXT,
          canonical TEXT,
          published_at TEXT,
          modified_at TEXT,
          outline_json TEXT NOT NULL,
          faqs_json TEXT NOT NULL,
          h2_count INTEGER NOT NULL,
          h3_count INTEGER NOT NULL,
          table_count INTEGER NOT NULL,
          body_text TEXT NOT NULL,
          word_count INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          summary_json TEXT,
          CHECK (method IN ('direct', 'jina', 'file')),
          CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
          CHECK (length(fetched_at) > 0),
          CHECK (length(body_text) > 0),
          CHECK (word_count >= 0),
          CHECK (length(content_hash) = 64),
          CHECK (duration_ms >= 0),
          CHECK (h2_count >= 0),
          CHECK (h3_count >= 0),
          CHECK (table_count >= 0),
          CHECK (json_valid(outline_json) AND json_type(outline_json) = 'array'),
          CHECK (json_valid(faqs_json) AND json_type(faqs_json) = 'array'),
          FOREIGN KEY (page_id) REFERENCES pages (id)
        );

        CREATE TABLE buyer_profiles (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          snapshot_id TEXT NOT NULL,
          body_json TEXT NOT NULL,
          template_id TEXT NOT NULL,
          template_name TEXT NOT NULL,
          template_hash TEXT NOT NULL,
          template_updated_at TEXT,
          created_at TEXT NOT NULL,
          CHECK (length(template_id) > 0),
          CHECK (length(template_hash) = 64),
          CHECK (length(created_at) > 0),
          CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
          FOREIGN KEY (page_id) REFERENCES pages (id),
          FOREIGN KEY (snapshot_id) REFERENCES snapshots (id)
        );

        CREATE TABLE prompt_sets (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          saved_at TEXT NOT NULL,
          icp_id TEXT NOT NULL,
          template_id TEXT,
          template_hash TEXT,
          template_updated_at TEXT,
          CHECK (version >= 1),
          CHECK (length(saved_at) > 0),
          CHECK (
            (template_id IS NULL AND template_hash IS NULL)
            OR (template_id IS NOT NULL AND template_hash IS NOT NULL AND length(template_hash) = 64)
          ),
          UNIQUE (page_id, version),
          FOREIGN KEY (page_id) REFERENCES pages (id),
          FOREIGN KEY (icp_id) REFERENCES buyer_profiles (id)
        );

        CREATE TABLE prompts (
          id TEXT PRIMARY KEY,
          prompt_set_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          label TEXT NOT NULL,
          source TEXT NOT NULL,
          intent_stage TEXT NOT NULL,
          mapped_element TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          CHECK (position >= 1),
          CHECK (length(label) > 0),
          CHECK (length(mapped_element) > 0),
          CHECK (enabled IN (0, 1)),
          CHECK (source IN ('title_meta_h1', 'trigger_event', 'objection', 'detail_check', 'written_by_user')),
          CHECK (intent_stage IN ('problem', 'solution', 'comparison', 'objection', 'trigger', 'unset')),
          UNIQUE (prompt_set_id, position),
          FOREIGN KEY (prompt_set_id) REFERENCES prompt_sets (id)
        );

        CREATE TABLE prompt_variants (
          prompt_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          language TEXT NOT NULL,
          text TEXT NOT NULL,
          original_text TEXT,
          PRIMARY KEY (prompt_id, market_id),
          CHECK (length(language) > 0),
          CHECK (length(text) > 0),
          FOREIGN KEY (prompt_id) REFERENCES prompts (id)
        );

        CREATE TABLE coverage_runs (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          template_id TEXT NOT NULL,
          template_hash TEXT NOT NULL,
          template_updated_at TEXT,
          content_hash TEXT NOT NULL,
          snapshot_id TEXT,
          CHECK (length(recorded_at) > 0),
          CHECK (length(template_hash) = 64),
          CHECK (length(content_hash) = 64),
          FOREIGN KEY (page_id) REFERENCES pages (id),
          FOREIGN KEY (snapshot_id) REFERENCES snapshots (id)
        );

        CREATE TABLE coverage_rows (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          coverage TEXT NOT NULL,
          where_covered_json TEXT NOT NULL,
          current_content TEXT NOT NULL,
          what_to_update TEXT NOT NULL,
          main_gap TEXT NOT NULL,
          priority TEXT NOT NULL,
          actions_json TEXT NOT NULL,
          suggested_faq_json TEXT,
          done INTEGER NOT NULL DEFAULT 0,
          CHECK (coverage IN ('strong', 'partial', 'weak', 'none')),
          CHECK (priority IN ('high', 'medium', 'low')),
          CHECK (done IN (0, 1)),
          CHECK (json_valid(where_covered_json) AND json_type(where_covered_json) = 'array'),
          CHECK (json_valid(actions_json) AND json_type(actions_json) = 'array'),
          FOREIGN KEY (run_id) REFERENCES coverage_runs (id),
          FOREIGN KEY (prompt_id) REFERENCES prompts (id)
        );

        CREATE TABLE coverage_findings (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT NOT NULL,
          CHECK (kind IN (
            'factual_claim', 'missing_promised_section', 'typo',
            'title_length', 'title_meta_mismatch', 'other'
          )),
          FOREIGN KEY (run_id) REFERENCES coverage_runs (id)
        );

        CREATE TABLE generations (
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
          CHECK (kind IN ('buyer_profile', 'buyer_prompts', 'coverage')),
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

        CREATE INDEX idx_pages_pinned ON pages (pinned);
        CREATE INDEX idx_snapshots_page ON snapshots (page_id, fetched_at);
        CREATE INDEX idx_profiles_page ON buyer_profiles (page_id, created_at);
        CREATE INDEX idx_prompt_sets_page ON prompt_sets (page_id, version);
        CREATE INDEX idx_coverage_page ON coverage_runs (page_id, content_hash);
        CREATE INDEX idx_generations_input ON generations (kind, input_hash, ok);
      `)
    }
  },
  {
    version: 3,
    name: '003_template_names',
    up(db) {
      db.exec(`
        ALTER TABLE prompt_sets ADD COLUMN template_name TEXT;
        ALTER TABLE coverage_runs ADD COLUMN template_name TEXT NOT NULL DEFAULT 'CiteFox default';
        UPDATE prompt_sets
        SET template_name = 'CiteFox default'
        WHERE template_id IS NOT NULL AND template_name IS NULL;
      `)
    }
  },
  {
    version: 4,
    name: '004_pin_order',
    up(db) {
      db.exec(`
        ALTER TABLE pages ADD COLUMN pinned_at TEXT;
      `)
    }
  },
  {
    version: 5,
    name: '005_active_prompt_set',
    up(db) {
      db.exec(`
        ALTER TABLE prompt_sets ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0
          CHECK (is_active IN (0, 1));
        UPDATE prompt_sets
        SET is_active = 1
        WHERE rowid IN (
          SELECT candidate.rowid
          FROM prompt_sets AS candidate
          WHERE candidate.version = (
            SELECT MAX(version) FROM prompt_sets WHERE page_id = candidate.page_id
          )
        );
        CREATE UNIQUE INDEX idx_prompt_sets_one_active
          ON prompt_sets (page_id) WHERE is_active = 1;
      `)
    }
  },
  {
    version: 6,
    name: '006_project_schedule',
    up(db) {
      db.exec(`
        CREATE TABLE project_schedule (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          default_interval_days INTEGER NOT NULL,
          daily_check_time TEXT NOT NULL,
          quiet_from TEXT,
          quiet_until TEXT,
          spread_across_day INTEGER NOT NULL,
          catch_up INTEGER NOT NULL,
          paused INTEGER NOT NULL,
          next_check_at TEXT,
          pages_due_today INTEGER NOT NULL,
          CHECK (default_interval_days IN (14, 30, 60, 90)),
          CHECK (length(daily_check_time) = 5 AND substr(daily_check_time, 3, 1) = ':'),
          CHECK (quiet_from IS NULL OR (length(quiet_from) = 5 AND substr(quiet_from, 3, 1) = ':')),
          CHECK (quiet_until IS NULL OR (length(quiet_until) = 5 AND substr(quiet_until, 3, 1) = ':')),
          CHECK (spread_across_day IN (0, 1)),
          CHECK (catch_up IN (0, 1)),
          CHECK (paused IN (0, 1)),
          CHECK (pages_due_today >= 0),
          CHECK (paused = 0 OR pages_due_today = 0),
          CHECK (next_check_at IS NULL OR length(next_check_at) > 0),
          CHECK (
            (quiet_from IS NULL AND quiet_until IS NULL)
            OR (quiet_from IS NOT NULL AND quiet_until IS NOT NULL)
          )
        );
      `)
    }
  },
  {
    version: 7,
    name: '007_page_market_last_checked',
    up(db) {
      db.exec(`
        ALTER TABLE page_markets ADD COLUMN last_checked_at TEXT
          CHECK (last_checked_at IS NULL OR length(last_checked_at) > 0);
      `)
    }
  },
  {
    version: 8,
    name: '008_project_schedule_caps',
    up(db) {
      // FR-11.4 and FR-10.3. NULL cap means no project cap. Zero is a real cap.
      // Existing rows keep cap NULL, cap_rule 'pause', and dedicated_key_id NULL.
      // dedicated_key_id is an api_keys.id. The secret stays in the keychain.
      // api_keys lives in app.sqlite, so this column is not a foreign key.
      db.exec(`
        ALTER TABLE project_schedule ADD COLUMN cap INTEGER
          CHECK (cap IS NULL OR cap >= 0);
        ALTER TABLE project_schedule ADD COLUMN cap_rule TEXT NOT NULL DEFAULT 'pause'
          CHECK (cap_rule IN ('pause', 'notify', 'allow_10'));
        ALTER TABLE project_schedule ADD COLUMN dedicated_key_id TEXT
          CHECK (dedicated_key_id IS NULL OR length(dedicated_key_id) > 0);
      `)
    }
  },
  {
    version: 9,
    name: '009_page_market_first_check',
    up(db) {
      // SCH-12. NULL means the first check is not held for stagger.
      // Existing page markets stay null.
      db.exec(`
        ALTER TABLE page_markets ADD COLUMN first_check_not_before TEXT
          CHECK (first_check_not_before IS NULL OR length(first_check_not_before) > 0);

        CREATE INDEX idx_page_markets_first_check
          ON page_markets (first_check_not_before, page_id, market_id)
          WHERE last_checked_at IS NULL;
      `)
    }
  },
  {
    version: 10,
    name: '010_fix_follow_ups',
    up(db) {
      // FR-14.5, FR-14.6, SCH-10. Section 10 `fixes` and `fix_prompts`.
      // `markets` is the chosen market ids on the fix, not one row per market.
      // Completed is `followup_run_id` set. Planned is that column null.
      // `verdict` is the FR-14.7 text. `recheck_rule` is after_3_days,
      // after_7_days, or next_scheduled.
      db.exec(`
        CREATE TABLE fixes (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          number INTEGER NOT NULL,
          description TEXT NOT NULL,
          live_on TEXT NOT NULL,
          recheck_rule TEXT NOT NULL,
          markets TEXT NOT NULL,
          followup_run_id TEXT,
          verdict TEXT,
          CHECK (length(id) > 0),
          CHECK (number >= 1),
          CHECK (length(description) > 0),
          CHECK (length(live_on) > 0),
          CHECK (recheck_rule IN ('after_3_days', 'after_7_days', 'next_scheduled')),
          CHECK (json_valid(markets) AND json_type(markets) = 'array'),
          CHECK (json_array_length(markets) >= 1),
          CHECK (followup_run_id IS NULL OR length(followup_run_id) > 0),
          CHECK (verdict IS NULL OR length(verdict) > 0),
          UNIQUE (page_id, number),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );

        CREATE TABLE fix_prompts (
          fix_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          PRIMARY KEY (fix_id, prompt_id),
          CHECK (length(prompt_id) > 0),
          FOREIGN KEY (fix_id) REFERENCES fixes (id) ON DELETE CASCADE,
          FOREIGN KEY (prompt_id) REFERENCES prompts (id)
        );
      `)
    }
  },
  {
    version: 11,
    name: '011_alert_settings',
    up(db) {
      // FR-23.13, section 9.2. One row. Booleans default off.
      // A missing row is the same as all off and is not inserted here.
      // email_account_id has no foreign key: accounts live in app.sqlite.
      // slack_keychain_ref is a keychain id. The webhook URL is not a column (NFR-5).
      db.exec(`
        CREATE TABLE alert_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          desktop INTEGER NOT NULL DEFAULT 0,
          email_after_check INTEGER NOT NULL DEFAULT 0,
          email_account_id TEXT,
          email_to TEXT NOT NULL DEFAULT '[]',
          slack_enabled INTEGER NOT NULL DEFAULT 0,
          slack_keychain_ref TEXT,
          monthly_client_pdf INTEGER NOT NULL DEFAULT 0,
          CHECK (desktop IN (0, 1)),
          CHECK (email_after_check IN (0, 1)),
          CHECK (slack_enabled IN (0, 1)),
          CHECK (monthly_client_pdf IN (0, 1)),
          CHECK (email_account_id IS NULL OR length(email_account_id) > 0),
          CHECK (slack_keychain_ref IS NULL OR length(slack_keychain_ref) > 0),
          CHECK (json_valid(email_to) AND json_type(email_to) = 'array')
        );
      `)
    }
  },
  {
    version: 12,
    name: '012_check_runs',
    up(db) {
      db.exec(`
        CREATE TABLE check_jobs (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL,
          page_ids TEXT NOT NULL,
          market_ids TEXT,
          prompt_ids TEXT,
          reason TEXT NOT NULL,
          searches_used INTEGER NOT NULL DEFAULT 0,
          message TEXT,
          next_step TEXT,
          CHECK (status IN ('running', 'finished', 'cancelled', 'error')),
          CHECK (reason IN ('manual', 'scheduled', 'follow_up', 'catch_up')),
          CHECK (searches_used >= 0),
          CHECK (json_valid(page_ids) AND json_type(page_ids) = 'array'),
          CHECK (market_ids IS NULL OR (json_valid(market_ids) AND json_type(market_ids) = 'array')),
          CHECK (prompt_ids IS NULL OR (json_valid(prompt_ids) AND json_type(prompt_ids) = 'array'))
        );

        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          prompt_set_id TEXT NOT NULL,
          snapshot_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          kind TEXT NOT NULL,
          partial INTEGER NOT NULL,
          status TEXT NOT NULL,
          samples INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          CHECK (kind IN ('baseline', 'scheduled', 'manual', 'follow_up')),
          CHECK (status IN ('running', 'finished', 'cancelled', 'error')),
          CHECK (partial IN (0, 1)),
          CHECK (samples BETWEEN 1 AND 5),
          FOREIGN KEY (job_id) REFERENCES check_jobs (id),
          FOREIGN KEY (page_id) REFERENCES pages (id),
          FOREIGN KEY (prompt_set_id) REFERENCES prompt_sets (id),
          FOREIGN KEY (snapshot_id) REFERENCES snapshots (id)
        );

        CREATE TABLE check_steps (
          job_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          sample_no INTEGER NOT NULL,
          phase TEXT NOT NULL,
          prompt_position INTEGER NOT NULL,
          label TEXT NOT NULL,
          prompt_text TEXT NOT NULL,
          state TEXT NOT NULL,
          detail TEXT NOT NULL,
          error_code TEXT,
          error TEXT,
          retry_searches INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (job_id, page_id, market_id, prompt_id, sample_no, phase),
          CHECK (sample_no BETWEEN 0 AND 5),
          CHECK (phase IN ('reread', 'search', 'aio', 'analysis')),
          CHECK (state IN ('waiting', 'running', 'ok', 'warning', 'error')),
          CHECK (retry_searches >= 0),
          FOREIGN KEY (job_id) REFERENCES check_jobs (id)
        );

        CREATE TABLE serp_results (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          sample_no INTEGER NOT NULL,
          key_id TEXT,
          has_aio INTEGER NOT NULL,
          needed_followup INTEGER NOT NULL,
          searches INTEGER NOT NULL,
          status TEXT NOT NULL,
          named INTEGER,
          cited_url TEXT,
          position REAL,
          aio_text TEXT,
          error_code TEXT,
          message TEXT,
          next_step TEXT,
          raw_search_json TEXT,
          raw_aio_json TEXT,
          UNIQUE (run_id, prompt_id, sample_no),
          CHECK (sample_no BETWEEN 1 AND 5),
          CHECK (has_aio IN (0, 1)),
          CHECK (needed_followup IN (0, 1)),
          CHECK (searches >= 0),
          CHECK (named IS NULL OR named IN (0, 1)),
          CHECK (status IN ('page_cited', 'other_own_page', 'brand_mentioned', 'not_cited', 'no_aio', 'error')),
          FOREIGN KEY (run_id) REFERENCES runs (id)
        );

        CREATE TABLE aio_references (
          id TEXT PRIMARY KEY,
          serp_result_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL,
          domain TEXT NOT NULL,
          title TEXT,
          classification TEXT NOT NULL,
          untracked INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          CHECK (position >= 1),
          CHECK (classification IN ('target', 'own', 'competitor', 'other')),
          CHECK (untracked IN (0, 1)),
          CHECK (source_type IN ('web', 'reddit', 'youtube', 'linkedin', 'review', 'forum', 'other')),
          FOREIGN KEY (serp_result_id) REFERENCES serp_results (id)
        );
      `)
    }
  },
  {
    version: 13,
    name: '013_analyses',
    rebuildsTables: true,
    up(db) {
      // FR-6.6, FR-12.3, SRS section 10. Rebuild `generations` so the kind
      // check accepts `aio_gap` and `summary`. Every existing column and row
      // is copied first. The input index is recreated with the same definition.
      db.exec(`
        CREATE TABLE generations_next (
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
          CHECK (kind IN ('buyer_profile', 'buyer_prompts', 'coverage', 'aio_gap', 'summary')),
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

        INSERT INTO generations_next (
          id, page_id, kind, template_id, template_hash, started_at, duration_ms,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
          model, connection, ok, error, input_hash, output_json
        )
        SELECT
          id, page_id, kind, template_id, template_hash, started_at, duration_ms,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
          model, connection, ok, error, input_hash, output_json
        FROM generations;

        DROP TABLE generations;
        ALTER TABLE generations_next RENAME TO generations;
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

        CREATE INDEX idx_analyses_run ON analyses (run_id) WHERE run_id IS NOT NULL;
        CREATE INDEX idx_analyses_snapshot ON analyses (snapshot_id) WHERE snapshot_id IS NOT NULL;
        CREATE INDEX idx_analyses_market ON analyses (market_id) WHERE market_id IS NOT NULL;
        CREATE INDEX idx_analyses_prompt ON analyses (prompt_id) WHERE prompt_id IS NOT NULL;
        CREATE INDEX idx_analyses_generation ON analyses (generation_id) WHERE generation_id IS NOT NULL;
      `)
    }
  },
  {
    version: 14,
    name: '014_alert_settings_monthly_pdf_to',
    up(db) {
      // Existing alert_settings rows stay NULL. The column accepts a string.
      db.exec(`
        ALTER TABLE alert_settings ADD COLUMN monthly_pdf_to TEXT NULL;
      `)
    }
  },
  {
    version: 15,
    name: '015_check_query_indexes',
    up(db) {
      // Results, resume, and history read runs by page and market, runs by job,
      // references by capture, jobs by status, and coverage by run. Without
      // these each read scanned the whole table.
      db.exec(`
        CREATE INDEX idx_runs_page_market ON runs (page_id, market_id, started_at);
        CREATE INDEX idx_runs_job ON runs (job_id, started_at);
        CREATE INDEX idx_aio_references_serp ON aio_references (serp_result_id, position);
        CREATE INDEX idx_check_jobs_status ON check_jobs (status, started_at);
        CREATE INDEX idx_coverage_rows_run ON coverage_rows (run_id);
        CREATE INDEX idx_coverage_findings_run ON coverage_findings (run_id);
      `)
    }
  },
  // ---- w4/progress: migration 016 (renumber at merge) ----
  {
    version: 16,
    name: '016_notes_and_fix_jobs',
    up(db) {
      // FR-7.4, FR-15.3: section 10 `notes`. `date` is the local calendar day
      // the user picked (YYYY-MM-DD), not an instant. `created_at` and
      // `updated_at` are not in the SRS column list; they order notes logged
      // on the same day.
      // FR-14.6: "Run follow-up now" starts a check job before its run exists.
      // `fixes.followup_job_id` keeps that job so the scheduler stops planning
      // the follow-up and the run is linked when the job finishes.
      // `fixes.created_at` is when the fix was logged. Existing rows stay NULL.
      db.exec(`
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          date TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(date) = 10 AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          CHECK (length(text) > 0),
          CHECK (length(created_at) > 0),
          CHECK (length(updated_at) > 0),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_notes_page ON notes (page_id, date);

        ALTER TABLE fixes ADD COLUMN created_at TEXT
          CHECK (created_at IS NULL OR length(created_at) > 0);
        ALTER TABLE fixes ADD COLUMN followup_job_id TEXT
          CHECK (followup_job_id IS NULL OR length(followup_job_id) > 0);
      `)
    }
  },
  // ---- end w4/progress migration 016 ----
  // ---- 017: project options (projects at scale) ----
  ...PROJECT_OPTION_MIGRATIONS,
  // ---- 018: site structure (sitemaps, clusters, silos, groups). ----
  STRUCTURE_MIGRATION,
  // ---- 019: data grid saved views, ignored citations ----
  ...GRID_PROJECT_MIGRATIONS,
  // ---- 020: brand sentiment ----
  ...SENTIMENT_PROJECT_MIGRATIONS,
  // ---- 21: Communities and YouTube opportunities (w4/communities) ----
  COMMUNITIES_MIGRATION,
  // ---- 022: template editor (project template versions, llm_calls) ----
  ...TEMPLATE_PROJECT_MIGRATIONS,
  // ---- 023: answer-shape cache (w4/reports) ----
  ...REPORTS_PROJECT_MIGRATIONS,
  // ---- 024: background page setup, cap over this month (w5/setup-runner) ----
  ...SETUP_PROJECT_MIGRATIONS,
  // ---- 025: automatic exports to a folder (FR-22.6) ----
  ...AUTO_EXPORT_PROJECT_MIGRATIONS,
  // ---- 026: Reddit thread excerpts and brand quotes (Communities) ----
  THREAD_EXCERPT_MIGRATION,
  // ---- 027, 028: topics (page kind, nullable URL, topic side tables) ----
  ...TOPIC_PROJECT_MIGRATIONS,
  // ---- 030: first-run "Your site" plan ----
  ...SITE_START_PROJECT_MIGRATIONS,
  // ---- 031: buyer context notes (what buyers switch from, integrations) ----
  ...BUYER_CONTEXT_PROJECT_MIGRATIONS,
  // ---- 032: edits along the first-run journey ----
  ...SITE_START_EDIT_MIGRATIONS,
  // ---- 033: automatic page setup (first check waits, check when ready) ----
  ...AUTO_SETUP_PROJECT_MIGRATIONS,
  // ---- 034: products and competitors by product (prompt audit PC) ----
  ...PRODUCTS_PROJECT_MIGRATIONS,
  // ---- 035: saved "Analyse with Claude" overview reads ----
  ...OVERVIEW_READS_PROJECT_MIGRATIONS,
  // ---- 036: prompt lineage (prompt detail "Edit question") ----
  ...PROMPT_LINEAGE_PROJECT_MIGRATIONS,
  // ---- 037: kinds of cited site (Competitors, reports) ----
  ...SITE_KINDS_PROJECT_MIGRATIONS,
  // ---- 038: shared importer (import batches for undo, saved column matches) ----
  ...IMPORT_PROJECT_MIGRATIONS,
  // ---- 039: alert rules and the alert log (Alerts) ----
  ...ALERT_RULES_PROJECT_MIGRATIONS,
  // ---- 040: a competitor's other domains (Competitors › Edit) ----
  ...COMPETITOR_ALIASES_PROJECT_MIGRATIONS,
  // ---- 041: content gap edits (FAQ drafts, open/published/verified) ----
  ...GAP_STATES_PROJECT_MIGRATIONS,
  // ---- 042: a page's own "Add and check now", kept over a restart ----
  ...CHECK_ASKS_PROJECT_MIGRATIONS,
  // ---- 043: fix loop (change kind, index checks, step owners, cached Claude texts) ----
  ...FIX_LOOP_PROJECT_MIGRATIONS,
  // ---- 044: Google search extras (organic top 10, People also ask) and page eligibility ----
  ...GOOGLE_EXTRAS_PROJECT_MIGRATIONS,
  // ---- 045: answer engines, cloro, credits and cost per check ----
  ...ENGINES_PROJECT_MIGRATIONS,
  // ---- 046: Codex calls in llm_calls and generations (renumber at merge) ----
  ...CODEX_CONNECTION_PROJECT_MIGRATIONS,
  // ---- 047: a topic's target page (renumber at merge) ----
  ...TOPIC_TARGET_PROJECT_MIGRATIONS,
  // ---- 048: the user's own type of site and role per domain, and custom types (renumber at merge) ----
  ...SITE_OVERRIDES_PROJECT_MIGRATIONS,
  // ---- 049: the first-run guide's progress (renumber at merge) ----
  ...GUIDE_PROJECT_MIGRATIONS,
  // ---- 050: topic folders (Topics dashboard) ----
  ...TOPIC_FOLDERS_PROJECT_MIGRATIONS,
  // ---- 051: saved page fix briefs (What to fix status, renumber at merge) ----
  ...PAGE_FIX_BRIEFS_PROJECT_MIGRATIONS,
  // ---- 052: saved page edits (What to fix › Page edits, renumber at merge) ----
  ...PAGE_EDITS_PROJECT_MIGRATIONS,
  // ---- 053: saved page comparisons (What to fix › Why Google picks, renumber at merge) ----
  ...OWNER_WHYS_PROJECT_MIGRATIONS,
  // ---- 054: fixes measured on their page from any topic or page (Did it work?, renumber at merge) ----
  ...FIX_VERDICTS_PROJECT_MIGRATIONS,
  // ---- 055: every day and every 7 days allowed (renumber at merge) ----
  ...CHECK_INTERVALS_PROJECT_MIGRATIONS,
  // ---- 056: page change history (reads, versions, changes) ----
  ...PAGE_HISTORY_PROJECT_MIGRATIONS,
  // ---- 057: tracking changes (chart markers) and project rules ----
  ...RULES_TRACKING_PROJECT_MIGRATIONS,
  // ---- 058: other pages that may answer a topic question ----
  ...TOPIC_ALSO_PAGES_PROJECT_MIGRATIONS
]
