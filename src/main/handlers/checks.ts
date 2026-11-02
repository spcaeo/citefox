/** Check jobs, results, and scores. The check engine is shared with the scheduler. */

import type { checksChannels, IpcHandlersFor, resultsChannels } from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import {
  parseActiveJobs,
  parseCheckJobId,
  parseGetPrompt,
  parseGetResults,
  parseNotCited,
  parseResultsHistory,
  parseScoreProject,
  parseStartCheck
} from '../engine/checks/parse'
import { guard, runCheckChannel, type EngineContext } from './context'

export function checksHandlers(
  ctx: EngineContext,
  checks: CheckEngine,
  /** A check is starting for these pages: a first check that waited for the user is released. */
  onStart?: (projectId: string, pageIds: readonly string[]) => void
): IpcHandlersFor<typeof checksChannels> & IpcHandlersFor<typeof resultsChannels> {
  return {
    'checks:start': (request) =>
      guard('checks:start', ctx, () =>
        runCheckChannel('checks:start', () => {
          const parsed = parseStartCheck(request)
          onStart?.(parsed.projectId, parsed.pageIds)
          return checks.start(parsed)
        })
      ),
    'checks:cancel': (request) =>
      guard('checks:cancel', ctx, () =>
        runCheckChannel('checks:cancel', () =>
          checks.cancel(parseCheckJobId(request, 'checks:cancel').jobId)
        )
      ),
    'checks:get': (request) =>
      guard('checks:get', ctx, () =>
        runCheckChannel('checks:get', () => checks.get(parseCheckJobId(request).jobId))
      ),
    'checks:listActive': (request) =>
      guard('checks:listActive', ctx, () =>
        runCheckChannel('checks:listActive', () =>
          checks.listActive(parseActiveJobs(request).projectId)
        )
      ),
    'checks:getPrompt': (request) =>
      guard('checks:getPrompt', ctx, () =>
        runCheckChannel('checks:getPrompt', () => checks.getPrompt(parseGetPrompt(request)))
      ),
    'checks:notCited': (request) =>
      guard('checks:notCited', ctx, () =>
        runCheckChannel('checks:notCited', () => checks.notCited(parseNotCited(request)))
      ),
    'results:get': (request) =>
      guard('results:get', ctx, () =>
        runCheckChannel('results:get', () => checks.results(parseGetResults(request)))
      ),
    'results:history': (request) =>
      guard('results:history', ctx, () =>
        runCheckChannel('results:history', () => checks.history(parseResultsHistory(request)))
      ),
    'scores:listProjects': () =>
      guard('scores:listProjects', ctx, () =>
        runCheckChannel('scores:listProjects', () => checks.listProjectScores())
      ),
    'scores:listPages': (request) =>
      guard('scores:listPages', ctx, () =>
        runCheckChannel('scores:listPages', () =>
          checks.listPageScores(parseScoreProject(request).projectId)
        )
      )
  }
}
