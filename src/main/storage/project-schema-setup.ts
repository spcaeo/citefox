import type { Migration } from './migrate'

/**
 * Project migration 024: background page setup progress (FR-20.6, SCH-12) and
 * the FR-11.4 "continue this month at 10% over" choice. It follows the
 * answer-shape cache (023).
 */
export const PAGE_SETUP_VERSION = 24

export const SETUP_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: PAGE_SETUP_VERSION,
    name: `${String(PAGE_SETUP_VERSION).padStart(3, '0')}_page_setup_jobs`,
    up(db) {
      // One row per page the background runner has touched. `state` is `running`
      // while a step is in flight (a quit leaves it, and the next start continues),
      // `retry` after a failure with a time for the next try, `failed` after the last
      // try, and `done` once the page is tracked. `step` is the step that ran last.
      // A page with no row is simply waiting. `last_error` is redacted plain words.
      // `project_schedule.cap_over_month` is the `YYYY-MM` the user chose to go 10%
      // over a `notify` cap; any other month reads the stored rule.
      db.exec(`
        CREATE TABLE page_setup_jobs (
          page_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          step TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          last_error TEXT,
          next_step TEXT,
          started_at TEXT,
          finished_at TEXT,
          updated_at TEXT NOT NULL,
          CHECK (state IN ('running', 'retry', 'failed', 'done')),
          CHECK (step IN ('read', 'profile', 'prompts', 'coverage')),
          CHECK (attempts >= 0),
          CHECK (last_error IS NULL OR length(last_error) <= 500),
          CHECK (next_step IS NULL OR length(next_step) <= 300),
          CHECK (length(updated_at) > 0)
        );
        CREATE INDEX idx_page_setup_jobs_state ON page_setup_jobs (state);

        ALTER TABLE project_schedule ADD COLUMN cap_over_month TEXT
          CHECK (cap_over_month IS NULL OR length(cap_over_month) = 7);
      `)
    }
  }
]
