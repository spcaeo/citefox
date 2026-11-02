import type {
  AppSchedule,
  PageResults,
  PageScoreList,
  PageScoreSummary,
  PageSummary,
  ProjectScoreList,
  ProjectScoreSummary
} from '@shared/domain'
import { readStoredCheckCatalog } from '../../headless/storage-pass'
import { formatInstant, parseClockTime, parseInstant } from '../../scheduler/clock-time'
import { planSchedule } from '../../scheduler/due'
import { dailyCheckOnDay, localDateKey, monthKey } from '../../scheduler/local-time'
import { intervalElapsedAt, inQuiet, quietEnds, releaseInstant } from '../../scheduler/release'
import type { ScheduledPageInput, ScheduledProjectInput } from '../../scheduler/types'
import type { AppStorage } from '../../storage/app-storage'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { getKeyUsageForMonth } from '../../storage/key-usage'
import { listPageMarketSchedules, listPagesOfKind } from '../../storage/pages'
import { readProjectScheduleCap } from '../../storage/project-schedule'
import { getProject, listProjects, type ProjectRecord } from '../../storage/records'
import { filterFor, isFullRun, loadPageResults, trackedPageMap, CheckInputError } from './results'

/** What one project's score pass reads once and shares across its pages. */
export interface ScorePass {
  catalog: ReturnType<typeof readStoredCheckCatalog>['catalog']
  plan: ReturnType<typeof planSchedule>
  month: string
  now: Date
  timeZone: string
}

/** One project's summary and page scores, read in one pass over its file. */
export interface ProjectPageScores {
  summary: ProjectScoreSummary
  pages: PageScoreSummary[]
  /** The pages as listed, removed pages included, in list order. */
  listed: readonly PageSummary[]
  /**
   * Default-market Results for pages with a finished check. Filled for every
   * such page when `withResults` is set, otherwise only where `change` needs it.
   */
  results: ReadonlyMap<string, PageResults>
}

export function scorePass(storage: AppStorage, now: Date, timeZone: string): ScorePass {
  const nowMs = now.getTime()
  const { catalog } = readStoredCheckCatalog(storage)
  return {
    catalog,
    plan: planSchedule(catalog, nowMs, timeZone),
    month: monthKey(nowMs, timeZone),
    now,
    timeZone
  }
}

/**
 * FR-10.5 and FR-20.7. Project and page scores from stored runs, default market.
 * Runs and page markets are read with one query each for the whole file, and
 * one tracked-page map is shared by every Results load (NFR-12).
 */
export function loadProjectPageScores(
  storage: AppStorage,
  project: ProjectRecord,
  db: SqliteDatabase,
  pass: ScorePass,
  withResults: boolean
): ProjectPageScores {
  const nowMs = pass.now.getTime()
  const planned = pass.plan.projects.find((item) => item.projectId === project.id)
  const scheduled = pass.catalog.projects.find((item) => item.projectId === project.id)
  const catalogPages = new Map<string, ScheduledPageInput>()
  for (const item of pass.catalog.pages) {
    if (item.projectId === project.id) catalogPages.set(item.pageId, item)
  }
  // Topics are scored by their own goal (topics:results), not the page score.
  const listed = listPagesOfKind(db, project.id, 'page')
  const tracked = trackedPageMap(listed)
  const runsByPageMarket = new Map<string, StoredCheckRun[]>()
  for (const run of listStoredCheckRuns(db, filterFor(project.id, null, null))) {
    const key = `${run.pageId}|${run.marketId}`
    const list = runsByPageMarket.get(key)
    if (list) list.push(run)
    else runsByPageMarket.set(key, [run])
  }
  const marketSchedules = listPageMarketSchedules(db)
  const results = new Map<string, PageResults>()
  const deltas: number[] = []
  const pages = listed.map((page): PageScoreSummary => {
    const runs =
      page.defaultMarketId === null
        ? []
        : (runsByPageMarket.get(`${page.id}|${page.defaultMarketId}`) ?? [])
    const finished = runs.filter((run) => run.status === 'finished')
    const needsChange = page.score !== null && finished.filter(isFullRun).length >= 2
    let change: number | null = null
    if (needsChange || (withResults && finished.length > 0)) {
      const loaded = loadPageResults(db, {
        projectId: project.id,
        pageId: page.id,
        marketId: page.defaultMarketId,
        runId: null,
        builtAt: pass.now.toISOString(),
        domain: project.domain,
        keyLabels: new Map(),
        trackedPages: tracked
      })
      results.set(page.id, loaded)
      if (needsChange) change = loaded.scoreChange.sincePrevious
    }
    if (change !== null) deltas.push(change)
    const catalogPage = catalogPages.get(page.id)
    const lastFromMarket =
      page.defaultMarketId === null
        ? null
        : (marketSchedules.get(page.id)?.find((market) => market.marketId === page.defaultMarketId)
            ?.lastCheckedAt ?? null)
    return {
      pageId: page.id,
      score: page.score,
      change,
      nextCheckAt:
        scheduled === undefined || catalogPage === undefined
          ? null
          : pageNext(catalogPage, scheduled, pass.catalog.app, nowMs, pass.timeZone),
      lastCheckedAt: lastFromMarket ?? finished.at(-1)?.finishedAt ?? null,
      intervalDays: page.intervalDays
    }
  })
  const scored = listed.filter((page) => page.score !== null)
  const average =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, page) => sum + (page.score ?? 0), 0) / scored.length)
  const cap = readProjectScheduleCap(db)
  const summary: ProjectScoreSummary = {
    projectId: project.id,
    averageScore: average,
    change: deltas.length === 0 ? null : Math.round(mean(deltas)),
    nextCheckAt: project.status === 'archived' ? null : (planned?.nextCheckAt ?? null),
    searchesUsed: projectSearches(storage, project.id, pass.month),
    searchCap: cap.cap,
    pagesDueToday:
      planned?.paused || project.status === 'paused' ? 0 : (planned?.pagesDueToday ?? 0)
  }
  return { summary, pages, listed, results }
}

