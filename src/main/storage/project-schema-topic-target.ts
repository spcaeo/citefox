import type { Migration } from './migrate'

/**
 * Project migration 047: `topics.target_url`, the topic's target page (the page on
 * the own site its questions should be cited from; src/shared/target-page.ts). A
 * check classifies a cited URL matching it as `target` (`page_cited`) and any other
 * own page as `own` (`other_own_page`). Null, as on every topic before 047, keeps
 * the old rule: every own page cited for a topic is `own`.
 */
export const TOPIC_TARGET_VERSION = 47

export const TOPIC_TARGET_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: TOPIC_TARGET_VERSION,
    name: `${String(TOPIC_TARGET_VERSION).padStart(3, '0')}_topic_target_page`,
    up(db) {
      db.exec(`
        ALTER TABLE topics ADD COLUMN target_url TEXT
          CHECK (target_url IS NULL OR (length(target_url) > 0 AND length(target_url) <= 2000));
      `)
    }
  }
]
