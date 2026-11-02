import type {
  AlertDryRunResult,
  AlertEvent,
  AlertLog,
  AlertRule,
  AlertRuleIdsResult,
  AlertRuleInput,
  AlertRuleList,
  SaveAlertRuleRequest,
  SetAlertRuleStatusRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import type { Logger } from '../logging/logger'
import { getAlertSettings } from '../storage/alert-settings'
import {
  deleteAlertRules,
  getAlertRule,
  insertAlertLog,
  listAlertLog,
  listAlertRules,
  listPendingDigest,
  saveAlertRule,
  setAlertLogDelivery,
  setAlertRuleStatus
} from '../storage/alert-rules'
import type { AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { StorageError } from '../storage/errors'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getProject, listProjects, type ProjectRecord } from '../storage/records'
import { sendBatch, type AlertSenders } from './deliver'
import { dryRunRule, toEvent } from './dry-run'
import { matchRule, type RunFacts } from './events'
import { jobRuns, pageMetas, previousFull, runFacts, runLines, scopePageIds } from './facts'

export interface AlertRulesDeps {
  storage: AppStorage
  logger: Logger
  now: () => Date
  createId: () => string
  senders: AlertSenders
}

/** What one evaluation after a check did, for logs and tests. */
export interface AlertEvaluation {
  /** New alert log rows (a check already evaluated adds none). */
  fired: number
  /** Rows sent now (instant rules and digests that came due). */
  sent: number
}

const DAY_MS = 86_400_000

/**
 * Alert rules of one engine host: CRUD and the dry run for the IPC handlers, and the
 * evaluation that runs after each check job. One project file is opened per call and
 * closed again, like every other project handler.
 */
export interface AlertRulesService {
  listRules(projectId: string, channel: string): AlertRuleList
  saveRule(request: SaveAlertRuleRequest): AlertRule
  deleteRules(projectId: string, ids: readonly string[]): AlertRuleIdsResult
  setStatus(request: SetAlertRuleStatusRequest): AlertRuleIdsResult
  dryRun(projectId: string, rule: AlertRuleInput, days: number): AlertDryRunResult
  listLog(projectId: string, ruleId: string | null, limit: number): AlertLog
  evaluateJob(projectId: string, jobId: string): Promise<AlertEvaluation>
  /**
   * Sends every project's digests that came due (the oldest waiting row is a day
   * old), with no check needed: the scheduler's digest timer and `--check-due`
   * call it. Returns the alert log rows sent. Never throws.
   */
  flushDueDigests(): Promise<number>
}

export function createAlertRulesService(deps: AlertRulesDeps): AlertRulesService {
  return {
    listRules(projectId: string, channel: string): AlertRuleList {
      return withProjectDb(deps.storage, projectId, channel, (db) => ({
        projectId,
        rules: listAlertRules(db, projectId),
        slackReady: getAlertSettings(db, projectId).slackKeychainRef !== null
      }))
    },

    saveRule(request: SaveAlertRuleRequest): AlertRule {
      const channel = 'alerts:saveRule'
      return withProjectDb(deps.storage, request.projectId, channel, (db) => {
        const at = deps.now().toISOString()
        const existing =
          request.id === null ? null : getAlertRule(db, request.projectId, request.id)
        if (request.id !== null && existing === null) {
          throw new IpcRequestError(channel, 'That alert rule was not found')
        }
        const id = existing?.id ?? deps.createId()
        saveAlertRule(db, {
          id,
          name: request.name,
          when: request.when,
          scoreDrop: request.scoreDrop,
          competitorDomain: request.competitorDomain,
          scope: request.scope,
          marketIds: request.marketIds,
          desktop: request.desktop,
          emailTo: request.emailTo,
          slack: request.slack,
          delivery: request.delivery,
          status: request.status ?? existing?.status ?? 'active',
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        })
        const saved = getAlertRule(db, request.projectId, id)
        if (saved === null) throw new IpcRequestError(channel, 'The alert rule was not saved')
        return saved
      })
    },

    deleteRules(projectId: string, ids: readonly string[]): AlertRuleIdsResult {
      return withProjectDb(deps.storage, projectId, 'alerts:deleteRule', (db) => ({
        ids: deleteAlertRules(db, ids)
      }))
    },

    setStatus(request: SetAlertRuleStatusRequest): AlertRuleIdsResult {
      return withProjectDb(deps.storage, request.projectId, 'alerts:setRuleStatus', (db) => ({
        ids: setAlertRuleStatus(db, request.ids, request.status, deps.now().toISOString())
      }))
    },

    dryRun(projectId: string, rule: AlertRuleInput, days: number): AlertDryRunResult {
      return withProjectDb(deps.storage, projectId, 'alerts:dryRun', (db) =>
        dryRunRule(db, projectId, rule, deps.now(), days)
      )
    },

    listLog(projectId: string, ruleId: string | null, limit: number): AlertLog {
      return withProjectDb(deps.storage, projectId, 'alerts:listLog', (db) => ({
        projectId,
        entries: listAlertLog(db, { ruleId, limit })
      }))
    },

    /**
     * After a check job settles: every active rule against each run of the job, each
     * compared with the full check before it in the same page and market. Matches go to
     * the alert log once (re-running the same job adds nothing); instant rules send now,
     * digest rules wait for their daily message. Never throws: an alert must not fail a check.
     */
    async evaluateJob(projectId: string, jobId: string): Promise<AlertEvaluation> {
      try {
        return await evaluate(deps, projectId, jobId)
      } catch (error: unknown) {
        deps.logger.error('CiteFox could not evaluate alert rules', {
          message: error instanceof Error ? error.message : 'failed'
        })
        return { fired: 0, sent: 0 }
      }
    },

    async flushDueDigests(): Promise<number> {
      let sent = 0
      for (const project of listProjects(deps.storage.db)) {
        try {
          sent += await flushProject(deps, project)
        } catch (error: unknown) {
          deps.logger.error('CiteFox could not send a daily alert digest', {
            message: error instanceof Error ? error.message : 'failed'
          })
        }
      }
      return sent
    }
  }
}

async function flushProject(deps: AlertRulesDeps, project: ProjectRecord): Promise<number> {
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
  try {
    if (listPendingDigest(db).length === 0) return 0
    const rules = listAlertRules(db, project.id).filter((rule) => rule.status === 'active')
    return await flushDigests(deps, db, project, rules, marketLabels(db))
  } finally {
    closeProjectDatabase(db)
  }
}

async function evaluate(
  deps: AlertRulesDeps,
  projectId: string,
  jobId: string
): Promise<AlertEvaluation> {
  const project = getProject(deps.storage.db, projectId)
  if (project === null) return { fired: 0, sent: 0 }
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
  try {
    const rules = listAlertRules(db, projectId).filter((rule) => rule.status === 'active')
    if (rules.length === 0) return { fired: 0, sent: 0 }
    const runs = jobRuns(db, projectId, jobId).filter(
      (run) => run.status === 'finished' || run.status === 'error'
    )
    const metas = pageMetas(db)
    const cache = new Map<string, RunFacts>()
    const scopes = new Map(rules.map((rule) => [rule.id, scopePageIds(db, rule.scope)]))
    const firedAt = deps.now().toISOString()
    const fresh = new Map<string, { rule: AlertRule; events: AlertEvent[]; ids: string[] }>()
    for (const run of runs) {
      const line = runLines(db, projectId, [run.pageId]).find(
        (item) => item.marketId === run.marketId
      )
      const index = line?.runs.findIndex((item) => item.id === run.id) ?? -1
      if (line === undefined || index < 0) continue
      const current = runFacts(db, projectId, run, cache)
      const before = previousFull(line.runs, index)
      const previous = before === null ? null : runFacts(db, projectId, before, cache)
      for (const rule of rules) {
        if (rule.marketIds.length > 0 && !rule.marketIds.includes(run.marketId)) continue
        const scope = scopes.get(rule.id) ?? null
        if (scope !== null && !scope.has(run.pageId)) continue
        const match = matchRule(rule, previous, current)
        if (match === null) continue
        const event = toEvent(current, match, metas)
        const id = deps.createId()
        const inserted = insertAlertLog(db, {
          id,
          ruleId: rule.id,
          ruleName: rule.name,
          when: event.when,
          firedAt,
          eventAt: event.at,
          pageId: event.pageId,
          pageLabel: event.pageLabel,
          marketId: event.marketId,
          runId: event.runId,
          summary: event.summary,
          details: event.details,
          deliveredTo: rule.delivery === 'digest' ? ['Waiting for the daily digest'] : [],
          digestPending: rule.delivery === 'digest'
        })
        if (!inserted) continue
        const group = fresh.get(rule.id) ?? { rule, events: [], ids: [] }
        group.events.push(event)
        group.ids.push(id)
        fresh.set(rule.id, group)
      }
    }
    let fired = 0
    let sent = 0
    const labels = marketLabels(db)
    for (const group of fresh.values()) {
      fired += group.ids.length
      if (group.rule.delivery === 'digest') continue
      const delivered = await sendBatch(
        deps.senders,
        {
          rule: group.rule,
          projectName: project.name,
          events: group.events,
          marketLabel: labels,
          digest: false,
          key: `alert:${group.rule.id}:${jobId}`
        },
        deps.logger
      )
      setAlertLogDelivery(db, group.ids, delivered, false)
      sent += group.ids.length
    }
    sent += await flushDigests(deps, db, project, rules, labels)
    return { fired, sent }
  } finally {
    closeProjectDatabase(db)
  }
}

/**
 * Sends a rule's waiting digest rows once the oldest is a day old: one message per
 * rule with everything that fired since its last digest. Paused or deleted rules
 * drop their waiting rows from the digest (they stay in the log).
 */
async function flushDigests(
  deps: AlertRulesDeps,
  db: SqliteDatabase,
  project: ProjectRecord,
  activeRules: readonly AlertRule[],
  labels: (marketId: string) => string
): Promise<number> {
  const pending = listPendingDigest(db)
  if (pending.length === 0) return 0
  const now = deps.now().getTime()
  const byRule = new Map<string, typeof pending>()
  for (const row of pending) {
    const list = byRule.get(row.ruleId) ?? []
    list.push(row)
    byRule.set(row.ruleId, list)
  }
  let sent = 0
  for (const [ruleId, rows] of byRule) {
    const rule = activeRules.find((item) => item.id === ruleId)
    const ids = rows.map((row) => row.id)
    if (rule === undefined || rule.delivery !== 'digest') {
      setAlertLogDelivery(db, ids, ['Not sent: the rule is paused, deleted or instant now'], false)
      continue
    }
    const oldest = rows[0]?.firedAt
    if (oldest === undefined || now - Date.parse(oldest) < DAY_MS) continue
    const delivered = await sendBatch(
      deps.senders,
      {
        rule,
        projectName: project.name,
        events: rows,
        marketLabel: labels,
        digest: true,
        key: `digest:${rule.id}:${ids[0] ?? ''}`
      },
      deps.logger
    )
    setAlertLogDelivery(db, ids, delivered, false)
    sent += ids.length
  }
  return sent
}

function marketLabels(db: SqliteDatabase): (marketId: string) => string {
  const rows = db
    .prepare<unknown[], { id: string; country: string; language: string; location: string | null }>(
      'SELECT id, country, language, location FROM markets'
    )
    .all()
  const labels = new Map(
    rows.map((row) => [
      row.id,
      [row.country.toUpperCase(), row.language.toUpperCase(), row.location]
        .filter((part) => part !== null && part !== '')
        .join(' · ')
    ])
  )
  return (marketId) => labels.get(marketId) ?? marketId
}

function withProjectDb<T>(
  storage: AppStorage,
  projectId: string,
  channel: string,
  run: (db: SqliteDatabase) => T
): T {
  const project = getProject(storage.db, projectId)
  if (project === null) throw new IpcRequestError(channel, 'That project was not found')
  let db: SqliteDatabase
  try {
    db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  } catch (error) {
    if (error instanceof StorageError)
      throw new IpcRequestError(channel, 'That project was not found')
    throw error
  }
  try {
    return run(db)
  } finally {
    closeProjectDatabase(db)
  }
}
