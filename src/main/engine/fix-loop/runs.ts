import type { PageSummary, PromptCheckRow } from '@shared/domain'
import type { ChangeCheck } from '@shared/ipc'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { filterFor, isFullRun, runPromptRows } from '../checks/results'

/**
 * Stored-run readers the fix loop shares. Every row is scored by `runPromptRows`, the
 * reader Results uses, so a count on the Fixes screen equals the drill it opens.
 */

/** Full checks of one page in one market, oldest first. */
export function fullRunsOf(
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  marketId: string
): StoredCheckRun[] {
  return listStoredCheckRuns(db, filterFor(projectId, pageId, marketId)).filter(
    (run) => run.pageId === pageId && run.marketId === marketId && isFullRun(run)
  )
}

/** When a run finished, or started when the finish time is missing. */
export function endOf(run: StoredCheckRun): string {
  return run.finishedAt ?? run.startedAt
}

/** Scores each run once per call: one ledger reads the same check for several changes. */
export function promptRowCache(
  db: SqliteDatabase,
  projectId: string
): (run: StoredCheckRun) => PromptCheckRow[] {
  const cache = new Map<string, PromptCheckRow[]>()
  return (run) => {
    const cached = cache.get(run.id)
    if (cached !== undefined) return cached
    const rows = runPromptRows(db, projectId, run)
    cache.set(run.id, rows)
    return rows
  }
}

export function changeCheck(run: StoredCheckRun, rows: readonly PromptCheckRow[]): ChangeCheck {
  return { runId: run.id, marketId: run.marketId, checkedAt: endOf(run), rows }
}

/** An open page with an address (topics have none, removed pages are gone). */
export function isOpenPage(page: PageSummary): page is PageSummary & { url: string } {
  return page.status !== 'removed' && page.kind !== 'topic' && page.url !== null
}
