import type { GuideProgress } from '@shared/guide'
import type { GuideSignalRequest, GuideUpdateRequest } from '@shared/ipc'
import type { GuideFacts } from './types'
import { factsFrom, focusTopic } from './utils/facts'

/** The guide's calls. Tests pass a fake. */
export interface GuideClient {
  get(projectId: string): Promise<GuideProgress>
  update(request: GuideUpdateRequest): Promise<GuideProgress>
  signal(request: GuideSignalRequest): Promise<GuideProgress>
  restart(projectId: string): Promise<GuideProgress>
  /** What the project's data says, from saved results only (no search runs). */
  facts(projectId: string): Promise<GuideFacts>
  onChanged(listener: (progress: GuideProgress) => void): () => void
}

function api(): NonNullable<Window['citefox']> {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** The live client over the preload bridge. */
export function createIpcGuideClient(): GuideClient {
  return {
    get: (projectId) => Promise.resolve().then(() => api()['guide:get']({ projectId })),
    update: (request) => Promise.resolve().then(() => api()['guide:update'](request)),
    signal: (request) => Promise.resolve().then(() => api()['guide:signal'](request)),
    restart: (projectId) => Promise.resolve().then(() => api()['guide:restart']({ projectId })),
    facts: async (projectId) => {
      const bridge = api()
      const [journey, list, saved, searches, logged] = await Promise.all([
        bridge['start:status']({ projectId }).catch(() => null),
        bridge['topics:list']({ projectId }).catch(() => ({ topics: [] })),
        bridge['competitors:list']({ projectId }).catch(() => ({ competitors: [] })),
        bridge['fixes:searches']({ projectId }).catch(() => null),
        bridge['fixes:listProject']({ projectId }).catch(() => ({ fixes: [] }))
      ])
      const topic = focusTopic(list.topics, journey?.topicId ?? null)
      const results = topic
        ? await bridge['topics:results']({
            projectId,
            topicId: topic.id,
            marketId: null,
            runId: null
          }).catch(() => null)
        : null
      return factsFrom({
        journey,
        topics: list.topics,
        results,
        competitors: saved.competitors,
        searches,
        fixes: logged.fixes
      })
    },
    onChanged: (listener) => {
      if (typeof window === 'undefined' || !window.citefox) return () => undefined
      return window.citefox['guide:changed'](listener)
    }
  }
}

let shared: GuideClient | null = null

/** One live client for the window. */
export function guideClient(): GuideClient {
  shared ??= createIpcGuideClient()
  return shared
}
