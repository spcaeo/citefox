/** The AI visibility home (Overview). Read-only: it spends no searches. */

import type { IpcHandlersFor, visibilityChannels } from '@shared/ipc'
import { loadVisibilityOverview } from '../engine/overview/overview'
import { parseOverviewRequest } from '../engine/overview/parse'
import { withProject } from '../engine/project-db'
import { guard, type EngineContext } from './context'

export function visibilityHandlers(ctx: EngineContext): IpcHandlersFor<typeof visibilityChannels> {
  return {
    'visibility:overview': (request) =>
      guard('visibility:overview', ctx, () => {
        const parsed = parseOverviewRequest(request)
        return withProject(ctx, parsed.projectId, 'visibility:overview', (opened) =>
          loadVisibilityOverview(opened.db, opened.project, parsed, ctx.now())
        )
      })
  }
}
