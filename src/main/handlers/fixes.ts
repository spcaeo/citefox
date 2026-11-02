/** Progress and fixes: log a fix, preview its follow-up, run it now, verdicts (FR-14.5 to FR-14.7). */

import type { fixesChannels, IpcHandlersFor } from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import { createFixesService, type FixesService } from '../engine/progress/fixes'
import {
  parseCreateFix,
  parseFixId,
  parseFixList,
  parseFixPreview,
  parseUpdateFix
} from '../engine/progress/parse'
import { parseProjectId } from '../ipc-m2'
import { guard, runCheckChannel, type EngineContext } from './context'

export function fixesHandlers(
  ctx: EngineContext,
  checks: CheckEngine,
  service: FixesService = createFixesService({ host: ctx, checks })
): IpcHandlersFor<typeof fixesChannels> {
  return {
    'fixes:list': (request) =>
      guard('fixes:list', ctx, () =>
        runCheckChannel('fixes:list', () => service.list(parseFixList(request)))
      ),
    'fixes:listProject': (request) =>
      guard('fixes:listProject', ctx, () =>
        runCheckChannel('fixes:listProject', () =>
          service.listProject(parseProjectId(request, 'fixes:listProject'))
        )
      ),
    'fixes:preview': (request) =>
      guard('fixes:preview', ctx, () =>
        runCheckChannel('fixes:preview', () => service.preview(parseFixPreview(request)))
      ),
    'fixes:create': (request) =>
      guard('fixes:create', ctx, () =>
        runCheckChannel('fixes:create', () => service.create(parseCreateFix(request)))
      ),
    'fixes:runFollowUp': (request) =>
      guard('fixes:runFollowUp', ctx, () =>
        runCheckChannel('fixes:runFollowUp', () =>
          service.runFollowUp(parseFixId(request, 'fixes:runFollowUp'))
        )
      ),
    'fixes:delete': (request) =>
      guard('fixes:delete', ctx, () =>
        runCheckChannel('fixes:delete', () => service.remove(parseFixId(request, 'fixes:delete')))
      ),
    'fixes:update': (request) =>
      guard('fixes:update', ctx, () =>
        runCheckChannel('fixes:update', () => service.update(parseUpdateFix(request)))
      ),
    'fixes:restore': (request) =>
      guard('fixes:restore', ctx, () =>
        runCheckChannel('fixes:restore', () =>
          service.restore(parseFixId(request, 'fixes:restore'))
        )
      )
  }
}
