import type { ReportScope } from '@shared/domain'
import type { ReportSchedule } from '../email/types'
import type { Logger } from '../logging/logger'
import type { AppStorage } from '../storage/app-storage'
import { listClusters } from '../storage/cluster-records'
import { listGroups } from '../storage/group-records'
import { listPages } from '../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getProject } from '../storage/records'

/** What a scope is resolved against: the project's live pages and its structure. */
export interface ScopeSources {
  /** Page and topic ids that are in the project and not removed. */
  pageIds: readonly string[]
  groups: readonly { id: string; pageIds: readonly string[] }[]
  clusters: readonly { id: string; pageIds: readonly string[] }[]
}

/**
 * The page (and topic) ids a report scope covers, in the project's page order.
 * `pages` and `topic` keep the picked ids that still exist; `group` and
 * `cluster` are their members today, so a page added later is in the next send.
 * Null is the whole project: no scope, `project`, or nothing left to report on.
 */
export function resolveReportScope(
  scope: ReportScope | null,
  sources: ScopeSources
): string[] | null {
  if (scope === null || scope.kind === 'project' || scope.ids.length === 0) return null
  const picked = new Set(scope.ids)
  let wanted: Set<string>
  if (scope.kind === 'pages' || scope.kind === 'topic') {
    wanted = picked
  } else {
    const sets = scope.kind === 'group' ? sources.groups : sources.clusters
    wanted = new Set(sets.filter((set) => picked.has(set.id)).flatMap((set) => set.pageIds))
  }
  const ids = sources.pageIds.filter((id) => wanted.has(id))
  return ids.length === 0 ? null : ids
}

/**
 * The schedule's scope for `projectId`, read from the project file. An
 * all-projects schedule ignores its scope. A scope that resolves to nothing
 * (the group was emptied, the pages were removed) reports on the whole project
 * and logs a warning, so the email still goes out.
 */
export function scheduleScopePageIds(
  storage: AppStorage,
  schedule: Pick<ReportSchedule, 'id' | 'scope' | 'projectId'>,
  projectId: string | null,
  logger?: Logger
): string[] | null {
  const scope = schedule.scope ?? null
  if (schedule.projectId === null || projectId === null || scope === null) return null
  if (scope.kind === 'project') return null
  const project = getProject(storage.db, projectId)
  if (project === null) return null
  const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  let resolved: string[] | null
  try {
    resolved = resolveReportScope(scope, {
      pageIds: listPages(db, projectId)
        .filter((page) => page.status !== 'removed')
        .map((page) => page.id),
      groups: listGroups(db).map((group) => ({ id: group.id, pageIds: group.pageIds })),
      clusters: listClusters(db).map((cluster) => ({
        id: cluster.id,
        pageIds: cluster.pages.map((member) => member.pageId)
      }))
    })
  } finally {
    closeProjectDatabase(db)
  }
  if (resolved === null) {
    logger?.warn('scheduled report scope is empty, reporting on the whole project', {
      scheduleId: schedule.id,
      kind: scope.kind
    })
  }
  return resolved
}
