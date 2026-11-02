import type { Migration } from './migrate'

/**
 * App migration 025: which ready report a scheduled email sends (Visibility, What
 * changed, Impact review, Pitch / audit, Content plan, Head-to-head). It follows the
 * Codex connection migration 024 (renumber at merge if another branch took 025).
 */
export const REPORT_KIND_APP_VERSION = 25

export const REPORT_KIND_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: REPORT_KIND_APP_VERSION,
    name: `${String(REPORT_KIND_APP_VERSION).padStart(3, '0')}_report_schedule_report`,
    up(db) {
      // `report_json` is `{ "kind": "visibility" | … | "rival", "rival": "twilio.com" | null }`.
      // NULL is the check summary report built from `sections`, so every existing
      // schedule keeps sending what it sends today.
      db.exec(`
        ALTER TABLE report_schedules ADD COLUMN report_json TEXT
          CHECK (report_json IS NULL OR (json_valid(report_json) AND json_type(report_json) = 'object'));
      `)
    }
  }
]
