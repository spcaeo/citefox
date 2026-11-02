import type { CheckJob } from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import type { AppStorage } from '../../storage/app-storage'
import {
  finishStoredCheckJob,
  finishStoredRun,
  listStoredRunningCheckJobs,
  listStoredRunsForJob,
  sumStoredJobSearches,
  type StoredCheckJob
} from '../../storage/check-records'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { listProjects } from '../../storage/records'

export interface ResumeDeps {
  storage: AppStorage
  logger: Logger
  now: () => Date
}

export interface ResumeHooks {
  /** True while this process is already running the job. */
  running(jobId: string): boolean
  /** Restart one stored job in this process. */
  restart(target: ResumeTarget): Promise<CheckJob>
  /** Marks a job this process holds as failed and answers any waiting cancel. */
  fail(jobId: string, finishedAt: string, message: string): void
}

const RESUME_FAILED = 'CiteFox could not resume this check.'

export interface ResumeTarget {
  projectId: string
  slug: string
  job: StoredCheckJob
}

/**
 * NFR-3 startup resume. Each stored `running` job this process is not already
 * running is restarted through `hooks.restart`. One that cannot restart is
 * stored as `error`, so no page is left looking busy.
 */
export async function resumeInterrupted(
  deps: ResumeDeps,
  hooks: ResumeHooks
): Promise<readonly CheckJob[]> {
  const resumed: CheckJob[] = []
  const left: ResumeTarget[] = []
  const restarted = new Set<string>()
  try {
    for (const project of listProjects(deps.storage.db)) {
      const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
      let listed: StoredCheckJob[]
      try {
        listed = listStoredRunningCheckJobs(db)
      } finally {
        closeProjectDatabase(db)
      }
      const batch: ResumeTarget[] = []
      for (const stored of listed) {
        if (hooks.running(stored.id)) {
          restarted.add(stored.id)
          continue
        }
        const target = { projectId: project.id, slug: project.slug, job: stored }
        batch.push(target)
        left.push(target)
      }
      for (const target of batch) {
        if (target.job.pageIds.length === 0) {
          abandonResume(deps, hooks, target, RESUME_FAILED)
          restarted.add(target.job.id)
          continue
        }
        try {
          const job = await hooks.restart(target)
          resumed.push(job)
          restarted.add(target.job.id)
        } catch (error) {
          const message = resumeFailureMessage(error)
          deps.logger.error('check resume failed', { message })
          abandonResume(deps, hooks, target, message)
          restarted.add(target.job.id)
        }
      }
    }
    return resumed
  } catch (error) {
    const message = resumeFailureMessage(error)
    deps.logger.error('check resume failed', { message })
    for (const target of left) {
      if (restarted.has(target.job.id)) continue
      try {
        abandonResume(deps, hooks, target, message)
      } catch (markError) {
        deps.logger.error('check resume failed', { message: resumeFailureMessage(markError) })
      }
    }
    throw error
  }
}

function resumeFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return RESUME_FAILED
}

function abandonResume(
  deps: ResumeDeps,
  hooks: ResumeHooks,
  target: ResumeTarget,
  message: string
): void {
  const finishedAt = deps.now().toISOString()
  hooks.fail(target.job.id, finishedAt, message)
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, target.slug)
  try {
    for (const run of listStoredRunsForJob(db, target.projectId, target.job.id)) {
      if (run.status === 'running') finishStoredRun(db, run.id, finishedAt, 'error')
    }
    finishStoredCheckJob(
      db,
      target.job.id,
      finishedAt,
      'error',
      sumStoredJobSearches(db, target.job.id),
      message,
      null
    )
  } finally {
    closeProjectDatabase(db)
  }
}
