import type { AlertDryRunResult, AlertEvent, AlertRuleInput } from '@shared/ipc'
import type { SqliteDatabase } from '../storage/database'
import { matchRule, type RunFacts } from './events'
import {
  pageMetas,
  previousFull,
  runAt,
  runFacts,
  runLines,
  scopePageIds,
  type PageMeta
} from './facts'

/** Events kept for the drawer's list; `fired` still counts every one. */
export const DRY_RUN_EVENT_CAP = 100

const DAY_MS = 86_400_000

/**
 * "Would have fired N times in the last 30 days": the rule read against every stored
 * check of the pages it watches in the window, each compared with the full check
 * before it (which may be older than the window). Nothing is written or sent.
 */
export function dryRunRule(
  db: SqliteDatabase,
  projectId: string,
  rule: AlertRuleInput,
  now: Date,
  days = 30
): AlertDryRunResult {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  const scope = scopePageIds(db, rule.scope)
  if (scope !== null && scope.size === 0) return { days, fired: 0, checksRead: 0, events: [] }
  const metas = pageMetas(db)
  const cache = new Map<string, RunFacts>()
  const markets = new Set(rule.marketIds)
  const events: AlertEvent[] = []
  let checksRead = 0
  for (const line of runLines(db, projectId, scope === null ? null : [...scope])) {
    if (markets.size > 0 && !markets.has(line.marketId)) continue
    line.runs.forEach((run, index) => {
      if (runAt(run) < since) return
      checksRead += 1
      const current = runFacts(db, projectId, run, cache)
      const before = rule.when === 'check_failed' ? null : previousFull(line.runs, index)
      const previous = before === null ? null : runFacts(db, projectId, before, cache)
      const match = matchRule(rule, previous, current)
      if (match !== null) events.push(toEvent(current, match, metas))
    })
  }
  events.sort((a, b) => b.at.localeCompare(a.at))
  return { days, fired: events.length, checksRead, events: events.slice(0, DRY_RUN_EVENT_CAP) }
}

export function toEvent(
  run: RunFacts,
  match: { when: AlertEvent['when']; summary: string; details: readonly string[] },
  metas: ReadonlyMap<string, PageMeta>
): AlertEvent {
  const meta = metas.get(run.pageId)
  return {
    at: run.at,
    pageId: run.pageId,
    pageLabel: meta?.label ?? run.pageId,
    pageUrl: meta?.url ?? null,
    marketId: run.marketId,
    runId: run.runId,
    when: match.when,
    summary: match.summary,
    details: match.details
  }
}
