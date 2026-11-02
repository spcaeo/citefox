import type { Logger } from '../logging/logger'
import type { AppStorage } from '../storage/app-storage'
import { listStoredRunningCheckJobs } from '../storage/check-records'
import { projectDatabasePool } from '../storage/project-db-pool'
import { listProjects } from '../storage/records'

/**
 * NFR-3 startup resume and SCH-2. Startup resume restarts stored `running`
 * jobs one after another, so a later job's pages are not "running" in the
 * engine yet when the tray's first due pass starts. The guard reads every
 * stored running job before that pass and keeps their pages busy until
 * resume settles, so the queue cannot start a second check of the same page.
 */
export interface ResumeGuard {
  busy(projectId: string, pageId: string): boolean
  /** Releases the pages when `resume` settles, either way. Returns `resume`. */
  track<T>(resume: Promise<T>): Promise<T>
}

export function guardResumingPages(
  storage: AppStorage,
  logger?: Pick<Logger, 'error'>
): ResumeGuard {
  const pages = new Set<string>()
  try {
    const pool = projectDatabasePool(storage)
    for (const project of listProjects(storage.db)) {
      for (const job of listStoredRunningCheckJobs(pool.get(project.slug))) {
        for (const pageId of job.pageIds) pages.add(key(project.id, pageId))
      }
    }
  } catch (error: unknown) {
    logger?.error('CiteFox could not read checks to resume', error)
  }
  return {
    busy: (projectId, pageId) => pages.has(key(projectId, pageId)),
    track<T>(resume: Promise<T>): Promise<T> {
      return resume.finally(() => {
        pages.clear()
      })
    }
  }
}

function key(projectId: string, pageId: string): string {
  return `${projectId}\0${pageId}`
}
