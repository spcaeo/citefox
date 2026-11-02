import type { Migration } from './migrate'

/**
 * Project migration 039: alert rules and the alert log (Alerts & schedules › Alert rules).
 *
 * `alert_rules`: one row per rule. `scope_ids`, `market_ids` and `email_to` are JSON
 * arrays. A rule's Slack switch uses the project's webhook from `alert_settings`;
 * no URL is stored here (NFR-5).
 *
 * `alert_log`: one row per fired alert (one rule, one page, one market, one check).
 * `rule_id` is not a foreign key: the log keeps what fired after a rule is deleted,
 * with the rule's name at the time. `UNIQUE (rule_id, run_id)` makes a re-evaluation
 * of the same check a no-op. `digest_pending` marks rows waiting for the daily digest.
 * Every timestamp is ISO-8601 UTC.
 */
export const ALERT_RULES_VERSION = 39

export const ALERT_RULES_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: ALERT_RULES_VERSION,
    name: `${String(ALERT_RULES_VERSION).padStart(3, '0')}_alert_rules`,
    up(db) {
      db.exec(`
        CREATE TABLE alert_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          rule_when TEXT NOT NULL,
          score_drop INTEGER,
          competitor_domain TEXT,
          scope_kind TEXT NOT NULL,
          scope_ids TEXT NOT NULL DEFAULT '[]',
          market_ids TEXT NOT NULL DEFAULT '[]',
          desktop INTEGER NOT NULL,
          email_to TEXT NOT NULL DEFAULT '[]',
          slack INTEGER NOT NULL,
          delivery TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (length(id) > 0),
          CHECK (length(name) BETWEEN 1 AND 120),
          CHECK (rule_when IN ('citation_lost', 'citation_gained', 'score_drop',
            'competitor_cited', 'wrong_page', 'check_failed', 'aio_gone')),
          CHECK (score_drop IS NULL OR score_drop BETWEEN 1 AND 100),
          CHECK (competitor_domain IS NULL OR length(competitor_domain) BETWEEN 1 AND 253),
          CHECK (scope_kind IN ('tracked', 'pages', 'group', 'cluster', 'topic')),
          CHECK (json_valid(scope_ids) AND json_type(scope_ids) = 'array'),
          CHECK (json_valid(market_ids) AND json_type(market_ids) = 'array'),
          CHECK (json_valid(email_to) AND json_type(email_to) = 'array'),
          CHECK (desktop IN (0, 1)),
          CHECK (slack IN (0, 1)),
          CHECK (delivery IN ('instant', 'digest')),
          CHECK (status IN ('active', 'paused')),
          CHECK (length(created_at) > 0),
          CHECK (length(updated_at) > 0)
        );

        CREATE TABLE alert_log (
          id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          rule_name TEXT NOT NULL,
          rule_when TEXT NOT NULL,
          fired_at TEXT NOT NULL,
          event_at TEXT NOT NULL,
          page_id TEXT NOT NULL,
          page_label TEXT NOT NULL,
          market_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '[]',
          delivered_to TEXT NOT NULL DEFAULT '[]',
          digest_pending INTEGER NOT NULL DEFAULT 0,
          UNIQUE (rule_id, run_id),
          CHECK (length(id) > 0),
          CHECK (length(rule_id) > 0),
          CHECK (length(summary) > 0),
          CHECK (json_valid(details) AND json_type(details) = 'array'),
          CHECK (json_valid(delivered_to) AND json_type(delivered_to) = 'array'),
          CHECK (digest_pending IN (0, 1))
        );
        CREATE INDEX idx_alert_log_fired ON alert_log (fired_at);
        CREATE INDEX idx_alert_log_rule ON alert_log (rule_id, fired_at);
      `)
    }
  }
]
