import type { CheckJob } from '@shared/ipc'
import type { PageResults } from '@shared/domain'
import { capAllowance } from '../../queue/usage'
import {
  cancelStoredRunningRuns,
  finishStoredCheckJob,
  finishStoredRun,
  listStoredRunsForJob
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { saveJobSpend } from '../../storage/engine-records'
import { listPages, setPageScore } from '../../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { getProject, listApiKeys } from '../../storage/records'
import { capNextStep } from './cap-copy'
import { reportCapStop } from './cap-stop'
import type { CheckEngineDeps } from './engine'
import { finishMemory } from './job-progress'
import { projectUsedForMonth, type KeyRotation } from './key-rotation'
import type { PagePlan } from './plan'
import type { Prepared } from './prepare'
import { CheckInputError, loadPageResults } from './results'
import { normalizeUrl } from './url'

/** How a check job ends (cap, keys, cancel), what it spent, and the reads around it. */

/**
 * Stores what the job spent (every check records its credits and cost), read back from
 * its captures and answers so a resumed job counts the part done before a quit.
 */
export function withSpend(
  jobs: Map<string, CheckJob>,
  prepared: Prepared,
  job: CheckJob
): CheckJob {
  if (prepared.db === null) return job
  const spend = saveJobSpend(prepared.db, job.id, job.provider ?? null)
  const next = { ...job, creditsUsed: spend.credits, costMicros: spend.costMicros }
  jobs.set(next.id, next)
  return next
}

export function resumeCapBlock(
  deps: CheckEngineDeps,
  prepared: Prepared,
  rotation: KeyRotation
): 'project' | 'keys' | null {
  const cap = prepared.queueProject.cap
  if (cap !== null) {
    const allowance = capAllowance(cap, prepared.queueProject.capRule)
    if (projectUsedForMonth(deps.storage, prepared.job.projectId, prepared.month) >= allowance) {
      return 'project'
    }
  }
  if (rotation.exhausted()) return 'keys'
  return null
}

export function stopForCap(
  deps: CheckEngineDeps,
  jobs: Map<string, CheckJob>,
  db: SqliteDatabase,
  prepared: Prepared,
  blocked: 'project' | 'keys'
): CheckJob {
  const finishedAt = deps.now().toISOString()
  const projectCap = blocked === 'project'
  const cloro = prepared.provider === 'cloro'
  const message = projectCap
    ? "This check would pass the project's search cap."
    : cloro
      ? 'Every cloro key is out of credits.'
      : 'Every SerpApi key is out of searches.'
  const nextStep = projectCap
    ? capNextStep(prepared.queueProject.capRule, prepared.month)
    : `Open Connections and add a ${cloro ? 'cloro' : 'SerpApi'} key.`
  for (const run of listStoredRunsForJob(db, prepared.job.projectId, prepared.job.id)) {
    if (run.status === 'running') finishStoredRun(db, run.id, finishedAt, 'error')
  }
  const failed = finishMemory(prepared.job, 'error', finishedAt, message, nextStep)
  jobs.set(failed.id, failed)
  finishStoredCheckJob(db, failed.id, finishedAt, 'error', failed.searchesUsed, message, nextStep)
  if (projectCap) reportCapStop(deps, prepared)
  return failed
}

export function haltJob(
  deps: CheckEngineDeps,
  jobs: Map<string, CheckJob>,
  db: SqliteDatabase,
  prepared: Prepared
): CheckJob {
  const finishedAt = deps.now().toISOString()
  cancelStoredRunningRuns(db, prepared.job.id, finishedAt)
  const cancelled = finishMemory(prepared.job, 'cancelled', finishedAt, null, null)
  jobs.set(cancelled.id, cancelled)
  finishStoredCheckJob(
    db,
    cancelled.id,
    finishedAt,
    'cancelled',
    cancelled.searchesUsed,
    null,
    null
  )
  return cancelled
}

export function countSearches(prepared: Prepared, searches: number): void {
  prepared.job.searchesUsed += searches
  prepared.job.monthUsed = (prepared.job.monthUsed ?? 0) + searches
}

export function publishPageScore(
  deps: CheckEngineDeps,
  db: SqliteDatabase,
  prepared: Prepared,
  page: PagePlan
): void {
  const results = loadPageResults(db, {
    projectId: prepared.job.projectId,
    pageId: page.pageId,
    marketId: page.defaultMarketId,
    runId: null,
    builtAt: deps.now().toISOString(),
    domain: prepared.domain,
    keyLabels: keyLabels(deps)
  })
  if (results.run?.marketId === page.defaultMarketId) {
    setPageScore(db, page.pageId, results.run.visibilityScore)
  }
}

export function pageCitedDelta(results: PageResults): number | null {
  const previous = results.comparison.find((column) => column.which === 'previous')
  if (results.run === null || previous === undefined || previous.pageCited === null) return null
  return results.run.pageCited - previous.pageCited
}

export function trackedUrls(db: SqliteDatabase, projectId: string): string[] {
  const urls: string[] = []
  for (const page of listPages(db, projectId)) {
    if (page.status !== 'tracked' && page.status !== 'setting_up' && page.status !== 'paused')
      continue
    if (page.url === null) continue
    const normalized = normalizeUrl(page.url)
    if (normalized !== null) urls.push(normalized)
  }
  return urls
}

export function keyLabels(deps: CheckEngineDeps): Map<string, string> {
  return new Map(listApiKeys(deps.storage.db).map((key) => [key.id, key.name]))
}

export function withProject<T>(
  deps: CheckEngineDeps,
  projectId: string,
  read: (db: SqliteDatabase, domain: string) => T
): T {
  const project = getProject(deps.storage.db, projectId)
  if (project === null) throw new CheckInputError('Unknown project')
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
  try {
    return read(db, project.domain)
  } finally {
    closeProjectDatabase(db)
  }
}

export function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
