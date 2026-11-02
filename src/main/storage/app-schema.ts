import {
  DEFAULT_REPORT_SCHEDULE_STATUS,
  DELIVERY_OUTCOMES,
  DELIVERY_TRIGGERS,
  REPORT_FORMATS,
  REPORT_SCHEDULE_STATUSES,
  SHIPPED_TEMPLATE_NAME
} from '@shared/domain'
import type { GenerationTemplateKind } from '@shared/domain'
import { StorageError } from './errors'
import type { Migration } from './migrate'
import { SCHEDULING_APP_MIGRATIONS } from './app-schema-scheduling'
import { ACTIVITY_APP_MIGRATIONS } from './app-schema-activity'
import { TEMPLATE_KIND_APP_MIGRATIONS } from './app-schema-templates'
import { TEMPLATE_APP_MIGRATIONS } from './template-schema'
import { NOTICES_APP_MIGRATIONS } from './app-schema-notices'
import { REPORT_SCOPE_APP_MIGRATIONS } from './app-schema-report-scope'
import { CLORO_APP_MIGRATIONS } from './app-schema-cloro'
import { CODEX_CONNECTION_APP_MIGRATIONS } from './schema-codex-connection'
import { REPORT_KIND_APP_MIGRATIONS } from './app-schema-report-kind'

/**
 * App database tables from SRS section 10.
 *
 * `email_accounts`, `report_schedules`, and `deliveries` are migration 010.
 * SMTP passwords and tokens are not columns. `keychain_ref` is the keychain id
 * only (NFR-5). `last_test` is one column: null, or a JSON object with the
 * existing EmailAccount fields `at`, `ok`, `message`, and `nextStep`.
 * `report_schedules.status` is `active` or `paused` and defaults to `active`.
 * `report_schedules.format` is the FR-23.7 list, not export formats.
 * `deliveries` keeps section 10 `ok` and `error`. `outcome` is `sent`, `draft`,
 * or `failed`, and `ok` is 1 only when `outcome` is `sent`.
 * `occurrence_key` is null, or unique per schedule when it is set.
 * Migration 011 adds a second partial unique index so a NULL `schedule_id`
 * does not make the same key distinct. That covers check_summary, slack, cap,
 * and monthly_pdf. Existing rows stay. A later duplicate key is set to NULL
 * so the earliest rowid keeps the key. The scheduled index is unchanged.
 * `pending_client_pdfs` is unique on `(project_id, due_date)`.
 * Migration 012 adds `report_schedules.created_at` (ISO-8601 UTC, NOT NULL)
 * and nullable `deliveries.next_step`. The constant default
 * `1970-01-01T00:00:00.000Z` is never used because inserts always pass
 * `created_at`. It exists only so SQLite can add a NOT NULL column. Existing
 * rows are then set to the migration time.
 * Migration 013 (`013_report_schedules_soft_delete`) adds nullable
 * `report_schedules.deleted_at` (ISO-8601 UTC). NULL means the schedule is
 * live. Existing rows stay NULL. `deliveries` and their foreign keys stay,
 * so delivery history is kept.
 * `hint` is the last 4 characters of the secret, or empty when the secret is
 * 8 characters or fewer. The secret itself has no column.
 * Migration 001 stored one row per provider (`UNIQUE (provider)`).
 * Migration 014 (`014_api_keys_multi`) drops that constraint so one provider
 * can have several keys (FR-11.1). Each row keeps its id, `name` (the label),
 * `rotation_order` (the stable priority, FR-11.2), `"on"` (enabled), `cap`,
 * `project_ids`, and the SerpApi plan usage columns (SERP-7). Month usage
 * stays in `key_usage` (SERP-6). `keychain_ref` stays unique and is still not
 * the secret (SERP-1, FR-11.11).
 * Migration 015 (`015_api_keys_plan`) adds nullable `plan` for the user-entered
 * plan name on every provider (FR-11.1). It is not the SerpApi account plan.
 * `state` is ok, warning, off, or unchecked. A new key is unchecked until tested.
 * `last_reason` is the last failed key test or provider call. It is null when
 * `state` is ok, unchecked, or off, and one of rejected, out_of_searches,
 * rate_limited, timeout, or other when `state` is warning.
 * SerpApi account usage (SERP-7) is stored beside the key and stays null until a test.
 *
 * An empty `project_ids` array means the key serves every project.
 * A NULL `cap` means the key has no cap. Zero is a real cap of zero.
 *
 * `claude_checkups` is the Run checkup history (LLM-8). The latest row is the
 * current checkup. `detail_json` is a ClaudeCheckupResult and holds no secret.
 * `binary_ok`, `login_ok`, and `roundtrip_ok` are 1 only when that phase passed.
 */
