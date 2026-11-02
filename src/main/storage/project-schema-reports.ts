import type { Migration } from './migrate'

/**
 * Project migration 023: the answer-shape cache (Docs/REPORT-SPEC.md section 9).
 * It follows the template editor's project migration 022.
 */
export const ANSWER_SHAPES_VERSION = 23

/**
 * `answer_shapes` caches one classification per overview text, keyed by
 * `overviewHash` (SHA-256 of the whitespace-collapsed text). `template_hash` is the
 * template body that classified it. `blocks_json` is a JSON array of
 * `{ code, excerpt }` in reading order. A re-captured overview with the same text
 * reuses the row, so a report never pays twice for the same answer.
 */
export const REPORTS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: ANSWER_SHAPES_VERSION,
    name: `${String(ANSWER_SHAPES_VERSION).padStart(3, '0')}_answer_shapes`,
    up(db) {
      db.exec(`
        CREATE TABLE answer_shapes (
          overview_hash TEXT PRIMARY KEY,
          template_hash TEXT NOT NULL,
          blocks_json TEXT NOT NULL,
          classified_at TEXT NOT NULL,
          CHECK (length(overview_hash) = 64),
          CHECK (length(template_hash) = 64),
          CHECK (json_valid(blocks_json) AND json_type(blocks_json) = 'array'),
          CHECK (length(classified_at) > 0)
        );
      `)
    }
  }
]
