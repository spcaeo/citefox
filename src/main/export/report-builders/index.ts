import { loadExportSourceExtras } from '../../communities/export-extras'
import { outcomeReader } from '../../engine/progress/fix-outcomes'
import type { Logger } from '../../logging/logger'
import { listClusters } from '../../storage/cluster-records'
import type { SqliteDatabase } from '../../storage/database'
import { listFixFollowUps } from '../../storage/fix-follow-ups'
import { listGroups } from '../../storage/group-records'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { getProject } from '../../storage/records'
import type { ReportBuildContext, ReportSectionBuilders } from '../model/types'
import { buildReputation } from '../sections/reputation'
import { structureDimension, type StructureMembership } from './groups'
import { reputationModel } from './reputation'
import { communitySources } from './sources'
import { fixVerdictModels } from './verdicts'
import { topicCoverageFromStorage } from './topics'

export { communitySources } from './sources'
export { fixVerdictModels } from './verdicts'
export { reputationModel } from './reputation'
export { structureDimension } from './groups'
export { topicCoverageFromStorage } from './topics'

export interface StorageReportBuilderDeps {
  /** The app database (projects). */
  app: SqliteDatabase
  projectsDirectory: string
  now: () => Date
  logger?: Logger
}

/**
 * The production `ReportSectionBuilders` for one project (Docs/REPORT-SPEC.md):
 * reputation from brand sentiment (`buildReputation`), sources enriched with the
 * Communities caches, the group/cluster universe row from site structure, and fix
 * verdicts from Progress, and topic coverage for topic subjects. Each reads the project file once, never fetches, and falls
 * back to the report's own section when it fails, so an export never breaks on it.
 */
export function storageReportBuilders(
  deps: StorageReportBuilderDeps,
  projectId: string
): ReportSectionBuilders {
  const withProject = <T>(
    section: string,
    fallback: T,
    read: (db: SqliteDatabase, domain: string) => T
  ): T => {
    const project = getProject(deps.app, projectId)
    if (project === null) return fallback
    let db: SqliteDatabase | null = null
    try {
      db = openProjectDatabase(deps.projectsDirectory, project.slug)
      return read(db, project.domain)
    } catch (error) {
      deps.logger?.warn('report section builder fell back', {
        section,
        message: error instanceof Error ? error.message : 'read failed'
      })
      return fallback
    } finally {
      if (db !== null) closeProjectDatabase(db)
    }
  }
  return {
    reputation: (context) =>
      withProject('reputation', undefined, (db) =>
        reputationModel(
          buildReputation(db, {
            projectId,
            pageIds: trackedPageIds(context),
            marketIds: context.markets.map((market) => market.id)
          }),
          context
        )
      ),
    sources: (context, base) =>
      withProject('sources', base, (db) =>
        communitySources(base, context, loadExportSourceExtras(db))
      ),
    groups: (context) =>
      withProject('groups', null, (db) => structureDimension(memberships(db), context)),
    verdicts: (context) =>
      withProject('verdicts', undefined, (db, domain) => {
        const reader = outcomeReader(db, projectId, domain, deps.now().toISOString())
        const pages = new Set(trackedPageIds(context))
        const fixes = listFixFollowUps(db).filter((fix) => pages.has(fix.pageId))
        return fixVerdictModels(
          fixes.map((fix) => ({ fix, markets: reader.outcomes(fix) })),
          context
        )
      }),
    topicCoverage: (context) =>
      withProject('topicCoverage', null, (db, domain) =>
        topicCoverageFromStorage(
          db,
          { projectId, domain, builtAt: deps.now().toISOString() },
          context
        )
      )
  }
}

function trackedPageIds(context: ReportBuildContext): string[] {
  return context.pages.filter((page) => page.role === 'tracked').map((page) => page.id)
}

/** Groups first (named by the user), then clusters, as `structure:listMemberships` lists them. */
function memberships(db: SqliteDatabase): StructureMembership[] {
  return [
    ...listGroups(db).map((group) => ({
      id: group.id,
      name: group.name,
      kind: 'group' as const,
      pageIds: group.pageIds
    })),
    ...listClusters(db).map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      kind: 'cluster' as const,
      pageIds: cluster.pages.map((member) => member.pageId)
    }))
  ]
}
