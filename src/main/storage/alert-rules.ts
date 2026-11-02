import {
  ALERT_DELIVERIES,
  ALERT_RULE_STATUSES,
  ALERT_RULE_WHENS,
  ALERT_SCOPE_KINDS,
  type AlertDelivery,
  type AlertLogEntry,
  type AlertRule,
  type AlertRuleStatus,
  type AlertRuleWhen,
  type AlertScopeKind
} from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, readJson } from './values'

/**
 * `alert_rules` and `alert_log` (project migration 039). The file is one project:
 * `projectId` is stamped by the caller, the same way `getAlertSettings` does.
 * Requests are validated in `main/alerts/parse.ts`; this layer checks the shape again
 * so a bad row can never be written or read back as a rule.
 */

export type StoredAlertRule = Omit<AlertRule, 'projectId' | 'lastFiredAt' | 'firedCount'>

/** A log row before it is joined with the page for its URL. */
export interface NewAlertLogRow {
  id: string
  ruleId: string
  ruleName: string
  when: AlertRuleWhen
  firedAt: string
  eventAt: string
  pageId: string
  pageLabel: string
  marketId: string
  runId: string
  summary: string
  details: readonly string[]
  deliveredTo: readonly string[]
  digestPending: boolean
}

interface RuleSql {
  id: string
  name: string
  rule_when: string
  score_drop: number | null
  competitor_domain: string | null
  scope_kind: string
  scope_ids: string
  market_ids: string
  desktop: number
  email_to: string
  slack: number
  delivery: string
  status: string
  created_at: string
  updated_at: string
  fired_count: number
  last_fired_at: string | null
}

const RULE_SELECT = `
  SELECT r.*, COALESCE(l.fired_count, 0) AS fired_count, l.last_fired_at
  FROM alert_rules r
  LEFT JOIN (
    SELECT rule_id, COUNT(*) AS fired_count, MAX(fired_at) AS last_fired_at
    FROM alert_log GROUP BY rule_id
  ) l ON l.rule_id = r.id`

export function listAlertRules(db: SqliteDatabase, projectId: string): AlertRule[] {
  return db
    .prepare<unknown[], RuleSql>(`${RULE_SELECT} ORDER BY r.created_at ASC, r.rowid ASC`)
    .all()
    .map((row) => ruleFromSql(projectId, row))
}

export function getAlertRule(db: SqliteDatabase, projectId: string, id: string): AlertRule | null {
  const row = db.prepare<unknown[], RuleSql>(`${RULE_SELECT} WHERE r.id = ?`).get(assertId(id))
  return row === undefined ? null : ruleFromSql(projectId, row)
}

/** Inserts the rule, or replaces every field of the rule with the same id. */
export function saveAlertRule(db: SqliteDatabase, rule: StoredAlertRule): void {
  runWrite('Could not save the alert rule', () => {
    db.prepare(
      `INSERT INTO alert_rules (
         id, name, rule_when, score_drop, competitor_domain, scope_kind, scope_ids, market_ids,
         desktop, email_to, slack, delivery, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         rule_when = excluded.rule_when,
         score_drop = excluded.score_drop,
         competitor_domain = excluded.competitor_domain,
         scope_kind = excluded.scope_kind,
         scope_ids = excluded.scope_ids,
         market_ids = excluded.market_ids,
         desktop = excluded.desktop,
         email_to = excluded.email_to,
         slack = excluded.slack,
         delivery = excluded.delivery,
         status = excluded.status,
         updated_at = excluded.updated_at`
    ).run(
      assertId(rule.id),
      rule.name,
      rule.when,
      rule.scoreDrop,
      rule.competitorDomain,
      rule.scope.kind,
      JSON.stringify(rule.scope.ids),
      JSON.stringify(rule.marketIds),
      rule.desktop ? 1 : 0,
      JSON.stringify(rule.emailTo),
      rule.slack ? 1 : 0,
      rule.delivery,
      rule.status,
      rule.createdAt,
      rule.updatedAt
    )
  })
}

/** Deletes the rules; their log rows stay. Returns the ids that existed. */
export function deleteAlertRules(db: SqliteDatabase, ids: readonly string[]): string[] {
  const done: string[] = []
  const remove = db.prepare('DELETE FROM alert_rules WHERE id = ?')
  db.transaction(() => {
    for (const id of ids) {
      if (remove.run(assertId(id)).changes > 0) done.push(id)
    }
  })()
  return done
}

export function setAlertRuleStatus(
  db: SqliteDatabase,
  ids: readonly string[],
  status: AlertRuleStatus,
  updatedAt: string
): string[] {
  if (!ALERT_RULE_STATUSES.includes(status)) throw new StorageError('Invalid rule status')
  const done: string[] = []
  const update = db.prepare('UPDATE alert_rules SET status = ?, updated_at = ? WHERE id = ?')
  db.transaction(() => {
    for (const id of ids) {
      if (update.run(status, updatedAt, assertId(id)).changes > 0) done.push(id)
    }
  })()
  return done
}

