import type { Migration } from './migrate'

/**
 * Project migration 043: fix → measure → repeat (the Fixes screen's loop).
 *
 * - `fixes.kind`: what a logged change is (`new_page`, `rewrite` or `fix`). Fixes
 *   logged before this migration are `fix`.
 * - `index_checks`: one row per "Check index" of a page (a `site:` search through
 *   SerpApi, only when the person confirms). The newest row per page is its state;
 *   older rows stay as history. `state` is `indexed`, `not_indexed`, or `unknown`
 *   when the search failed. `url` is the address that was checked.
 * - `loop_owners`: the owner label of each step of a round ("You", "Your team"),
 *   one row per renamed step. A missing row is the default label.
 * - `page_ai_texts`: Claude text cached per page: the suggested backlink anchor
 *   (`anchor`) and the Lost ground recovery plan (`recovery`). `input_key` names the
 *   inputs it was written for (for a plan, `<vsRunId>|<nowRunId>`); `edited` is 1
 *   once the person changed it, so a re-run never overwrites their words silently.
 */
export const FIX_LOOP_VERSION = 43

export const FIX_LOOP_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: FIX_LOOP_VERSION,
    name: `${String(FIX_LOOP_VERSION).padStart(3, '0')}_fix_loop`,
    up(db) {
      db.exec(`
        ALTER TABLE fixes ADD COLUMN kind TEXT NOT NULL DEFAULT 'fix'
          CHECK (kind IN ('new_page', 'rewrite', 'fix'));

        CREATE TABLE index_checks (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          state TEXT NOT NULL,
          checked_at TEXT NOT NULL,
          searches INTEGER NOT NULL,
          message TEXT,
          CHECK (length(id) > 0),
          CHECK (length(url) > 0),
          CHECK (state IN ('indexed', 'not_indexed', 'unknown')),
          CHECK (length(checked_at) > 0),
          CHECK (searches >= 0)
        );
        CREATE INDEX idx_index_checks_page ON index_checks (page_id, checked_at);

        CREATE TABLE loop_owners (
          step TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          CHECK (step IN ('measure', 'reoptimise', 'publish', 'index', 'backlinks')),
          CHECK (length(label) BETWEEN 1 AND 40)
        );

        CREATE TABLE page_ai_texts (
          page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          input_key TEXT NOT NULL,
          text TEXT NOT NULL,
          edited INTEGER NOT NULL DEFAULT 0,
          saved_at TEXT NOT NULL,
          PRIMARY KEY (page_id, kind),
          CHECK (kind IN ('anchor', 'recovery')),
          CHECK (length(text) BETWEEN 1 AND 8000),
          CHECK (edited IN (0, 1)),
          CHECK (length(saved_at) > 0)
        );
      `)
    }
  }
]
