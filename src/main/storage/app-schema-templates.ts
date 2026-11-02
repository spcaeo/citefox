import type { Migration } from './migrate'

/**
 * App migration 019 (brand sentiment, SRS 4.16 and 9.1).
 *
 * Migration 005 limited `templates.kind` to the first three kinds. FR-26.1 adds
 * `brand_prompts` and `sentiment_claims`, and other steps follow. This rebuild
 * keeps every column, row, and index and replaces the closed kind list with a
 * non-empty check. The kind is validated in code (`normalizeTemplate` and
 * `isGenerationTemplateKind`), so a later kind needs no table rebuild.
 */
export const TEMPLATE_KIND_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 19,
    name: '019_template_kinds_open',
    rebuildsTables: true,
    up(db) {
      db.exec(`
        CREATE TABLE templates_019 (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version INTEGER NOT NULL,
          hash TEXT NOT NULL,
          body TEXT NOT NULL,
          "schema" TEXT,
          settings_json TEXT,
          kind TEXT NOT NULL,
          notes TEXT,
          deleted_at TEXT,
          is_default INTEGER NOT NULL,
          is_shipped INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          CHECK (version >= 1),
          CHECK (length(name) > 0 AND length(name) <= 80),
          CHECK (length(hash) > 0),
          CHECK (length(body) > 0),
          CHECK (length(kind) > 0 AND length(kind) <= 40),
          CHECK (is_default IN (0, 1)),
          CHECK (is_shipped IN (0, 1)),
          CHECK (deleted_at IS NULL OR length(deleted_at) > 0),
          CHECK (notes IS NULL OR (length(notes) > 0 AND length(notes) <= 500)),
          CHECK (is_default = 0 OR deleted_at IS NULL),
          CHECK (length(created_at) > 0),
          CHECK (
            settings_json IS NULL
            OR (json_valid(settings_json) AND json_type(settings_json) = 'object')
          )
        );

        INSERT INTO templates_019 (
          id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
          is_default, is_shipped, created_at, updated_at
        )
        SELECT
          id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
          is_default, is_shipped, created_at, updated_at
        FROM templates;

        DROP TABLE templates;
        ALTER TABLE templates_019 RENAME TO templates;
        CREATE UNIQUE INDEX idx_templates_one_default
          ON templates (kind)
          WHERE is_default = 1 AND deleted_at IS NULL;
        CREATE UNIQUE INDEX idx_templates_one_shipped
          ON templates (kind)
          WHERE is_shipped = 1;
      `)
    }
  }
]
