/** Competitors: who the AI Overviews cite and name across the project's latest checks. */

import type { competitorsChannels, IpcHandlersFor } from '@shared/ipc'
import { createCompetitorManager } from '../engine/competitors/manage'
import {
  parseCompetitorsProject,
  parseMergeCompetitors,
  parseRemoveCompetitors,
  parseRemoveSiteTypeDef,
  parseRestoreCompetitors,
  parseSaveCompetitor,
  parseSaveSiteTypeDef,
  parseSetSiteKind,
  parseSetSiteType
} from '../engine/competitors/manage-parse'
import { loadCompetitorsOverview } from '../engine/competitors/overview'
import { parseCompetitorsOverview, parseCompetitorsSortSites } from '../engine/competitors/parse'
import { sortSiteKinds, storedKindsFor, unsortedDomains } from '../engine/competitors/site-kinds'
import { withProject } from '../engine/project-db'
import {
  readSiteTypeSettings,
  removeCustomSiteType,
  saveCustomSiteType,
  setSiteOverride
} from '../storage/site-overrides'
import { guard, type EngineContext } from './context'

/** The widest period, so every site cited in a recent check counts. */
const SORT_PERIOD = 90

export function competitorsHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof competitorsChannels> {
  const manager = createCompetitorManager(() => ctx.createId())
  return {
    'competitors:list': (request) =>
      guard('competitors:list', ctx, () => {
        const { projectId } = parseCompetitorsProject(request, 'competitors:list')
        return withProject(ctx, projectId, 'competitors:list', ({ db }) =>
          manager.list(db, projectId)
        )
      }),
    'competitors:save': (request) =>
      guard('competitors:save', ctx, () => {
        const parsed = parseSaveCompetitor(request)
        return withProject(ctx, parsed.projectId, 'competitors:save', ({ db }) =>
          manager.save(db, parsed)
        )
      }),
    'competitors:remove': (request) =>
      guard('competitors:remove', ctx, () => {
        const parsed = parseRemoveCompetitors(request)
        return withProject(ctx, parsed.projectId, 'competitors:remove', ({ db }) =>
          manager.remove(db, parsed)
        )
      }),
    'competitors:merge': (request) =>
      guard('competitors:merge', ctx, () => {
        const parsed = parseMergeCompetitors(request)
        return withProject(ctx, parsed.projectId, 'competitors:merge', ({ db }) =>
          manager.merge(db, parsed)
        )
      }),
    'competitors:restore': (request) =>
      guard('competitors:restore', ctx, () => {
        const parsed = parseRestoreCompetitors(request)
        return withProject(ctx, parsed.projectId, 'competitors:restore', ({ db }) =>
          manager.restore(db, parsed)
        )
      }),
    'competitors:setSiteKind': (request) =>
      guard('competitors:setSiteKind', ctx, () => {
        const parsed = parseSetSiteKind(request)
        return withProject(ctx, parsed.projectId, 'competitors:setSiteKind', ({ db }) =>
          manager.setSiteKind(db, parsed, ctx.now().toISOString())
        )
      }),
    // The user's type of site and role per domain, and the project's own types (048).
    'competitors:siteTypes': (request) =>
      guard('competitors:siteTypes', ctx, () => {
        const { projectId } = parseCompetitorsProject(request, 'competitors:siteTypes')
        return withProject(ctx, projectId, 'competitors:siteTypes', ({ db }) =>
          readSiteTypeSettings(db)
        )
      }),
    'competitors:setSiteType': (request) =>
      guard('competitors:setSiteType', ctx, () => {
        const { projectId, ...change } = parseSetSiteType(request)
        return withProject(ctx, projectId, 'competitors:setSiteType', ({ db }) =>
          setSiteOverride(db, change, ctx.now().toISOString())
        )
      }),
    'competitors:saveSiteTypeDef': (request) =>
      guard('competitors:saveSiteTypeDef', ctx, () => {
        const { projectId, id, name, tone } = parseSaveSiteTypeDef(request)
        return withProject(ctx, projectId, 'competitors:saveSiteTypeDef', ({ db }) =>
          saveCustomSiteType(db, { id: id ?? ctx.createId(), name, tone }, ctx.now().toISOString())
        )
      }),
    'competitors:removeSiteTypeDef': (request) =>
      guard('competitors:removeSiteTypeDef', ctx, () => {
        const { projectId, id } = parseRemoveSiteTypeDef(request)
        return withProject(ctx, projectId, 'competitors:removeSiteTypeDef', ({ db }) => ({
          cleared: removeCustomSiteType(db, id)
        }))
      }),
    'competitors:overview': (request) =>
      guard('competitors:overview', ctx, () => {
        const parsed = parseCompetitorsOverview(request)
        return withProject(ctx, parsed.projectId, 'competitors:overview', ({ db, project }) =>
          loadCompetitorsOverview({
            db,
            projectId: project.id,
            domain: project.domain,
            now: ctx.now(),
            request: parsed
          })
        )
      }),
    'competitors:sortSites': (request) =>
      guard('competitors:sortSites', ctx, () => {
        const { projectId } = parseCompetitorsSortSites(request)
        return withProject(ctx, projectId, 'competitors:sortSites', async ({ db, project }) => {
          const overview = loadCompetitorsOverview({
            db,
            projectId: project.id,
            domain: project.domain,
            now: ctx.now(),
            request: { projectId: project.id, period: SORT_PERIOD }
          })
          const domains = unsortedDomains(overview.rows, storedKindsFor(db, overview.rows))
          const sorted = await sortSiteKinds({
            host: ctx,
            channel: 'competitors:sortSites',
            db,
            projectId: project.id,
            domains
          })
          return { sorted, remaining: domains.length - sorted }
        })
      })
  }
}
