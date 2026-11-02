import type { Migration } from './migrate'

/**
 * Project migration 041: `gap_states`, what the person changed on a content gap
 * (Content gaps tab): their own FAQ draft (Claude's stays on `coverage_rows`),
 * where it stands (open, published, verified) and the live section URL. One row
 * per page and prompt, so it outlives a rewritten matrix. Times are ISO-8601 UTC.
 */
export const GAP_STATES_VERSION = 41

export const GAP_STATES_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: GAP_STATES_VERSION,
    name: `${String(GAP_STATES_VERSION).padStart(3, '0')}_gap_states`,
    up(db) {
      db.exec(`
        CREATE TABLE gap_states (
          page_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          status TEXT,
          published_url TEXT,
          faq_question TEXT,
          faq_answer TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (page_id, prompt_id),
          CHECK (length(prompt_id) > 0),
          CHECK (status IS NULL OR status IN ('open', 'published', 'verified')),
          CHECK (published_url IS NULL OR length(published_url) BETWEEN 1 AND 2000),
          CHECK ((faq_question IS NULL) = (faq_answer IS NULL)),
          CHECK (length(updated_at) > 0),
          FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
        );
      `)
    }
  }
]
