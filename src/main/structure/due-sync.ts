import type { EngineHost } from '../engine/host'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { listProjects } from '../storage/records'
import { listSitemaps, readSitemapSettings } from '../storage/sitemap-records'
import { nextSyncAt } from './service-sitemaps'

/**
 * FR-19.2. Active projects whose daily or weekly sitemap sync is due now. The
 * window's sync loop and the headless `--check-due` pass both ask this.
 */
export function dueSyncProjects(host: EngineHost, now: Date): string[] {
  const due: string[] = []
  for (const project of listProjects(host.storage.db)) {
    if (project.status !== 'active') continue
    let db
    try {
      db = openProjectDatabase(host.storage.paths.projectsDirectory, project.slug)
    } catch (error) {
      // This project's scheduled sitemap sync cannot run until its file opens again.
      host.logger.warn('project file could not be opened for the sitemap schedule', {
        projectId: project.id,
        threw: error instanceof Error ? error.name : typeof error
      })
      continue
    }
    try {
      const settings = readSitemapSettings(db)
      if (settings.rules.frequency === 'manual' || listSitemaps(db).length === 0) continue
      const next = nextSyncAt(settings.rules.frequency, settings.lastSyncAt, now)
      if (next !== null && Date.parse(next) <= now.getTime()) due.push(project.id)
    } finally {
      closeProjectDatabase(db)
    }
  }
  return due
}
