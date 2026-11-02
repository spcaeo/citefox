import type { SetupFailure, SetupPageRef, SetupStatus } from '@shared/ipc'
import { localDateKey, utcFromLocal } from '../scheduler/local-time'
import type { AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { listSetupCandidates, listSetupDoneSince } from '../storage/page-setup-jobs'
import { projectDatabasePool } from '../storage/project-db-pool'
import { listProjects, type ProjectRecord } from '../storage/records'
import { readSetupRunnerSettings } from '../storage/setup-runner-settings'
import { MAX_LISTED_FAILURES } from './constants'

export interface SetupStatusInput {
  storage: AppStorage
  nowMs: number
  timeZone: string
  /** `projectId\npageId` of pages running in this process. */
  running: ReadonlySet<string>
  holdReason: string | null
}

/** `setup:status` across every project. Reads one query per project for pages and rows. */
export function computeSetupStatus(input: SetupStatusInput): SetupStatus {
  const settings = readSetupRunnerSettings(input.storage.db)
  const since = startOfLocalDay(input.nowMs, input.timeZone)
  const waiting: SetupPageRef[] = []
  const failed: SetupPageRef[] = []
  const doneToday: SetupPageRef[] = []
  const running = new Map<string, SetupPageRef>()
  const failures: SetupFailure[] = []
  const projects = listProjects(input.storage.db)
  for (const project of projects) {
    const db = openPooled(input.storage, project)
    if (db === null) continue
    for (const page of listSetupDoneSince(db, since)) {
      doneToday.push(pageRef(project, page))
    }
    for (const candidate of listSetupCandidates(db)) {
      const ref = pageRef(project, candidate)
      const key = runKey(project.id, candidate.pageId)
      if (input.running.has(key)) {
        running.set(key, ref)
        continue
      }
      const job = candidate.job
      if (job?.state === 'failed') failed.push(ref)
      else waiting.push(ref)
      if (job === null || (job.state !== 'failed' && job.state !== 'retry')) continue
      failures.push({
        projectId: project.id,
        projectName: project.name,
        pageId: candidate.pageId,
        url: candidate.url,
        label: candidate.label ?? candidate.title,
        step: job.step,
        reason: job.lastError ?? 'Setup stopped.',
        nextStep: job.nextStep,
        attempts: job.attempts,
        failedAt: job.updatedAt,
        retryAt: job.state === 'retry' ? job.nextAttemptAt : null
      })
    }
  }
  failures.sort((a, b) => (a.failedAt < b.failedAt ? 1 : a.failedAt > b.failedAt ? -1 : 0))
  // A running page is normally still a candidate; one that is not keeps its count and id.
  const runningPages = [...input.running].map((key) => {
    const found = running.get(key)
    if (found) return found
    const [projectId = '', pageId = ''] = key.split('\n')
    const project = projects.find((item) => item.id === projectId)
    return { projectId, projectName: project?.name ?? '', pageId, url: '', label: null }
  })
  return {
    builtAt: new Date(input.nowMs).toISOString(),
    paused: settings.paused,
    pagesPerHour: settings.pagesPerHour,
    waiting: waiting.length,
    running: runningPages.length,
    doneToday: doneToday.length,
    failed: failed.length,
    failures: failures.slice(0, MAX_LISTED_FAILURES),
    holdReason: settings.paused ? 'Background setup is paused.' : input.holdReason,
    pages: { waiting, running: runningPages, doneToday, failed }
  }
}

function pageRef(
  project: ProjectRecord,
  page: { pageId: string; url: string; label: string | null; title: string | null }
): SetupPageRef {
  return {
    projectId: project.id,
    projectName: project.name,
    pageId: page.pageId,
    url: page.url,
    label: page.label ?? page.title
  }
}

export function runKey(projectId: string, pageId: string): string {
  return `${projectId}\n${pageId}`
}

/** A project file that cannot open (moved, damaged) is skipped, not fatal. */
export function openPooled(storage: AppStorage, project: ProjectRecord): SqliteDatabase | null {
  try {
    return projectDatabasePool(storage).get(project.slug)
  } catch {
    return null
  }
}

function startOfLocalDay(nowMs: number, timeZone: string): string {
  const [year, month, day] = localDateKey(nowMs, timeZone).split('-').map(Number)
  const at = utcFromLocal(
    { year: year ?? 1970, month: month ?? 1, day: day ?? 1, hour: 0, minute: 0 },
    timeZone
  )
  return new Date(at).toISOString()
}
