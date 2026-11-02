import type { Migration } from './migrate'

/**
 * Project migration 054: fixes measured on their page wherever their searches come
 * from (Fixes › "I published this", Changes › Did it work?).
 *
 * - `fixes.url`: the page address the fix is about, when the fix is stored on a
 *   topic (a topic has no address) or on a page whose address is not tracked. Null
 *   on a page fix: the page's own address counts. A fix on a topic with a target
 *   page takes that target, so fixes logged on topics before 054 reach the ledger.
 * - `fixes.page_fix_id`: the What to fix page fix it was logged from (`pageFixIdOf`),
 *   so the page fix's drawer can say "Live since …". Null for every older fix.
 * - `fixes.worked_noted_at`: when Activity said the fix is working, so it says it once.
 *
 * A fix's searches (`fix_prompts`) may now come from any page or topic of the
 * project: the storage check moved from "on this page" to "in this project file".
 */
export const FIX_VERDICTS_VERSION = 54

export const FIX_VERDICTS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: FIX_VERDICTS_VERSION,
    name: `${String(FIX_VERDICTS_VERSION).padStart(3, '0')}_fix_verdicts`,
    up(db) {
      db.exec(`
        ALTER TABLE fixes ADD COLUMN url TEXT
          CHECK (url IS NULL OR (length(url) > 0 AND length(url) <= 2000));
        ALTER TABLE fixes ADD COLUMN page_fix_id TEXT
          CHECK (page_fix_id IS NULL OR length(page_fix_id) BETWEEN 1 AND 80);
        ALTER TABLE fixes ADD COLUMN worked_noted_at TEXT
          CHECK (worked_noted_at IS NULL OR length(worked_noted_at) > 0);
        UPDATE fixes SET url = (
          SELECT topics.target_url FROM topics WHERE topics.page_id = fixes.page_id
        )
        WHERE url IS NULL AND EXISTS (
          SELECT 1 FROM topics WHERE topics.page_id = fixes.page_id AND topics.target_url IS NOT NULL
        );
        CREATE INDEX idx_fixes_page_fix ON fixes (page_fix_id) WHERE page_fix_id IS NOT NULL;
      `)
    }
  }
]
