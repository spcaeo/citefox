import type { Migration } from './migrate'

/**
 * App migration 022: which pages a scheduled report covers. It follows the
 * notices migration 021.
 */
export const REPORT_SCOPE_APP_VERSION = 22

export const REPORT_SCOPE_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: REPORT_SCOPE_APP_VERSION,
    name: `${String(REPORT_SCOPE_APP_VERSION).padStart(3, '0')}_report_schedule_scope`,
    up(db) {
      // `scope_json` is `{ "kind": "pages" | "group" | "cluster" | "topic", "ids": [...] }`.
      // NULL is the whole project, so every existing schedule keeps reporting on
      // the whole project. ADD COLUMN leaves deliveries and deleted_at alone.
      db.exec(`
        ALTER TABLE report_schedules ADD COLUMN scope_json TEXT
          CHECK (scope_json IS NULL OR (json_valid(scope_json) AND json_type(scope_json) = 'object'));
      `)
    }
  }
]
