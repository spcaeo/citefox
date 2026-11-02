import type { IpcHandlerMap } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { holdFirstCheck } from './first-check'
import type { SetupRunner } from './runner'

/** Channels that track pages in bulk: the runner looks for work at once. */
const BULK_TRACK = ['allpages:run', 'import:track', 'structure:trackCluster'] as const

/**
 * Owner feedback 5: every new page sets itself up. Tracking one page from All
 * pages is a single add (its first check waits for the user, setup starts now);
 * bulk tracking wakes the runner instead of waiting for its next tick.
 */
export function withSetupKicks(
  handlers: IpcHandlerMap,
  runner: Pick<SetupRunner, 'startPage' | 'nudge'>,
  host: EngineHost
): IpcHandlerMap {
  const next: Record<string, unknown> = { ...handlers }
  for (const channel of BULK_TRACK) {
    const inner = handlers[channel] as (request: unknown) => Promise<unknown>
    next[channel] = async (request: unknown) => {
      const result = await inner(request)
      runner.nudge()
      return result
    }
  }
  const trackUrl = handlers['allpages:trackUrl']
  const wrapped: IpcHandlerMap['allpages:trackUrl'] = async (request) => {
    const result = await trackUrl(request)
    if (result.previousStatus === null || result.previousStatus === 'not_tracked') {
      const projectId = request.projectId
      holdFirstCheck(host, projectId, result.pageId)
      try {
        runner.startPage(projectId, result.pageId, { auto: true })
      } catch (error) {
        host.logger.warn('could not start page setup', {
          message: error instanceof Error ? error.message : 'failed'
        })
      }
    }
    return result
  }
  next['allpages:trackUrl'] = wrapped
  return next as IpcHandlerMap
}