/** The searches a project used this month and its cap, without scoring its pages. */
export function projectSearchBudget(
  storage: AppStorage,
  projectId: string,
  db: SqliteDatabase,
  pass: ScorePass
): Pick<ProjectScoreSummary, 'searchesUsed' | 'searchCap'> {
  return {
    searchesUsed: projectSearches(storage, projectId, pass.month),
    searchCap: readProjectScheduleCap(db).cap
  }
}

/** Opens one project's file and runs {@link loadProjectPageScores}. */
export function loadProjectScores(
  storage: AppStorage,
  projectId: string,
  now: Date,
  timeZone: string,
  withResults: boolean
): ProjectPageScores {
  const project = getProject(storage.db, projectId)
  if (project === null) throw new CheckInputError('Unknown project')
  const pass = scorePass(storage, now, timeZone)
  const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  try {
    return loadProjectPageScores(storage, project, db, pass, withResults)
  } finally {
    closeProjectDatabase(db)
  }
}

/**
 * FR-10.5 and FR-20.7. Project and page scores from stored runs.
 * `nextCheckAt` stays set while a project is paused.
 */
export function loadProjectScoreList(
  storage: AppStorage,
  now: Date,
  timeZone: string
): ProjectScoreList {
  const pass = scorePass(storage, now, timeZone)
  const projects = listProjects(storage.db).map((project) => {
    const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
    try {
      return loadProjectPageScores(storage, project, db, pass, false).summary
    } finally {
      closeProjectDatabase(db)
    }
  })
  const next = projects
    .map((project) => project.nextCheckAt)
    .filter((value): value is string => value !== null)
    .sort()
  return {
    projects,
    searchesUsed: projects.reduce((sum, project) => sum + project.searchesUsed, 0),
    nextCheckAt: next[0] ?? null
  }
}

/** One project's scores. Only that project's file is read. */
export function loadPageScoreList(
  storage: AppStorage,
  projectId: string,
  now: Date,
  timeZone: string
): PageScoreList {
  const scores = loadProjectScores(storage, projectId, now, timeZone, false)
  return { projectId, summary: scores.summary, pages: scores.pages }
}

/** Each page's and topic's soonest scheduled check in one project, as All pages shows it. */
export function scheduledNextChecks(
  pass: ScorePass,
  projectId: string
): Map<string, string | null> {
  const next = new Map<string, string | null>()
  const project = pass.catalog.projects.find((item) => item.projectId === projectId)
  if (project === undefined) return next
  const nowMs = pass.now.getTime()
  for (const page of pass.catalog.pages) {
    if (page.projectId !== projectId) continue
    next.set(page.pageId, pageNext(page, project, pass.catalog.app, nowMs, pass.timeZone))
  }
  return next
}

function pageNext(
  page: ScheduledPageInput,
  project: ScheduledProjectInput,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): string | null {
  if (project.archived) return null
  if (page.status !== 'tracked' && page.status !== 'paused') return null
  let soonest = Number.POSITIVE_INFINITY
  for (const market of page.markets) {
    // A first check that waits for the user has no date (project migration 033).
    if (page.firstCheckWaits === true && market.lastCheckedAt === null) continue
    const raw =
      market.lastCheckedAt === null
        ? market.firstCheckNotBefore === null
          ? nowMs
          : parseInstant(market.firstCheckNotBefore, 'first check')
        : intervalElapsedAt(
            parseInstant(market.lastCheckedAt, 'last check'),
            page.intervalDays,
            project,
            timeZone
          )
    const at = gate(raw, project, app, nowMs, timeZone)
    if (at < soonest) soonest = at
  }
  return Number.isFinite(soonest) ? formatInstant(soonest) : null
}

function gate(
  rawAt: number,
  project: ScheduledProjectInput,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): number {
  const firstSlot = releaseInstant(rawAt, project, timeZone)
  const today = localDateKey(nowMs, timeZone)
  const catchUpOn = app.catchUpAfterSleep && project.catchUp
  if (nowMs < firstSlot) return firstSlot
  const slotDay = localDateKey(firstSlot, timeZone)
  if (slotDay < today && !catchUpOn) {
    return releaseInstant(
      dailyCheckOnDay(nowMs, timeZone, parseClockTime(project.dailyCheckTime, 'daily check time')),
      project,
      timeZone
    )
  }
  if (inQuiet(nowMs, project, timeZone)) return quietEnds(nowMs, project, timeZone)
  return firstSlot
}

function projectSearches(storage: AppStorage, projectId: string, month: string): number {
  const usage = getKeyUsageForMonth(storage.db, month)
  let searches = 0
  for (const key of usage.keys) {
    for (const project of key.projects) {
      if (project.projectId === projectId) searches += project.searches
    }
  }
  return searches
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
