import { statSync } from 'node:fs'
import type { ScheduledPageInput, ScheduledProjectInput, TopicBatchInput } from '../scheduler/types'
import type { AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { projectDatabasePool } from '../storage/project-db-pool'
import { listProjects } from '../storage/records'
import { readAppSchedule } from '../storage/settings'
import type { FixFollowUpInput } from '@shared/domain'
import type { QueueProjectInput } from '../queue/types'
import { currentLocalMonth, readProjectCheckSlice, type StoredCheckCatalog } from './check-catalog'

/**
 * The scheduler's catalog, rebuilt only when something it reads has changed.
 * Tray menus, status reads, and every finished check used to reopen and
 * re-read every project file. Now each read checks a cheap fingerprint:
 * `settings.json` size and mtime, the project rows, and for each pooled
 * project file `PRAGMA data_version` (commits by any other connection or
 * process) plus `total_changes()` (writes through the pooled handle).
 * `invalidate` forces a rebuild after a write the caller knows about.
 */
export interface CheckCatalogCache {
  read(): StoredCheckCatalog
  invalidate(): void
  stats(): { builds: number }
}

const caches = new WeakMap<SqliteDatabase, CheckCatalogCache>()

export function checkCatalogCache(storage: AppStorage): CheckCatalogCache {
  const existing = caches.get(storage.db)
  if (existing !== undefined) return existing
  const created = createCache(storage)
  caches.set(storage.db, created)
  return created
}

function createCache(storage: AppStorage): CheckCatalogCache {
  let cached: { fingerprint: string; value: StoredCheckCatalog } | null = null
  let builds = 0
  return {
    read(): StoredCheckCatalog {
      const fingerprint = fingerprintOf(storage)
      if (cached !== null && cached.fingerprint === fingerprint) return cached.value
      const value = build(storage)
      builds += 1
      // Reading can migrate a project file. Take the fingerprint after the build.
      cached = { fingerprint: fingerprintOf(storage), value }
      return value
    },
    invalidate(): void {
      cached = null
    },
    stats: () => ({ builds })
  }
}

function build(storage: AppStorage): StoredCheckCatalog {
  const pool = projectDatabasePool(storage)
  const app = readAppSchedule(storage.paths.settingsFile)
  const projects: ScheduledProjectInput[] = []
  const pages: ScheduledPageInput[] = []
  const followUps: FixFollowUpInput[] = []
  const topicBatches: TopicBatchInput[] = []
  const queueProjects: QueueProjectInput[] = []
  for (const project of listProjects(storage.db)) {
    const slice = readProjectCheckSlice(pool.get(project.slug), project)
    projects.push(slice.scheduledProject)
    queueProjects.push(slice.queueProject)
    pages.push(...slice.pages)
    followUps.push(...slice.followUps)
    topicBatches.push(...slice.topicBatches)
  }
  return { catalog: { app, projects, pages, followUps, topicBatches }, queueProjects }
}

function fingerprintOf(storage: AppStorage): string {
  const pool = projectDatabasePool(storage)
  // The month is part of the key: a 10%-over choice ends when the month does (FR-11.4).
  const parts: string[] = [settingsStamp(storage.paths.settingsFile), currentLocalMonth()]
  const projects = listProjects(storage.db)
  pool.retain(new Set(projects.map((project) => project.slug)))
  for (const project of projects) {
    const db = pool.get(project.slug)
    const version = db.pragma('data_version', { simple: true })
    const changes = db.prepare<unknown[], { n: number }>('SELECT total_changes() AS n').get()?.n
    parts.push(
      `${project.id}|${project.slug}|${project.name}|${project.status}|${String(version)}|${String(changes)}`
    )
  }
  return parts.join('\n')
}

function settingsStamp(file: string): string {
  try {
    const stat = statSync(file)
    return `${stat.size}:${stat.mtimeMs}`
  } catch {
    return 'none'
  }
}