export const APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '001_app_tables',
    up(db) {
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          domain TEXT NOT NULL,
          db_path TEXT NOT NULL,
          client_name TEXT,
          status TEXT NOT NULL,
          CHECK (status IN ('active', 'paused', 'archived')),
          CHECK (length(name) > 0),
          CHECK (length(slug) > 0),
          CHECK (length(domain) > 0),
          CHECK (instr(slug, '/') = 0 AND instr(slug, '\\') = 0 AND instr(slug, '..') = 0),
          CHECK (db_path = 'projects/' || slug || '.sqlite'),
          UNIQUE (slug)
        );

        CREATE TABLE api_keys (
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
          CHECK (provider IN ('serpapi', 'jina', 'anthropic', 'youtube')),
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
          CHECK (json_valid(project_ids) AND json_type(project_ids) = 'array'),
          UNIQUE (provider),
          UNIQUE (keychain_ref)
        );

        CREATE TABLE key_usage (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          month TEXT NOT NULL,
          searches INTEGER NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          tokens INTEGER NOT NULL DEFAULT 0,
          CHECK (searches >= 0),
          CHECK (calls >= 0),
          CHECK (tokens >= 0),
          CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          UNIQUE (key_id, project_id, month),
          FOREIGN KEY (key_id) REFERENCES api_keys (id),
          FOREIGN KEY (project_id) REFERENCES projects (id)
        );

        CREATE TABLE connection_events (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          detail TEXT,
          CHECK (kind IN ('rate_limited', 'failed', 'cap_reached', 'failover')),
          CHECK (length(at) > 0),
          FOREIGN KEY (key_id) REFERENCES api_keys (id)
        );

        CREATE TABLE templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version INTEGER NOT NULL,
          hash TEXT NOT NULL,
          body TEXT NOT NULL,
          "schema" TEXT,
          settings_json TEXT,
          CHECK (version >= 1),
          CHECK (length(name) > 0),
          CHECK (length(hash) > 0),
          CHECK (length(body) > 0),
          UNIQUE (name, version)
        );

        CREATE INDEX idx_api_keys_provider ON api_keys (provider);
        CREATE INDEX idx_key_usage_month ON key_usage (month);
        CREATE INDEX idx_connection_events_at ON connection_events (at);
      `)
    }
  },
  {
    version: 2,
    name: '002_claude_checkups',
    up(db) {
      db.exec(`
        CREATE TABLE claude_checkups (
          id TEXT PRIMARY KEY,
          ran_at TEXT NOT NULL,
          binary_ok INTEGER NOT NULL,
          login_ok INTEGER NOT NULL,
          roundtrip_ok INTEGER NOT NULL,
          detail_json TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(ran_at) > 0),
          CHECK (binary_ok IN (0, 1)),
          CHECK (login_ok IN (0, 1)),
          CHECK (roundtrip_ok IN (0, 1)),
          CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object')
        );

        CREATE INDEX idx_claude_checkups_ran_at ON claude_checkups (ran_at);
      `)
    }
  },
  {
    version: 3,
    name: '003_onboarding_finished',
    up(db) {
      db.exec(`
        CREATE TABLE app_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          onboarding_finished INTEGER NOT NULL DEFAULT 0,
          CHECK (onboarding_finished IN (0, 1))
        );

        INSERT INTO app_state (id, onboarding_finished) VALUES (1, 0);
      `)
    }
  },
  {
    version: 4,
    name: '004_api_keys_last_reason',
    up(db) {
      db.exec(`
        ALTER TABLE api_keys ADD COLUMN last_reason TEXT
          CHECK (
            last_reason IS NULL
            OR last_reason IN (
              'rejected',
              'out_of_searches',
              'rate_limited',
              'timeout',
              'other'
            )
          );
      `)
    }
  },
  {
    version: 5,
    name: '005_named_templates',
    rebuildsTables: true,
    up(db) {
      // `name` already exists from 001. This rebuild keeps it NOT NULL, adds kind,
      // soft-delete, default, and shipped columns, and drops UNIQUE (name, version)
      // so each kind can have its own "CiteFox default".
      db.exec(`
        CREATE TABLE templates_next (
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
          CHECK (kind IN ('buyer_profile', 'buyer_prompts', 'coverage')),
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
      `)
      const rows = db
        .prepare<unknown[], TemplateV4Row>(
          `SELECT id, name, version, hash, body, "schema", settings_json FROM templates`
        )
        .all()
      const createdAt = new Date().toISOString()
      const insert = db.prepare(
        `INSERT INTO templates_next (
           id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
           is_default, is_shipped, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`
      )
      for (const row of rows) {
        const kind = kindFromLegacy(row)
        const shipped = SHIPPED_SEED_IDS.has(row.id)
        insert.run(
          row.id,
          shipped ? SHIPPED_TEMPLATE_NAME : row.name,
          row.version,
          row.hash,
          row.body,
          row.schema,
          settingsWithoutKind(row.settings_json),
          kind,
          shipped ? 1 : 0,
          shipped ? 1 : 0,
          createdAt
        )
      }
      db.exec(`
        DROP TABLE templates;
        ALTER TABLE templates_next RENAME TO templates;
        CREATE UNIQUE INDEX idx_templates_one_default
          ON templates (kind)
          WHERE is_default = 1 AND deleted_at IS NULL;
        CREATE UNIQUE INDEX idx_templates_one_shipped
          ON templates (kind)
          WHERE is_shipped = 1;
      `)
    }
  },
  {
    version: 6,
    name: '006_active_project',
    up(db) {
      db.exec(`
        ALTER TABLE app_state ADD COLUMN active_project_id TEXT;
      `)
    }
  },
  {
    version: 7,
    name: '007_tray_history',
    up(db) {
      // FR-24.6. The menu shows the latest 5 (TRAY_MENU_CHECK_LIMIT). The SRS
      // states no retention cap, so older rows stay.
      db.exec(`
        CREATE TABLE tray_history (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          label TEXT NOT NULL,
          score INTEGER,
          "change" INTEGER,
          finished_at TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(project_id) > 0),
          CHECK (length(page_id) > 0),
          CHECK (length(label) > 0 AND length(label) <= 300),
          CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
          CHECK ("change" IS NULL OR ("change" BETWEEN -100 AND 100)),
          CHECK (length(finished_at) > 0),
          FOREIGN KEY (project_id) REFERENCES projects (id)
        );

        CREATE INDEX idx_tray_history_finished ON tray_history (finished_at);
      `)
    }
  },
  {
    version: 8,
    name: '008_day_pass',
    up(db) {
      // SCH-2 and decision 26. One row per local date, shared by the tray and
      // a separate citefox --check-due process. job_ids is the pass result.
      db.exec(`
        CREATE TABLE day_pass (
          day TEXT PRIMARY KEY,
          job_ids TEXT NOT NULL,
          pages INTEGER NOT NULL,
          CHECK (length(day) = 10 AND substr(day, 5, 1) = '-' AND substr(day, 8, 1) = '-'),
          CHECK (json_valid(job_ids) AND json_type(job_ids) = 'array'),
          CHECK (pages >= 0)
        );
      `)
    }
  },
  {
    version: 9,
    name: '009_key_usage_nullable_project',
    rebuildsTables: true,
    up(db) {
      // A playground check with no active project stores project_id NULL.
      // Existing rows are copied. ifnull makes that NULL row unique per key and month.
      db.exec(`
        CREATE TABLE key_usage_next (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          project_id TEXT,
          month TEXT NOT NULL,
          searches INTEGER NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          tokens INTEGER NOT NULL DEFAULT 0,
          CHECK (searches >= 0),
          CHECK (calls >= 0),
          CHECK (tokens >= 0),
          CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          CHECK (project_id IS NULL OR length(project_id) > 0),
          FOREIGN KEY (key_id) REFERENCES api_keys (id),
          FOREIGN KEY (project_id) REFERENCES projects (id)
        );

        INSERT INTO key_usage_next (id, key_id, project_id, month, searches, calls, tokens)
        SELECT id, key_id, project_id, month, searches, calls, tokens FROM key_usage;

        DROP TABLE key_usage;
        ALTER TABLE key_usage_next RENAME TO key_usage;

        CREATE UNIQUE INDEX idx_key_usage_key_project_month
          ON key_usage (key_id, ifnull(project_id, ''), month);
        CREATE INDEX idx_key_usage_month ON key_usage (month);
      `)
    }
  },
  {
    version: 10,
    name: '010_email_tables',
    up(db) {
      // Section 10. FR-23.2 providers, FR-23.3 security, FR-23.5 one default,
      // FR-23.7 report fields, FR-23.10 summary style, FR-23.11 delivery history.
      // Lists are JSON arrays, the same way `project_ids` is stored.
      // `schedule_id` is nullable: a send that is not a scheduled report still
      // belongs in delivery history. `status` has no value list in section 10.
      db.exec(`
        CREATE TABLE email_accounts (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          from_name TEXT NOT NULL,
          from_address TEXT NOT NULL,
          reply_to TEXT,
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          security TEXT NOT NULL,
          username TEXT NOT NULL,
          keychain_ref TEXT NOT NULL,
          is_default INTEGER NOT NULL,
          last_test TEXT,
          CHECK (length(id) > 0),
          CHECK (provider IN (
            'gmail', 'microsoft365', 'ses', 'sendgrid', 'mailgun', 'resend', 'postmark', 'other'
          )),
          CHECK (length(from_name) > 0),
          CHECK (length(from_address) > 0),
          CHECK (reply_to IS NULL OR length(reply_to) > 0),
          CHECK (length(host) > 0),
          CHECK (port BETWEEN 1 AND 65535),
          CHECK (security IN ('starttls', 'ssl', 'none')),
          CHECK (length(username) > 0),
          CHECK (length(keychain_ref) > 0),
          CHECK (is_default IN (0, 1)),
          CHECK (
            last_test IS NULL
            OR (json_valid(last_test) AND json_type(last_test) = 'object')
          ),
          UNIQUE (keychain_ref)
        );

        CREATE UNIQUE INDEX idx_email_accounts_one_default
          ON email_accounts (is_default)
          WHERE is_default = 1;

        CREATE TABLE report_schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_id TEXT,
          timing_json TEXT NOT NULL,
          format TEXT NOT NULL,
          sections TEXT NOT NULL,
          markets TEXT NOT NULL,
          recipients TEXT NOT NULL,
          account_id TEXT,
          time_zone TEXT NOT NULL,
          subject TEXT NOT NULL,
          summary_style TEXT,
          status TEXT NOT NULL DEFAULT ${sqlText(DEFAULT_REPORT_SCHEDULE_STATUS)},
          CHECK (length(id) > 0),
          CHECK (length(name) > 0),
          CHECK (project_id IS NULL OR length(project_id) > 0),
          CHECK (json_valid(timing_json) AND json_type(timing_json) = 'object'),
          CHECK (format IN (${sqlTextList(REPORT_FORMATS)})),
          CHECK (json_valid(sections) AND json_type(sections) = 'array'),
          CHECK (json_valid(markets) AND json_type(markets) = 'array'),
          CHECK (json_valid(recipients) AND json_type(recipients) = 'array'),
          CHECK (account_id IS NULL OR length(account_id) > 0),
          CHECK (length(time_zone) > 0),
          CHECK (length(subject) > 0),
          CHECK (summary_style IS NULL OR summary_style IN ('standard', 'client_friendly')),
          CHECK (status IN (${sqlTextList(REPORT_SCHEDULE_STATUSES)})),
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES email_accounts (id) ON DELETE SET NULL
        );

        CREATE TABLE deliveries (
          id TEXT PRIMARY KEY,
          schedule_id TEXT,
          at TEXT NOT NULL,
          trigger TEXT NOT NULL,
          project_id TEXT,
          recipients TEXT NOT NULL,
          ok INTEGER NOT NULL,
          error TEXT,
          outcome TEXT NOT NULL,
          occurrence_key TEXT,
          CHECK (length(id) > 0),
          CHECK (schedule_id IS NULL OR length(schedule_id) > 0),
          CHECK (length(at) > 0),
          CHECK (trigger IN (${sqlTextList(DELIVERY_TRIGGERS)})),
          CHECK (project_id IS NULL OR length(project_id) > 0),
          CHECK (json_valid(recipients) AND json_type(recipients) = 'array'),
          CHECK (ok IN (0, 1)),
          CHECK (error IS NULL OR length(error) > 0),
          CHECK (outcome IN (${sqlTextList(DELIVERY_OUTCOMES)})),
          CHECK (ok = (outcome = 'sent')),
          CHECK (occurrence_key IS NULL OR length(occurrence_key) > 0),
          FOREIGN KEY (schedule_id) REFERENCES report_schedules (id) ON DELETE SET NULL,
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

        CREATE INDEX idx_report_schedules_project ON report_schedules (project_id);
        CREATE INDEX idx_deliveries_at ON deliveries (at);
        CREATE INDEX idx_deliveries_schedule ON deliveries (schedule_id);
        CREATE INDEX idx_deliveries_project ON deliveries (project_id);
        CREATE UNIQUE INDEX idx_deliveries_occurrence
          ON deliveries (schedule_id, occurrence_key)
          WHERE occurrence_key IS NOT NULL;
      `)
    }
  },
  {
    version: 11,
    name: '011_email_mode_throttle_pdfs',
    up(db) {
      // FR-23.1 one email mode. FR-23.13 monthly client PDF index.
      // Throttle keys are opaque and caller-built. `marked_at` is ISO-8601 UTC (NFR-15).
      // PDF bytes are files under the outbox, never a blob (NFR-5).
      // `idx_deliveries_occurrence` treats NULL schedule_id as distinct, so
      // check_summary, slack, cap, and monthly_pdf need their own unique index.
      db.exec(`
        CREATE TABLE email_mode (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          mode TEXT NOT NULL DEFAULT 'smtp',
          CHECK (mode IN ('smtp', 'mail_app'))
        );

        INSERT INTO email_mode (id) VALUES (1);

        CREATE TABLE email_throttle (
          key TEXT PRIMARY KEY,
          marked_at TEXT NOT NULL,
          CHECK (length(key) > 0),
          CHECK (length(marked_at) > 0)
        );

        CREATE TABLE pending_client_pdfs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          project_name TEXT NOT NULL,
          due_date TEXT NOT NULL,
          filename TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(project_id) > 0),
          CHECK (length(project_name) > 0),
          CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          CHECK (length(filename) > 0),
          CHECK (instr(filename, '/') = 0),
          CHECK (instr(filename, char(92)) = 0),
          CHECK (bytes >= 0),
          CHECK (length(created_at) > 0),
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

        CREATE INDEX idx_pending_client_pdfs_due ON pending_client_pdfs (due_date, id);
        CREATE UNIQUE INDEX idx_pending_client_pdfs_project_due
          ON pending_client_pdfs (project_id, due_date);

        -- Version 10 treated NULL schedule_id as distinct, so the same key could
        -- be stored twice. Keep every row. Clear the key on later duplicates,
        -- then enforce one key.
        UPDATE deliveries
        SET occurrence_key = NULL
        WHERE rowid IN (
          SELECT rowid FROM deliveries
          WHERE schedule_id IS NULL
            AND occurrence_key IS NOT NULL
            AND rowid NOT IN (
              SELECT MIN(rowid) FROM deliveries
              WHERE schedule_id IS NULL AND occurrence_key IS NOT NULL
              GROUP BY occurrence_key
            )
        );

        CREATE UNIQUE INDEX idx_deliveries_unscheduled_occurrence
          ON deliveries (occurrence_key)
          WHERE schedule_id IS NULL AND occurrence_key IS NOT NULL;
      `)
    }
  },
  {
    version: 12,
    name: '012_schedule_created_at_delivery_next_step',
    up(db) {
      // created_at is ISO-8601 UTC (NFR-15). The constant default is never used
      // because inserts always pass created_at. It exists only so SQLite can
      // add a NOT NULL column. Existing rows are then set to this migration's time.
      // ADD COLUMN leaves deliveries.schedule_id alone, so two scheduled rows
      // that share an occurrence_key do not hit idx_deliveries_unscheduled_occurrence.
      const createdAt = new Date().toISOString()
      db.exec(`
        ALTER TABLE report_schedules ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z' CHECK (length(created_at) > 0);
        ALTER TABLE deliveries ADD COLUMN next_step TEXT;
      `)
      db.prepare(`UPDATE report_schedules SET created_at = ?`).run(createdAt)
    }
  },
  {
    version: 13,
    name: '013_report_schedules_soft_delete',
    up(db) {
      // deleted_at is an ISO-8601 UTC timestamp. NULL means the schedule is live.
      // ADD COLUMN leaves every existing row NULL and does not touch deliveries.
      db.exec(`
        ALTER TABLE report_schedules ADD COLUMN deleted_at TEXT;
      `)
    }
  },
  {
    version: 14,
    name: '014_api_keys_multi',
    rebuildsTables: true,
    up(db) {
      // UNIQUE (provider) is a table constraint, so the table is rebuilt.
      // Child tables are copied first because their foreign keys point here.
      // Every existing column is copied. The secret has never been a column.
      db.exec(`
        CREATE TABLE api_keys_014 (
          id TEXT NOT NULL,
          provider TEXT NOT NULL,
          name TEXT NOT NULL,
          keychain_ref TEXT NOT NULL,
          rotation_order INTEGER NOT NULL,
          cap INTEGER,
          "on" INTEGER NOT NULL,
          project_ids TEXT NOT NULL,
          hint TEXT NOT NULL,
          state TEXT NOT NULL,
          serpapi_used INTEGER,
          serpapi_limit INTEGER,
          serpapi_plan TEXT,
          last_reason TEXT,
          sort_row INTEGER NOT NULL
        );

        INSERT INTO api_keys_014 (
          id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
          serpapi_used, serpapi_limit, serpapi_plan, last_reason, sort_row
        )
        SELECT
          id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
          serpapi_used, serpapi_limit, serpapi_plan, last_reason, rowid
        FROM api_keys;

        CREATE TABLE key_usage_014 (
          id TEXT NOT NULL,
          key_id TEXT NOT NULL,
          project_id TEXT,
          month TEXT NOT NULL,
          searches INTEGER NOT NULL,
          calls INTEGER NOT NULL,
          tokens INTEGER NOT NULL,
          sort_row INTEGER NOT NULL
        );

        INSERT INTO key_usage_014 (
          id, key_id, project_id, month, searches, calls, tokens, sort_row
        )
        SELECT id, key_id, project_id, month, searches, calls, tokens, rowid
        FROM key_usage;

        CREATE TABLE connection_events_014 (
          id TEXT NOT NULL,
          key_id TEXT NOT NULL,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          detail TEXT,
          sort_row INTEGER NOT NULL
        );

        INSERT INTO connection_events_014 (id, key_id, at, kind, detail, sort_row)
        SELECT id, key_id, at, kind, detail, rowid FROM connection_events;

        DROP TABLE connection_events;
        DROP TABLE key_usage;
        DROP TABLE api_keys;

        CREATE TABLE api_keys (
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
          CHECK (provider IN ('serpapi', 'jina', 'anthropic', 'youtube')),
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

        INSERT INTO api_keys (
          id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
          serpapi_used, serpapi_limit, serpapi_plan, last_reason
        )
        SELECT
          id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
          serpapi_used, serpapi_limit, serpapi_plan, last_reason
        FROM api_keys_014
        ORDER BY sort_row ASC;

        DROP TABLE api_keys_014;

        CREATE TABLE key_usage (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          project_id TEXT,
          month TEXT NOT NULL,
          searches INTEGER NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          tokens INTEGER NOT NULL DEFAULT 0,
          CHECK (searches >= 0),
          CHECK (calls >= 0),
          CHECK (tokens >= 0),
          CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          CHECK (project_id IS NULL OR length(project_id) > 0),
          FOREIGN KEY (key_id) REFERENCES api_keys (id),
          FOREIGN KEY (project_id) REFERENCES projects (id)
        );

        INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
        SELECT id, key_id, project_id, month, searches, calls, tokens
        FROM key_usage_014
        ORDER BY sort_row ASC;

        DROP TABLE key_usage_014;

        CREATE UNIQUE INDEX idx_key_usage_key_project_month
          ON key_usage (key_id, ifnull(project_id, ''), month);
        CREATE INDEX idx_key_usage_month ON key_usage (month);

        CREATE TABLE connection_events (
          id TEXT PRIMARY KEY,
          key_id TEXT NOT NULL,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          detail TEXT,
          CHECK (kind IN ('rate_limited', 'failed', 'cap_reached', 'failover')),
          CHECK (length(at) > 0),
          FOREIGN KEY (key_id) REFERENCES api_keys (id)
        );

        INSERT INTO connection_events (id, key_id, at, kind, detail)
        SELECT id, key_id, at, kind, detail
        FROM connection_events_014
        ORDER BY sort_row ASC;

        DROP TABLE connection_events_014;

        CREATE INDEX idx_api_keys_provider ON api_keys (provider);
        CREATE INDEX idx_api_keys_provider_order ON api_keys (provider, rotation_order);
        CREATE INDEX idx_connection_events_at ON connection_events (at);
      `)
      const broken = db.prepare('PRAGMA foreign_key_check').all()
      if (broken.length > 0) throw new StorageError('Could not migrate api keys')
    }
  },
  {
    version: 15,
    name: '015_api_keys_plan',
    up(db) {
      // User-entered plan (FR-11.1). Null until set. Distinct from serpapi_plan.
      // Existing rows stay null. The secret is still not a column.
      db.exec(`
        ALTER TABLE api_keys ADD COLUMN plan TEXT;
      `)
    }
  },
  ...SCHEDULING_APP_MIGRATIONS,
  ...ACTIVITY_APP_MIGRATIONS,
  ...TEMPLATE_KIND_APP_MIGRATIONS,
  // ---- 020: template editor (template versions, llm_calls) ----
  ...TEMPLATE_APP_MIGRATIONS,
  // ---- 021: notices and the setup runner (w5/setup-runner) ----
  ...NOTICES_APP_MIGRATIONS,
  // ---- 022: which pages a scheduled report covers (feat/tracking-reports) ----
  ...REPORT_SCOPE_APP_MIGRATIONS,
  // ---- 023: cloro keys and credits per key (multi-engine tracking) ----
  ...CLORO_APP_MIGRATIONS,
  // ---- 024: Codex calls in llm_calls (renumber at merge) ----
  ...CODEX_CONNECTION_APP_MIGRATIONS,
  // ---- 025: which ready report a scheduled email sends (renumber at merge) ----
  ...REPORT_KIND_APP_MIGRATIONS
]

const SHIPPED_SEED_IDS = new Set(['tpl-buyer-profile', 'tpl-buyer-prompts', 'tpl-coverage'])

interface TemplateV4Row {
  id: string
  name: string
  version: number
  hash: string
  body: string
  schema: string | null
  settings_json: string | null
}

function kindFromLegacy(row: TemplateV4Row): GenerationTemplateKind {
  const fromJson = kindFromSettings(row.settings_json)
  if (fromJson !== null) return fromJson
  const fromId = kindFromSeedId(row.id)
  if (fromId !== null) return fromId
  throw new StorageError('templates row is missing a kind')
}

function kindFromSettings(settingsJson: string | null): GenerationTemplateKind | null {
  if (settingsJson === null) return null
  try {
    const parsed: unknown = JSON.parse(settingsJson)
    if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) return null
    return asKind((parsed as { kind: unknown }).kind)
  } catch {
    return null
  }
}

function kindFromSeedId(id: string): GenerationTemplateKind | null {
  if (id === 'tpl-buyer-profile' || /^tpl-buyer-profile-v\d+$/.test(id)) return 'buyer_profile'
  if (id === 'tpl-buyer-prompts' || /^tpl-buyer-prompts-v\d+$/.test(id)) return 'buyer_prompts'
  if (id === 'tpl-coverage' || /^tpl-coverage-v\d+$/.test(id)) return 'coverage'
  return null
}

function asKind(value: unknown): GenerationTemplateKind | null {
  if (value === 'buyer_profile' || value === 'buyer_prompts' || value === 'coverage') return value
  return null
}

function settingsWithoutKind(settingsJson: string | null): string | null {
  if (settingsJson === null) return null
  try {
    const parsed: unknown = JSON.parse(settingsJson)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const copy: Record<string, unknown> = { ...(parsed as Record<string, unknown>) }
    delete copy.kind
    return Object.keys(copy).length === 0 ? null : JSON.stringify(copy)
  } catch {
    return null
  }
}

export const APP_TABLES = [
  'projects',
  'api_keys',
  'key_usage',
  'connection_events',
  'templates',
  'claude_checkups',
  'app_state',
  'tray_history',
  'day_pass',
  'email_accounts',
  'report_schedules',
  'deliveries',
  'email_mode',
  'email_throttle',
  'pending_client_pdfs',
  'queue_pause',
  'template_versions',
  'llm_calls'
] as const

/** Section 10 app tables these migrations do not create. */
export const DEFERRED_APP_TABLES = [] as const

function sqlText(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error('unsafe SQL literal')
  return `'${value}'`
}

function sqlTextList(values: readonly string[]): string {
  return values.map((value) => sqlText(value)).join(', ')
}
