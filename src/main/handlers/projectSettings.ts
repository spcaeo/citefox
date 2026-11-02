/** Project settings, duplicate, delete, usage, and competitor finding. */

import type { IpcHandlersFor, projectSettingsChannels } from '@shared/ipc'
import { findCompetitors } from '../engine/project-settings/competitors'
import { deleteProjectChannel, duplicateProject } from '../engine/project-settings/lifecycle'
import {
  addProjectMarket,
  projectMarkets,
  removeProjectMarket,
  restoreProjectMarket,
  setDefaultProjectMarket
} from '../engine/project-settings/markets'
import { getProjectSettings, updateProjectSettings } from '../engine/project-settings/settings'
import { projectUsageReport } from '../engine/project-settings/usage'
import { parseProjectId } from '../ipc-m2'
import {
  parseAddProjectMarket,
  parseRemoveProjectMarket,
  parseRestoreProjectMarket,
  parseSetDefaultProjectMarket
} from '../ipc-project-markets'
import { parseDeleteProject, parseUpdateProjectSettings } from '../ipc-project-settings'
import { guard, type EngineContext } from './context'

export function projectSettingsHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof projectSettingsChannels> {
  return {
    'projectSettings:get': (request) =>
      guard('projectSettings:get', ctx, () =>
        getProjectSettings(ctx, parseProjectId(request, 'projectSettings:get').projectId)
      ),
    'projectSettings:update': (request) =>
      guard('projectSettings:update', ctx, () =>
        updateProjectSettings(ctx, parseUpdateProjectSettings(request))
      ),
    'projectSettings:duplicate': (request) =>
      guard('projectSettings:duplicate', ctx, () =>
        duplicateProject(ctx, parseProjectId(request, 'projectSettings:duplicate').projectId)
      ),
    'projectSettings:delete': (request) =>
      guard('projectSettings:delete', ctx, () =>
        deleteProjectChannel(ctx, parseDeleteProject(request))
      ),
    'projectSettings:findCompetitors': (request) =>
      guard('projectSettings:findCompetitors', ctx, () =>
        findCompetitors(ctx, parseProjectId(request, 'projectSettings:findCompetitors').projectId)
      ),
    'projectSettings:usage': () =>
      guard('projectSettings:usage', ctx, () => projectUsageReport(ctx.storage, ctx.now())),
    'projectSettings:markets': (request) =>
      guard('projectSettings:markets', ctx, () =>
        projectMarkets(ctx, parseProjectId(request, 'projectSettings:markets').projectId)
      ),
    'projectSettings:addMarket': (request) =>
      guard('projectSettings:addMarket', ctx, () =>
        addProjectMarket(ctx, parseAddProjectMarket(request))
      ),
    'projectSettings:removeMarket': (request) =>
      guard('projectSettings:removeMarket', ctx, () =>
        removeProjectMarket(ctx, parseRemoveProjectMarket(request))
      ),
    'projectSettings:restoreMarket': (request) =>
      guard('projectSettings:restoreMarket', ctx, () =>
        restoreProjectMarket(ctx, parseRestoreProjectMarket(request))
      ),
    'projectSettings:setDefaultMarket': (request) =>
      guard('projectSettings:setDefaultMarket', ctx, () =>
        setDefaultProjectMarket(ctx, parseSetDefaultProjectMarket(request))
      )
  }
}
