import type { Migration } from './migrate'

/**
 * Project migration 035: `overview_reads`, the saved "Analyse with Claude" read of one
 * overview sample on the prompt page (assist `results.overviewRead`). One row per
 * `serp_results` sample; a re-run replaces it. `read_json` is the checked
 * `OverviewRead` (src/shared/overview-read.ts); `ran_at` is ISO-8601 UTC.
 */
export const OVERVIEW_READS_VERSION = 35

export const OVERVIEW_READS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: OVERVIEW_READS_VERSION,
    name: `${String(OVERVIEW_READS_VERSION).padStart(3, '0')}_overview_reads`,
    up(db) {
      db.exec(`
        CREATE TABLE overview_reads (
          serp_result_id TEXT PRIMARY KEY
            REFERENCES serp_results (id) ON DELETE CASCADE,
          read_json TEXT NOT NULL,
          ran_at TEXT NOT NULL,
          CHECK (json_valid(read_json) AND json_type(read_json) = 'object'),
          CHECK (length(ran_at) > 0)
        );
      `)
    }
  }
]
