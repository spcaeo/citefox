import type { Migration } from './migrate'

/**
 * Project migration 036: prompt lineage (prompt detail "Edit question").
 *
 * Every saved prompt-set version gives each prompt a new id, and checks store their
 * results against that id, so results of an old wording never move to a new one.
 * `prompt_lineage` links a prompt to the same prompt in the version it was saved
 * from (one row per carried-over prompt). "Over time" follows the chain back to show
 * earlier checks and says where the wording changed; the wording itself stays in
 * `prompt_variants` of each version. A prompt written fresh has no row.
 */
export const PROMPT_LINEAGE_VERSION = 36

export const PROMPT_LINEAGE_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: PROMPT_LINEAGE_VERSION,
    name: `${String(PROMPT_LINEAGE_VERSION).padStart(3, '0')}_prompt_lineage`,
    up(db) {
      db.exec(`
        CREATE TABLE prompt_lineage (
          prompt_id TEXT PRIMARY KEY,
          previous_prompt_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (prompt_id <> previous_prompt_id),
          CHECK (length(created_at) > 0),
          FOREIGN KEY (prompt_id) REFERENCES prompts (id),
          FOREIGN KEY (previous_prompt_id) REFERENCES prompts (id),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_prompt_lineage_previous ON prompt_lineage (previous_prompt_id);
      `)
    }
  }
]
