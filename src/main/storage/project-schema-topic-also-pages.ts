import type { Migration } from './migrate'

/**
 * Project migration 058: `topic_prompts.also_urls_json`, the other pages of the own
 * site that may answer a question besides its target (primary) page. In SEO you never
 * know which page Google picks, and it can cite two for one query: Google citing any
 * of them counts as the right page. A JSON array of URLs; `[]` on every row before 058.
 */
export const TOPIC_ALSO_PAGES_VERSION = 58

export const TOPIC_ALSO_PAGES_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: TOPIC_ALSO_PAGES_VERSION,
    name: `${String(TOPIC_ALSO_PAGES_VERSION).padStart(3, '0')}_topic_also_pages`,
    up(db) {
      db.exec(`
        ALTER TABLE topic_prompts ADD COLUMN also_urls_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(also_urls_json) AND json_type(also_urls_json) = 'array');
      `)
    }
  }
]
