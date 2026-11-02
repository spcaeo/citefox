import type { AppSchedule, TrayLastCheck } from '@shared/domain'
import { checkCatalogCache } from '../headless/catalog-cache'
import { readStoredCheckCatalog } from '../headless/storage-pass'
import type { QueueKeyInput, QueueProjectInput } from '../queue/types'
import type { AppStorage } from '../storage/app-storage'
import { projectDatabasePool } from '../storage/project-db-pool'
import { writeProjectSchedule } from '../storage/project-schedule'
import { getProject } from '../storage/records'
import { readAppSchedule, writeAppSchedule } from '../storage/settings'
import { listRecentTrayChecks } from '../storage/tray-history'
import { ScheduleError } from './errors'
import type { ScheduleStore } from './session'
import type { ScheduledProjectInput } from './types'

/**
 * Schedule, pages, caps, and planned fixes for the in-app session.
 * Reads come from the cached catalog; project files stay open in the pool.
 * Caps, stagger holds, and new fixes are not written here. The due pass only reads them.
 */
export function storageScheduleStore(storage: AppStorage): ScheduleStore {
  let keys: QueueKeyInput[] = []
  let trayRunning = false
  return {
    getApp(): AppSchedule {
      return readAppSchedule(storage.paths.settingsFile)
    },
    saveApp(next: AppSchedule): void {
      writeAppSchedule(storage.paths.settingsFile, next)
    },
    listProjects(): readonly ScheduledProjectInput[] {
      return readStoredCheckCatalog(storage).catalog.projects
    },
    getProject(projectId: string): ScheduledProjectInput | null {
      return (
        readStoredCheckCatalog(storage).catalog.projects.find(
          (project) => project.projectId === projectId
        ) ?? null
      )
    },
    saveProject(project: ScheduledProjectInput): void {
      const record = getProject(storage.db, project.projectId)
      if (record === null) throw new ScheduleError('Unknown project')
      writeProjectSchedule(projectDatabasePool(storage).get(record.slug), project)
      checkCatalogCache(storage).invalidate()
    },
    listPages() {
      return readStoredCheckCatalog(storage).catalog.pages
    },
    savePage(): void {
      throw new ScheduleError('Page rows are read from storage')
    },
    listFollowUps() {
      return readStoredCheckCatalog(storage).catalog.followUps ?? []
    },
    listTopicBatches() {
      return readStoredCheckCatalog(storage).catalog.topicBatches ?? []
    },
    saveFollowUp(): void {
      throw new ScheduleError('Fix follow-ups are read from storage')
    },
    listQueueProjects(): readonly QueueProjectInput[] {
      return readStoredCheckCatalog(storage).queueProjects
    },
    saveQueueProject(): void {
      throw new ScheduleError('Project caps are read from storage')
    },
    listKeys: () => keys,
    saveKeys(next: readonly QueueKeyInput[]): void {
      keys = [...next]
    },
    trayRunning: () => trayRunning,
    setTrayRunning(running: boolean): void {
      trayRunning = running
    },
    lastChecks(): readonly TrayLastCheck[] {
      return listRecentTrayChecks(storage.db)
    },
    setLastChecks(): void {
      throw new ScheduleError('Tray history is appended when a check succeeds')
    }
  }
}
