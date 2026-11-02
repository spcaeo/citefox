import type { GuideSignal } from '@shared/guide'
import type { IpcHandlerMap, IpcInvokeChannel } from '@shared/ipc'
import { withProject } from '../engine/project-db'
import type { EngineHost } from '../engine/host'
import { emitMainEvent } from '../ipc-events'
import { hasGuideSignal, recordGuideSignal } from '../storage/guide-progress'

/**
 * The saves the first-run guide teaches, wherever in the app they happen (a drawer,
 * a row menu, the guide itself): after the save succeeds, main records the signal in
 * the project and pushes `guide:changed`, so the step ticks even out of order.
 * `signalOf` returns null when this request is not the thing taught (a rename is
 * not a target page).
 */
const SIGNALS: Partial<
  Record<IpcInvokeChannel, (request: Record<string, unknown>) => GuideSignal | null>
> = {
  'topics:update': (request) =>
    typeof request.targetPage === 'string' && request.targetPage.trim() !== ''
      ? 'target-page-set'
      : null,
  'topics:setTarget': (request) =>
    typeof request.topicId === 'string' && request.target !== undefined ? 'target-page-set' : null,
  'competitors:save': () => 'competitor-saved',
  'checks:start': () => 'check-started',
  'fixes:create': () => 'fix-logged',
  'alerts:saveRule': () => 'alert-saved'
}

export function withGuideSignals(handlers: IpcHandlerMap, host: EngineHost): IpcHandlerMap {
  const next: Record<string, unknown> = { ...handlers }
  for (const [channel, signalOf] of Object.entries(SIGNALS)) {
    if (!signalOf) continue
    const inner = handlers[channel as IpcInvokeChannel] as (request: unknown) => Promise<unknown>
    next[channel] = async (request: unknown) => {
      const result = await inner(request)
      const record = typeof request === 'object' && request !== null ? request : {}
      const projectId = (record as { projectId?: unknown }).projectId
      const signal = signalOf(record as Record<string, unknown>)
      if (signal !== null && typeof projectId === 'string') {
        await noteSignal(host, projectId, signal)
      }
      return result
    }
  }
  return next as IpcHandlerMap
}

/** Records a signal; a failure is logged and never fails the save it follows. */
async function noteSignal(host: EngineHost, projectId: string, signal: GuideSignal): Promise<void> {
  try {
    const progress = await withProject(host, projectId, 'guide:signal', ({ db }) =>
      hasGuideSignal(db, signal)
        ? null
        : recordGuideSignal(db, projectId, signal, host.now().toISOString())
    )
    if (progress !== null) emitMainEvent('guide:changed', progress)
  } catch (error) {
    host.logger.warn('could not record a guide step', {
      message: error instanceof Error ? error.message : 'failed'
    })
  }
}
