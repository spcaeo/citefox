import { VISIBILITY_POINT_PAGE_CITED } from '@shared/domain'
import type { AlertRuleScope } from '@shared/ipc'
import { runPromptRows } from '../engine/checks/results'
import { AIO_STATUSES, pointsFor } from '../engine/checks/score'
import type { SqliteDatabase } from '../storage/database'
import {
  listStoredCheckRuns,
  listStoredRunsForJob,
  type StoredCheckRun
} from '../storage/check-records'
import type { RunFacts } from './events'

/**
 * Reads what `events.ts` compares from the project file: each check's questions
 * scored as Results scores them, the page's score, and the competitors cited.
 */

export interface PageMeta {
  label: string
  url: string | null
}

/** Every page and topic's label and address, for alert lines. */
export function pageMetas(db: SqliteDatabase): Map<string, PageMeta> {
  const rows = db
    .prepare<
      unknown[],
      { id: string; url: string | null; label: string | null; title: string | null }
    >('SELECT id, url, label, title FROM pages')
    .all()
  return new Map(
    rows.map((row) => [
      row.id,
      { label: row.label ?? row.title ?? pathLabel(row.url) ?? row.id, url: row.url }
    ])
  )
}

function pathLabel(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}

/**
 * The pages (and topics) a rule watches, or null for every page. Groups and clusters
 * are read at evaluation time, so a page added to a group later is watched too.
 */
export function scopePageIds(db: SqliteDatabase, scope: AlertRuleScope): Set<string> | null {
  switch (scope.kind) {
    case 'tracked':
      return null
    case 'pages':
    case 'topic':
      return new Set(scope.ids)
    case 'group':
      return members(db, 'SELECT page_id FROM group_pages WHERE group_id = ?', scope.ids)
    case 'cluster':
      return members(db, 'SELECT page_id FROM cluster_pages WHERE cluster_id = ?', scope.ids)
  }
}

function members(db: SqliteDatabase, sql: string, ids: readonly string[]): Set<string> {
  const read = db.prepare<unknown[], { page_id: string }>(sql)
  const found = new Set<string>()
  for (const id of ids) {
    for (const row of read.all(id)) found.add(row.page_id)
  }
  return found
}

/** Runs of one page in one market, oldest first. */
export interface RunLine {
  pageId: string
  marketId: string
  runs: readonly StoredCheckRun[]
}

/** Every page × market line of runs (cancelled runs are left out). */
export function runLines(
  db: SqliteDatabase,
  projectId: string,
  pageIds: readonly string[] | null
): RunLine[] {
  const runs = listStoredCheckRuns(db, {
    projectId,
    pageIds,
    marketId: null,
    from: null,
    to: null,
    runId: null,
    promptId: null
  })
  const lines = new Map<string, StoredCheckRun[]>()
  for (const run of runs) {
    if (run.status === 'cancelled' || run.status === 'running') continue
    const key = `${run.pageId}\u0000${run.marketId}`
    const list = lines.get(key) ?? []
    list.push(run)
    lines.set(key, list)
  }
  return [...lines.values()].map((list) => ({
    pageId: list[0]?.pageId ?? '',
    marketId: list[0]?.marketId ?? '',
    runs: [...list].sort((a, b) => runAt(a).localeCompare(runAt(b)))
  }))
}

export function runAt(run: StoredCheckRun): string {
  return run.finishedAt ?? run.startedAt
}

/** The last full check before `index` in a line, or null. */
export function previousFull(
  runs: readonly StoredCheckRun[],
  index: number
): StoredCheckRun | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const run = runs[at]
    if (run !== undefined && run.status === 'finished' && !run.partial) return run
  }
  return null
}

/** Reads one run's facts once per call site (`cache` keyed by run id). */
export function runFacts(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun,
  cache: Map<string, RunFacts> = new Map()
): RunFacts {
  const cached = cache.get(run.id)
  if (cached !== undefined) return cached
  const rows = run.status === 'error' ? [] : runPromptRows(db, projectId, run)
  const aio = rows.filter((row) => AIO_STATUSES.has(row.status))
  const points = aio.reduce((sum, row) => sum + (pointsFor(row.status) ?? 0), 0)
  const possible = aio.length * VISIBILITY_POINT_PAGE_CITED
  const facts: RunFacts = {
    runId: run.id,
    pageId: run.pageId,
    marketId: run.marketId,
    at: runAt(run),
    status: run.status,
    partial: run.partial,
    score: possible === 0 ? null : Math.round((points / possible) * 100),
    questions: rows.map((row) => ({
      promptId: row.promptId,
      text: row.text,
      status: row.status,
      competitors: [
        ...new Set(
          row.references
            .filter((reference) => reference.classification === 'competitor')
            .map((reference) => reference.domain)
        )
      ]
    }))
  }
  cache.set(run.id, facts)
  return facts
}

/** Runs of one check job (the live evaluation after a check). */
export function jobRuns(db: SqliteDatabase, projectId: string, jobId: string): StoredCheckRun[] {
  return listStoredRunsForJob(db, projectId, jobId)
}
