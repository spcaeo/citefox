import type { Migration } from './migrate'

/**
 * App migration 023: cloro keys (multi-engine tracking).
 *
 * - `api_keys` is rebuilt so `provider` accepts `cloro`, with the balance a cloro key
 *   test reads (`cloro_remaining`, `cloro_per_cycle`, `cloro_resets_at`; null until a
 *   test, and only on a cloro key). `provider` is in a CHECK, so the table is copied
 *   (SQLite's twelve-step procedure, foreign keys off: `connection_events` references it).
 *   Every row and column is copied as it was.
 * - `key_usage.credits`: cloro credits charged per key, project and month, beside the
 *   searches. Existing rows are SerpApi and other providers: 0.
 */
export const CLORO_APP_VERSION = 23

export const CLORO_APP_MIGRATIONS: readonly Migration[] = [
  {
    version: CLORO_APP_VERSION,
    name: `${String(CLORO_APP_VERSION).padStart(3, '0')}_cloro_keys`,
    rebuildsTables: true,
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE api_keys_next (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          name TEXT NOT NULL,
          keychain_ref TEXT NOT NULL,
          rotation_order INTEGER NOT NULL,
          cap INTEGER,
          "on" INTEGER NOT NULL,
          project_ids TEXT NOT NULL,
          hint TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'unchecked',
          serpapi_used INTEGER,
          serpapi_limit INTEGER,
          serpapi_plan TEXT,
          last_reason TEXT,
          plan TEXT,
          cloro_remaining INTEGER,
          cloro_per_cycle INTEGER,
          cloro_resets_at TEXT,
          CHECK (provider IN ('serpapi', 'cloro', 'jina', 'anthropic', 'youtube')),
          CHECK ("on" IN (0, 1)),
          CHECK (cap IS NULL OR cap >= 0),
          CHECK (rotation_order >= 0),
          CHECK (length(keychain_ref) > 0),
          CHECK (length(name) > 0),
          CHECK (length(hint) = 0 OR length(hint) = 4),
          CHECK (state IN ('ok', 'warning', 'off', 'unchecked')),
          CHECK (serpapi_used IS NULL OR serpapi_used >= 0),
          CHECK (serpapi_limit IS NULL OR serpapi_limit >= 0),
          CHECK (
            (serpapi_used IS NULL AND serpapi_limit IS NULL AND serpapi_plan IS NULL)
            OR serpapi_used IS NOT NULL
          ),
          CHECK (
            provider = 'serpapi'
            OR (serpapi_used IS NULL AND serpapi_limit IS NULL AND serpapi_plan IS NULL)
          ),
          CHECK (cloro_remaining IS NULL OR cloro_remaining >= 0),
          CHECK (cloro_per_cycle IS NULL OR cloro_per_cycle >= 0),
          CHECK (
            cloro_remaining IS NOT NULL
            OR (cloro_per_cycle IS NULL AND cloro_resets_at IS NULL)
          ),
          CHECK (
            provider = 'cloro'
            OR (cloro_remaining IS NULL AND cloro_per_cycle IS NULL AND cloro_resets_at IS NULL)
          ),
          CHECK (json_valid(project_ids) AND json_type(project_ids) = 'array'),
          CHECK (
            last_reason IS NULL
            OR last_reason IN (
              'rejected',
              'out_of_searches',
              'rate_limited',
              'timeout',
              'other'
            )
          ),
          UNIQUE (keychain_ref)
        );

        INSERT INTO api_keys_next (
          id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
          serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan
        )
        SELECT
          id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
          serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan
        FROM api_keys
        ORDER BY rowid ASC;

        DROP TABLE api_keys;
        ALTER TABLE api_keys_next RENAME TO api_keys;
        CREATE INDEX idx_api_keys_provider ON api_keys (provider);
        CREATE INDEX idx_api_keys_provider_order ON api_keys (provider, rotation_order);

        ALTER TABLE key_usage ADD COLUMN credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0);
      `)
    }
  }
]
