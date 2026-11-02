import type { Migration } from './migrate'

/**
 * Project migration 042: `first_check_waits.check_when_ready`, the page's own
 * "Add and check now" (Add a page). Before, the ask lived in memory only, so a
 * quit before setup was ready lost it and the page waited for the user with no
 * sign of the ask. Now it is stored with the page's first-check wait: the setup
 * runner starts the first check when the page is ready, after a restart too,
 * and the page says its first check is pending until then.
 */
export const CHECK_ASKS_VERSION = 42

export const CHECK_ASKS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: CHECK_ASKS_VERSION,
    name: `${String(CHECK_ASKS_VERSION).padStart(3, '0')}_check_asks`,
    up(db) {
      db.exec(`
        ALTER TABLE first_check_waits ADD COLUMN check_when_ready INTEGER NOT NULL DEFAULT 0
          CHECK (check_when_ready IN (0, 1));
      `)
    }
  }
]
