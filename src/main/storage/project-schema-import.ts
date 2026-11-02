import type { Migration } from './migrate'

/**
 * Project migration 038: the shared importer (deep audit crosscut §5).
 *
 * - `import_batches`: one row per committed import, so it can be undone as one step.
 *   `items_json` lists what the batch created (question prompt ids by page or topic,
 *   competitor and product rows, markets); `undone_at` is set once it is undone.
 * - `import_mappings`: a saved column match per kind of list and header signature
 *   (the folded header cells), with the meanings of the file's stage words.
 *
 * Times are ISO-8601 UTC.
 */
export const IMPORT_VERSION = 38

export const IMPORT_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: IMPORT_VERSION,
    name: `${String(IMPORT_VERSION).padStart(3, '0')}_import`,
    up(db) {
      db.exec(`
        CREATE TABLE import_batches (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL,
          created_at TEXT NOT NULL,
          items_json TEXT NOT NULL DEFAULT '[]',
          added INTEGER NOT NULL DEFAULT 0,
          undone_at TEXT,
          CHECK (length(id) > 0 AND length(id) <= 80),
          CHECK (entity IN ('questions', 'keywords', 'pages', 'competitors', 'products', 'markets')),
          CHECK (length(created_at) > 0),
          CHECK (added >= 0),
          CHECK (undone_at IS NULL OR length(undone_at) > 0)
        );
        CREATE TABLE import_mappings (
          entity TEXT NOT NULL,
          signature TEXT NOT NULL,
          mapping_json TEXT NOT NULL,
          stage_words_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (entity, signature),
          CHECK (length(signature) > 0 AND length(signature) <= 4000),
          CHECK (length(updated_at) > 0)
        );
      `)
    }
  }
]
