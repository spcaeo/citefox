import { afterEach, describe, expect, test } from 'vitest'
import {
  deleteAlertRules,
  getAlertRule,
  insertAlertLog,
  listAlertLog,
  listAlertRules,
  listPendingDigest,
  saveAlertRule,
  setAlertLogDelivery,
  setAlertRuleStatus,
  type NewAlertLogRow,
  type StoredAlertRule
} from './alert-rules'
import { openSqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, columns, tableNames, track } from './migrate.test-helper'
import { ALERT_RULES_VERSION } from './project-schema-alert-rules'
import { PROJECT_MIGRATIONS } from './project-schema'

afterEach(() => {
  closeTracked()
})

function fresh(): ReturnType<typeof openSqliteDatabase> {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  return db
}

function rule(id: string, patch: Partial<StoredAlertRule> = {}): StoredAlertRule {
  return {
    id,
    name: `Rule ${id}`,
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: true,
    emailTo: ['ada@example.com', 'lin@example.com'],
    slack: false,
    delivery: 'instant',
    status: 'active',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...patch
  }
}

function log(id: string, patch: Partial<NewAlertLogRow> = {}): NewAlertLogRow {
  return {
    id,
    ruleId: 'r1',
    ruleName: 'Rule r1',
    when: 'citation_lost',
    firedAt: '2026-10-10T10:00:00.000Z',
    eventAt: '2026-10-10T09:59:00.000Z',
    pageId: 'page-1',
    pageLabel: 'Alerts',
    marketId: 'mkt-us',
    runId: `run-${id}`,
    summary: 'Lost its citation on 1 question',
    details: ['How do I alert the crew?'],
    deliveredTo: ['Desktop'],
    digestPending: false,
    ...patch
  }
}

describe('project migration 039: alert rules', () => {
  test('adds alert_rules and alert_log after migration 038 and keeps earlier rows', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, ALERT_RULES_VERSION - 1))
    expect(tableNames(db)).not.toContain('alert_rules')
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db).map((row) => row.name)).toContain('039_alert_rules')
    expect(tableNames(db)).toEqual(expect.arrayContaining(['alert_rules', 'alert_log']))
    expect(columns(db, 'alert_log').map((item) => item.name)).toContain('digest_pending')
    expect(db.prepare('SELECT COUNT(*) AS n FROM pages').get()).toEqual({ n: 1 })
  })

  test('rejects a bad kind, scope, delivery or a non-array list', () => {
    const db = fresh()
    const insert = (when: string, scope: string, delivery: string, emails: string): void => {
      db.prepare(
        `INSERT INTO alert_rules (id, name, rule_when, scope_kind, desktop, email_to, slack,
           delivery, status, created_at, updated_at)
         VALUES ('x', 'X', ?, ?, 1, ?, 0, ?, 'active', 'a', 'a')`
      ).run(when, scope, emails, delivery)
    }
    expect(() => insert('nope', 'tracked', 'instant', '[]')).toThrow(/CHECK/)
    expect(() => insert('citation_lost', 'view', 'instant', '[]')).toThrow(/CHECK/)
    expect(() => insert('citation_lost', 'tracked', 'weekly', '[]')).toThrow(/CHECK/)
    expect(() => insert('citation_lost', 'tracked', 'instant', '"a@b.c"')).toThrow(/CHECK/)
    insert('citation_lost', 'tracked', 'instant', '[]')
  })
})

describe('alert rules storage', () => {
  test('saves, reads back with every email, updates in place and lists in creation order', () => {
    const db = fresh()
    saveAlertRule(db, rule('r2', { createdAt: '2026-10-02T10:00:00.000Z' }))
    saveAlertRule(
      db,
      rule('r1', {
        when: 'score_drop',
        scoreDrop: 15,
        scope: { kind: 'group', ids: ['g1', 'g2'] },
        marketIds: ['mkt-us']
      })
    )
    const listed = listAlertRules(db, 'proj-1')
    expect(listed.map((item) => item.id)).toEqual(['r1', 'r2'])
    expect(listed[0]).toMatchObject({
      projectId: 'proj-1',
      when: 'score_drop',
      scoreDrop: 15,
      scope: { kind: 'group', ids: ['g1', 'g2'] },
      marketIds: ['mkt-us'],
      emailTo: ['ada@example.com', 'lin@example.com'],
      firedCount: 0,
      lastFiredAt: null
    })
    saveAlertRule(db, rule('r1', { name: 'Renamed', updatedAt: '2026-10-03T10:00:00.000Z' }))
    expect(getAlertRule(db, 'proj-1', 'r1')).toMatchObject({
      name: 'Renamed',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-03T10:00:00.000Z'
    })
    expect(getAlertRule(db, 'proj-1', 'missing')).toBeNull()
  })

  test('pauses, resumes and deletes in bulk; unknown ids are skipped', () => {
    const db = fresh()
    saveAlertRule(db, rule('r1'))
    saveAlertRule(db, rule('r2'))
    expect(
      setAlertRuleStatus(db, ['r1', 'r2', 'nope'], 'paused', '2026-10-05T00:00:00.000Z')
    ).toEqual(['r1', 'r2'])
    expect(listAlertRules(db, 'p').map((item) => item.status)).toEqual(['paused', 'paused'])
    setAlertRuleStatus(db, ['r2'], 'active', '2026-10-05T00:00:00.000Z')
    expect(getAlertRule(db, 'p', 'r2')?.status).toBe('active')
    expect(deleteAlertRules(db, ['r1', 'nope'])).toEqual(['r1'])
    expect(listAlertRules(db, 'p').map((item) => item.id)).toEqual(['r2'])
  })

  test('the log counts per rule, ignores a second firing for the same check, and outlives the rule', () => {
    const db = fresh()
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    saveAlertRule(db, rule('r1'))
    expect(insertAlertLog(db, log('l1'))).toBe(true)
    expect(insertAlertLog(db, log('l2', { runId: 'run-l1' }))).toBe(false)
    expect(insertAlertLog(db, log('l3', { firedAt: '2026-10-11T10:00:00.000Z' }))).toBe(true)
    expect(getAlertRule(db, 'p', 'r1')).toMatchObject({
      firedCount: 2,
      lastFiredAt: '2026-10-11T10:00:00.000Z'
    })
    const entries = listAlertLog(db, { ruleId: null, limit: 10 })
    expect(entries.map((entry) => entry.id)).toEqual(['l3', 'l1'])
    expect(entries[0]).toMatchObject({
      ruleName: 'Rule r1',
      pageUrl: 'https://textbolt.com/a',
      details: ['How do I alert the crew?'],
      deliveredTo: ['Desktop']
    })
    deleteAlertRules(db, ['r1'])
    expect(listAlertLog(db, { ruleId: 'r1', limit: 10 })).toHaveLength(2)
  })

  test('digest rows wait until the digest is recorded as sent', () => {
    const db = fresh()
    insertAlertLog(db, log('l1', { digestPending: true, deliveredTo: [] }))
    insertAlertLog(db, log('l2'))
    expect(listPendingDigest(db).map((entry) => entry.id)).toEqual(['l1'])
    setAlertLogDelivery(db, ['l1'], ['Daily digest: Desktop'], false)
    expect(listPendingDigest(db)).toEqual([])
    expect(listAlertLog(db, { ruleId: null, limit: 5 })[1]?.deliveredTo).toEqual([
      'Daily digest: Desktop'
    ])
  })
})