/** Adds one fired alert. False when this rule already fired for this check (a no-op). */
export function insertAlertLog(db: SqliteDatabase, row: NewAlertLogRow): boolean {
  try {
    const result = db
      .prepare(
        `INSERT INTO alert_log (
           id, rule_id, rule_name, rule_when, fired_at, event_at, page_id, page_label,
           market_id, run_id, summary, details, delivered_to, digest_pending
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (rule_id, run_id) DO NOTHING`
      )
      .run(
        assertId(row.id),
        assertId(row.ruleId),
        row.ruleName,
        row.when,
        row.firedAt,
        row.eventAt,
        row.pageId,
        row.pageLabel,
        row.marketId,
        row.runId,
        row.summary,
        JSON.stringify(row.details),
        JSON.stringify(row.deliveredTo),
        row.digestPending ? 1 : 0
      )
    return result.changes > 0
  } catch (error) {
    if (isSqliteError(error) && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new StorageError('Could not record the alert: rejected by the database')
    }
    throw error
  }
}

/** Records where a fired alert went (and clears the digest flag once the digest is sent). */
export function setAlertLogDelivery(
  db: SqliteDatabase,
  ids: readonly string[],
  deliveredTo: readonly string[],
  digestPending: boolean
): void {
  const update = db.prepare(
    'UPDATE alert_log SET delivered_to = ?, digest_pending = ? WHERE id = ?'
  )
  db.transaction(() => {
    for (const id of ids) update.run(JSON.stringify(deliveredTo), digestPending ? 1 : 0, id)
  })()
}

interface LogSql {
  id: string
  rule_id: string
  rule_name: string
  rule_when: string
  fired_at: string
  event_at: string
  page_id: string
  page_label: string
  market_id: string
  run_id: string
  summary: string
  details: string
  delivered_to: string
  digest_pending: number
  url: string | null
}

const LOG_SELECT = `
  SELECT l.*, p.url AS url
  FROM alert_log l LEFT JOIN pages p ON p.id = l.page_id`

/** Newest first. */
export function listAlertLog(
  db: SqliteDatabase,
  options: { ruleId: string | null; limit: number }
): AlertLogEntry[] {
  const rows =
    options.ruleId === null
      ? db
          .prepare<unknown[], LogSql>(
            `${LOG_SELECT} ORDER BY l.fired_at DESC, l.rowid DESC LIMIT ?`
          )
          .all(options.limit)
      : db
          .prepare<unknown[], LogSql>(
            `${LOG_SELECT} WHERE l.rule_id = ? ORDER BY l.fired_at DESC, l.rowid DESC LIMIT ?`
          )
          .all(assertId(options.ruleId), options.limit)
  return rows.map(logFromSql)
}

/** Rows waiting for the daily digest, oldest first, with whether they are digest rows. */
export function listPendingDigest(db: SqliteDatabase): (AlertLogEntry & { firedAt: string })[] {
  return db
    .prepare<unknown[], LogSql>(
      `${LOG_SELECT} WHERE l.digest_pending = 1 ORDER BY l.fired_at ASC, l.rowid ASC`
    )
    .all()
    .map((row) => ({ ...logFromSql(row), firedAt: row.fired_at }))
}

function logFromSql(row: LogSql): AlertLogEntry {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    when: readWhen(row.rule_when),
    at: row.event_at,
    pageId: row.page_id,
    pageLabel: row.page_label,
    pageUrl: row.url,
    marketId: row.market_id,
    runId: row.run_id,
    summary: row.summary,
    details: readStrings(row.details, 'details'),
    deliveredTo: readStrings(row.delivered_to, 'delivered to')
  }
}

function ruleFromSql(projectId: string, row: RuleSql): AlertRule {
  return {
    id: row.id,
    projectId,
    name: row.name,
    when: readWhen(row.rule_when),
    scoreDrop: row.score_drop,
    competitorDomain: row.competitor_domain,
    scope: { kind: readScopeKind(row.scope_kind), ids: readStrings(row.scope_ids, 'scope') },
    marketIds: readStrings(row.market_ids, 'markets'),
    desktop: row.desktop === 1,
    emailTo: readStrings(row.email_to, 'email to'),
    slack: row.slack === 1,
    delivery: readDelivery(row.delivery),
    status: row.status === 'paused' ? 'paused' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastFiredAt: row.last_fired_at,
    firedCount: row.fired_count
  }
}

function readWhen(value: string): AlertRuleWhen {
  const found = ALERT_RULE_WHENS.find((item) => item === value)
  if (found === undefined) throw new StorageError('Invalid alert rule kind')
  return found
}

function readScopeKind(value: string): AlertScopeKind {
  const found = ALERT_SCOPE_KINDS.find((item) => item === value)
  if (found === undefined) throw new StorageError('Invalid alert rule scope')
  return found
}

function readDelivery(value: string): AlertDelivery {
  const found = ALERT_DELIVERIES.find((item) => item === value)
  if (found === undefined) throw new StorageError('Invalid alert delivery')
  return found
}

function readStrings(encoded: string, label: string): string[] {
  const parsed = readJson(encoded, label)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new StorageError(`Invalid ${label}`)
  }
  return parsed as string[]
}

function runWrite(action: string, write: () => void): void {
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error) && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new StorageError(`${action}: rejected by the database`)
    }
    throw new StorageError(`${action} failed`)
  }
}
