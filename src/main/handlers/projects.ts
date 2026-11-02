/** Projects and fill-from-website. */

import type { IpcHandlersFor, projectsChannels } from '@shared/ipc'
import {
  checkCompanyDomainChannel,
  createProjectChannel,
  fillFromWebsite,
  getProjectChannel,
  listProjectChannel,
  switchProjectChannel,
  updateProjectChannel
} from '../engine/projects'
import {
  parseCheckCompanyDomain,
  parseCreateProject,
  parseFillFromWebsite,
  parseProductCompetitors,
  parseProjectId,
  parseUpdateProject
} from '../ipc-m2'
import { searchProductCompetitors } from '../engine/product-search-retry'
import { guard, type EngineContext } from './context'

export function projectsHandlers(ctx: EngineContext): IpcHandlersFor<typeof projectsChannels> {
  return {
    'projects:list': () => guard('projects:list', ctx, () => listProjectChannel(ctx)),
    'projects:get': (request) =>
      guard('projects:get', ctx, () =>
        getProjectChannel(ctx, parseProjectId(request, 'projects:get').projectId)
      ),
    'projects:create': (request) =>
      guard('projects:create', ctx, () => createProjectChannel(ctx, parseCreateProject(request))),
    'projects:update': (request) =>
      guard('projects:update', ctx, () => updateProjectChannel(ctx, parseUpdateProject(request))),
    'projects:switch': (request) =>
      guard('projects:switch', ctx, () =>
        switchProjectChannel(ctx, parseProjectId(request, 'projects:switch').projectId)
      ),
    'projects:fillFromWebsite': (request) =>
      guard('projects:fillFromWebsite', ctx, () =>
        fillFromWebsite(ctx, parseFillFromWebsite(request))
      ),
    'projects:checkCompanyDomain': (request) =>
      guard('projects:checkCompanyDomain', ctx, () =>
        checkCompanyDomainChannel(ctx, parseCheckCompanyDomain(request))
      ),
    'projects:searchProductCompetitors': (request) =>
      guard('projects:searchProductCompetitors', ctx, () =>
        searchProductCompetitors(ctx, parseProductCompetitors(request))
      )
  }
}
