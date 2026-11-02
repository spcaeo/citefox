/** Topics and clusters: moving questions, tidying topics, Claude suggestions (Docs/TOPICS-SPEC.md §8). */

import type { IpcHandlersFor, topicClustersChannels } from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import {
  createTopicClustersService,
  type TopicClusterChannel,
  type TopicClustersService
} from '../topics/clusters/service'
import { guard, type EngineContext } from './context'

export function topicClustersHandlers(
  ctx: EngineContext,
  checks: CheckEngine | null,
  service: TopicClustersService = createTopicClustersService(ctx, checks)
): IpcHandlersFor<typeof topicClustersChannels> {
  const handlers: Partial<Record<TopicClusterChannel, (request: unknown) => Promise<unknown>>> = {}
  for (const channel of Object.keys(service) as TopicClusterChannel[]) {
    const run = service[channel] as (request: unknown) => Promise<unknown>
    handlers[channel] = (request: unknown) => guard(channel, ctx, () => run(request))
  }
  return handlers as IpcHandlersFor<typeof topicClustersChannels>
}
