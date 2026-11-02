/** Sitemaps and sync, Import pages, and Site structure (SRS 4.19, FR-20.6, FR-20.8). */

import type { IpcHandlersFor, structureChannels } from '@shared/ipc'
import {
  parseClaudePickRequest,
  parseClusterId,
  parseClusterSummary,
  parseCreateCluster,
  parseCreateGroup,
  parseDiscover,
  parseEstimate,
  parseGroupId,
  parseGroupPages,
  parseImportUrlsRequest,
  parseMerge,
  parseMovePage,
  parseMovePages,
  parseProject,
  parseRecluster,
  parseRenameCluster,
  parseRenameGroup,
  parseSetIncluded,
  parseSetRole,
  parseSetRules,
  parseSetSilo,
  parseSitemapId,
  parseSitemapUrl,
  parseSplitCluster,
  parseTrack,
  parseTrackCluster
} from '../structure/parse'
import type { StructureRuntimeOptions } from '../structure/runtime'
import {
  createCluster,
  deleteCluster,
  movePages,
  splitCluster
} from '../structure/service-clusters'
import {
  createGroup,
  deleteGroup,
  groupPages,
  renameGroup,
  setGroupPages
} from '../structure/service-groups'
import {
  claudePick,
  importCandidates,
  importEstimate,
  importTrack,
  parseImportUrls
} from '../structure/service-import'
import {
  addSitemap,
  discoverSitemaps,
  removeSitemap,
  setIncluded,
  setRules,
  sitemapOverview,
  syncNow
} from '../structure/service-sitemaps'
import {
  clusterPages,
  clusterSummary,
  memberships,
  mergeClusters,
  movePage,
  recluster,
  renameCluster,
  setPageRole,
  setSilo,
  structureView,
  suggestLinks,
  trackCluster,
  undoClusters
} from '../structure/service-structure'
import { structureRuntimeFor } from '../structure/sync-loop'
import { guard, type EngineContext } from './context'

export function structureHandlers(
  ctx: EngineContext,
  options: StructureRuntimeOptions = {}
): IpcHandlersFor<typeof structureChannels> {
  const rt = structureRuntimeFor(ctx, options)
  return {
    'sitemaps:get': (request) =>
      guard('sitemaps:get', ctx, () =>
        sitemapOverview(rt, parseProject(request, 'sitemaps:get').projectId, 'sitemaps:get')
      ),
    'sitemaps:discover': (request) =>
      guard('sitemaps:discover', ctx, () => discoverSitemaps(rt, parseDiscover(request))),
    'sitemaps:add': (request) =>
      guard('sitemaps:add', ctx, () => addSitemap(rt, parseSitemapUrl(request))),
    'sitemaps:remove': (request) =>
      guard('sitemaps:remove', ctx, () =>
        removeSitemap(rt, parseSitemapId(request, 'sitemaps:remove'))
      ),
    'sitemaps:setIncluded': (request) =>
      guard('sitemaps:setIncluded', ctx, () => setIncluded(rt, parseSetIncluded(request))),
    'sitemaps:setRules': (request) =>
      guard('sitemaps:setRules', ctx, () => setRules(rt, parseSetRules(request))),
    'sitemaps:sync': (request) =>
      guard('sitemaps:sync', ctx, () =>
        syncNow(rt, parseProject(request, 'sitemaps:sync').projectId)
      ),
    'import:candidates': (request) =>
      guard('import:candidates', ctx, () =>
        importCandidates(rt, parseProject(request, 'import:candidates').projectId)
      ),
    'import:parseUrls': (request) =>
      guard('import:parseUrls', ctx, () => parseImportUrls(rt, parseImportUrlsRequest(request))),
    'import:estimate': (request) =>
      guard('import:estimate', ctx, () => importEstimate(rt, parseEstimate(request))),
    'import:claudePick': (request) =>
      guard('import:claudePick', ctx, () => claudePick(rt, parseClaudePickRequest(request))),
    'import:track': (request) =>
      guard('import:track', ctx, () => importTrack(rt, parseTrack(request))),
    'structure:get': (request) =>
      guard('structure:get', ctx, () =>
        structureView(rt, parseProject(request, 'structure:get').projectId)
      ),
    'structure:clusterPages': (request) =>
      guard('structure:clusterPages', ctx, () => {
        const parsed = parseClusterId(request, 'structure:clusterPages')
        return clusterPages(rt, parsed.projectId, parsed.clusterId)
      }),
    'structure:recluster': (request) =>
      guard('structure:recluster', ctx, () => recluster(rt, parseRecluster(request))),
    'structure:undoClusters': (request) =>
      guard('structure:undoClusters', ctx, () =>
        undoClusters(rt, parseProject(request, 'structure:undoClusters').projectId)
      ),
    'structure:renameCluster': (request) =>
      guard('structure:renameCluster', ctx, () => renameCluster(rt, parseRenameCluster(request))),
    'structure:mergeClusters': (request) =>
      guard('structure:mergeClusters', ctx, () => mergeClusters(rt, parseMerge(request))),
    'structure:movePage': (request) =>
      guard('structure:movePage', ctx, () => movePage(rt, parseMovePage(request))),
    'structure:movePages': (request) =>
      guard('structure:movePages', ctx, () => movePages(rt, parseMovePages(request))),
    'structure:createCluster': (request) =>
      guard('structure:createCluster', ctx, () => createCluster(rt, parseCreateCluster(request))),
    'structure:deleteCluster': (request) =>
      guard('structure:deleteCluster', ctx, () =>
        deleteCluster(rt, parseClusterId(request, 'structure:deleteCluster'))
      ),
    'structure:splitCluster': (request) =>
      guard('structure:splitCluster', ctx, () => splitCluster(rt, parseSplitCluster(request))),
    'structure:setPageRole': (request) =>
      guard('structure:setPageRole', ctx, () => setPageRole(rt, parseSetRole(request))),
    'structure:trackCluster': (request) =>
      guard('structure:trackCluster', ctx, () => trackCluster(rt, parseTrackCluster(request))),
    'structure:setSilo': (request) =>
      guard('structure:setSilo', ctx, () => setSilo(rt, parseSetSilo(request))),
    'structure:createGroup': (request) =>
      guard('structure:createGroup', ctx, () => createGroup(rt, parseCreateGroup(request))),
    'structure:renameGroup': (request) =>
      guard('structure:renameGroup', ctx, () => renameGroup(rt, parseRenameGroup(request))),
    'structure:deleteGroup': (request) =>
      guard('structure:deleteGroup', ctx, () =>
        deleteGroup(rt, parseGroupId(request, 'structure:deleteGroup'))
      ),
    'structure:setGroupPages': (request) =>
      guard('structure:setGroupPages', ctx, () => setGroupPages(rt, parseGroupPages(request))),
    'structure:groupPages': (request) =>
      guard('structure:groupPages', ctx, () =>
        groupPages(rt, parseGroupId(request, 'structure:groupPages'))
      ),
    'structure:listMemberships': (request) =>
      guard('structure:listMemberships', ctx, () =>
        memberships(rt, parseProject(request, 'structure:listMemberships').projectId)
      ),
    'structure:clusterSummary': (request) =>
      guard('structure:clusterSummary', ctx, () =>
        clusterSummary(rt, parseClusterSummary(request))
      ),
    'structure:suggestLinks': (request) =>
      guard('structure:suggestLinks', ctx, () => {
        const parsed = parseClusterId(request, 'structure:suggestLinks')
        return suggestLinks(rt, parsed.projectId, parsed.clusterId)
      })
  }
}
