/** Topics and keywords & groups (Docs/TOPICS-SPEC.md sections 2–6). */

import type { IpcHandlersFor, topicsChannels } from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import { createTopicsService, type TopicChannel, type TopicsService } from '../topics/service'
import { guard, type EngineContext } from './context'

export function topicsHandlers(
  ctx: EngineContext,
  checks: CheckEngine | null,
  service: TopicsService = createTopicsService(ctx, checks)
): IpcHandlersFor<typeof topicsChannels> {
  const handlers: Partial<Record<TopicChannel, (request: unknown) => Promise<unknown>>> = {}
  for (const channel of Object.keys(service) as TopicChannel[]) {
    const run = service[channel] as (request: unknown) => Promise<unknown>
    handlers[channel] = (request: unknown) => guard(channel, ctx, () => run(request))
  }
  return handlers as IpcHandlersFor<typeof topicsChannels>
}
