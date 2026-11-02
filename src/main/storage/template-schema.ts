import type { Migration } from './migrate'

/**
 * Template editor and Claude call log migrations (FR-25.6, FR-26, TPL-1).
 *
 * App 020 `020_template_versions_and_llm_calls`:
 * - rebuilds `templates` without the kind CHECK, so a step another area adds
 *   (and the check steps `aio_gap` and `run_summary`) needs no rebuild of its own.
 *   The engine validates kinds against `GENERATION_TEMPLATE_KINDS`.
 * - `template_versions`: every saved body of an app template, so a hash on a past
 *   prompt set or check always names wording CiteFox still has (FR-26.4, TPL-4).
 * - `llm_calls` for Claude calls outside a project (playground, Status assists).
 *
 * Project 022 `022_template_overrides_and_llm_calls`:
 * - `template_overrides`: a project's own versions of a step (TPL-1, FR-26.8).
 *   Rows are never changed except `reset_at`, which Reset to default sets on
 *   every version of that step.
 * - `llm_calls` (section 10) for every Claude call that belongs to the project.
 */

const LLM_CALL_COLUMNS = `
  id TEXT PRIMARY KEY,
  connection TEXT NOT NULL,
  model TEXT,
  source TEXT NOT NULL,
  template_kind TEXT,
  template_id TEXT,
  template_hash TEXT,
  assist_id TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  CHECK (connection IN ('claude-code', 'anthropic-api')),
  CHECK (source IN ('pipeline', 'report', 'assist', 'playground', 'ask', 'other')),
  CHECK (duration_ms >= 0),
  CHECK (tokens_in >= 0),
  CHECK (tokens_out >= 0),
  CHECK (ok IN (0, 1)),
  CHECK (length(started_at) > 0)`

export const TEMPLATE_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 20,
    name: '020_template_versions_and_llm_calls',
    rebuildsTables: true,
    up(db) {
      db.exec(`
        CREATE TABLE templates_020 (
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
        INSERT INTO templates_020 (
          id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
          is_default, is_shipped, created_at, updated_at
        )
        SELECT id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
          is_default, is_shipped, created_at, updated_at
        FROM templates;
        DROP TABLE templates;
        ALTER TABLE templates_020 RENAME TO templates;
        CREATE UNIQUE INDEX idx_templates_one_default
          ON templates (kind)
          WHERE is_default = 1 AND deleted_at IS NULL;
        CREATE UNIQUE INDEX idx_templates_one_shipped
          ON templates (kind)
          WHERE is_shipped = 1;

        CREATE TABLE template_versions (
          template_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          hash TEXT NOT NULL,
          body TEXT NOT NULL,
          settings_json TEXT,
          saved_at TEXT NOT NULL,
          PRIMARY KEY (template_id, version),
          CHECK (version >= 1),
          CHECK (length(hash) > 0),
          CHECK (length(body) > 0),
          CHECK (length(saved_at) > 0),
          CHECK (
            settings_json IS NULL
            OR (json_valid(settings_json) AND json_type(settings_json) = 'object')
          )
        );
        INSERT INTO template_versions (template_id, version, hash, body, settings_json, saved_at)
        SELECT id, version, hash, body, settings_json, COALESCE(updated_at, created_at)
        FROM templates;

        CREATE TABLE llm_calls (
          project_id TEXT,
          ${LLM_CALL_COLUMNS}
        );
        CREATE INDEX idx_llm_calls_started ON llm_calls (started_at);
      `)
    }
  }
]

export const TEMPLATE_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: 22,
    name: '022_template_overrides_and_llm_calls',
    up(db) {
      db.exec(`
        CREATE TABLE template_overrides (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          version INTEGER NOT NULL,
          base_template_id TEXT NOT NULL,
          body TEXT NOT NULL,
          hash TEXT NOT NULL,
          settings_json TEXT,
          created_at TEXT NOT NULL,
          reset_at TEXT,
          UNIQUE (kind, version),
          CHECK (length(kind) > 0 AND length(kind) <= 40),
          CHECK (version >= 1),
          CHECK (length(body) > 0),
          CHECK (length(hash) > 0),
          CHECK (length(created_at) > 0),
          CHECK (reset_at IS NULL OR length(reset_at) > 0),
          CHECK (
            settings_json IS NULL
            OR (json_valid(settings_json) AND json_type(settings_json) = 'object')
          )
        );
        CREATE TABLE llm_calls (
          ${LLM_CALL_COLUMNS}
        );
        CREATE INDEX idx_llm_calls_started ON llm_calls (started_at);
      `)
    }
  }
]
