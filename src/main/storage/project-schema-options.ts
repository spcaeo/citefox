import type { Migration } from './migrate'

/**
 * Project migrations owned by the projects-at-scale work (FR-10.3, FR-11.7, LLM-5, TPL-1).
 * Spread into `PROJECT_MIGRATIONS` as version 17.
 */
export const PROJECT_OPTION_MIGRATIONS: readonly Migration[] = [
  // ---- Project migration 017: project options (projects-at-scale) ------------------------
  {
    version: 17,
    name: '017_project_options',
    up(db) {
      // One row. A missing row means: Claude follows Settings, fallback "wait",
      // the app model, the app's default samples, and no template overrides.
      // claude_key_id and claude_fallback_key_id are api_keys ids from app.sqlite,
      // never secrets, so they are not foreign keys. The table is separate from
      // project_settings because writeProjectProfile replaces that row.
      db.exec(`
        CREATE TABLE project_options (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          claude_connection TEXT NOT NULL DEFAULT 'app_default',
          claude_key_id TEXT,
          claude_fallback TEXT NOT NULL DEFAULT 'wait',
          claude_fallback_key_id TEXT,
          claude_model TEXT,
          default_samples INTEGER,
          template_overrides TEXT NOT NULL DEFAULT '[]',
          CHECK (claude_connection IN ('app_default', 'claude_code', 'api_key')),
          CHECK (claude_fallback IN ('wait', 'switch_key', 'retry_later', 'ask')),
          CHECK (
            (claude_connection = 'api_key' AND claude_key_id IS NOT NULL AND length(claude_key_id) > 0)
            OR (claude_connection <> 'api_key' AND claude_key_id IS NULL)
          ),
          CHECK (
            (claude_fallback = 'switch_key' AND claude_fallback_key_id IS NOT NULL
              AND length(claude_fallback_key_id) > 0)
            OR (claude_fallback <> 'switch_key' AND claude_fallback_key_id IS NULL)
          ),
          CHECK (claude_model IS NULL OR (length(claude_model) > 0 AND length(claude_model) <= 81)),
          CHECK (default_samples IS NULL OR (default_samples >= 1 AND default_samples <= 5)),
          CHECK (json_valid(template_overrides) AND json_type(template_overrides) = 'array')
        );
      `)
    }
  }
]
