import type { Migration } from './migrate'

/**
 * Project migration 031: buyer context notes (Docs/FEEDBACK.md row 3). "Fill from my
 * website" sorts what it finds into competitors, options buyers switch from, and
 * integrations. The last two are never competitors; the user can keep them here
 * ("Use in buyer questions", "Note as integration") and prompt writing reads them.
 * A separate table, because `writeProjectProfile` replaces the `project_settings` row.
 */
export const BUYER_CONTEXT_VERSION = 31

export const BUYER_CONTEXT_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: BUYER_CONTEXT_VERSION,
    name: `${String(BUYER_CONTEXT_VERSION).padStart(3, '0')}_buyer_context`,
    up(db) {
      db.exec(`
        CREATE TABLE buyer_context (
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          position INTEGER NOT NULL,
          PRIMARY KEY (kind, name),
          CHECK (kind IN ('switching_from', 'integration')),
          CHECK (length(name) > 0 AND length(name) <= 120),
          CHECK (position >= 0)
        );
      `)
    }
  }
]
