import type { CiteFoxApi } from '@shared/ipc'
import type { ClientMode } from '../../../onboarding/flags'
import type { TopicResultsSource } from './types'

export type { TopicResultsSource } from './types'

function api(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** The live `topics` channels. Async so a missing bridge rejects instead of throwing in render. */
export function createIpcTopicResultsSource(): TopicResultsSource {
  return {
    results: async (request) => api()['topics:results'](request),
    list: async (projectId) => (await api()['topics:list']({ projectId })).topics,
    pageCandidates: async (projectId) => api()['topics:pageCandidates']({ projectId }),
    targetSuggestions: async (request) => api()['topics:targetSuggestions'](request),
    suggestTarget: async (request) => api()['topics:suggestTarget'](request),
    matchTracked: async (request) => api()['topics:matchTracked'](request),
    setTarget: async (request) => api()['topics:setTarget'](request),
    readSitemap: async (projectId) => api()['sitemaps:discover']({ projectId, url: null }),
    whyNotCited: async (request) => api()['topics:whyNotCited'](request),
    draftFix: async (request) => api()['topics:draftFix'](request),
    explainCitation: async (request) => api()['topics:explainCitation'](request),
    topicSummary: async (request) => api()['topics:topicSummary'](request),
    describeStep: async (request) => api()['topics:describeStep'](request),
    update: async (request) => api()['topics:update'](request),
    engineSummary: async (request) => api()['engines:summary'](request),
    onCheckProgress: (listener) => api()['checks:progress'](listener)
  }
}

/** The mock loads on first use, so it stays out of the release bundle. */
function createLazyMockSource(): TopicResultsSource {
  let made: Promise<TopicResultsSource> | null = null
  const source = (): Promise<TopicResultsSource> => {
    made ??= import('./mock').then((module) => module.createMockTopicResultsSource())
    return made
  }
  return {
    results: async (request) => (await source()).results(request),
    list: async (projectId) => (await source()).list(projectId),
    pageCandidates: async (projectId) => (await source()).pageCandidates(projectId),
    targetSuggestions: async (request) => (await source()).targetSuggestions(request),
    suggestTarget: async (request) => (await source()).suggestTarget(request),
    setTarget: async (request) => (await source()).setTarget(request),
    whyNotCited: async (request) => (await source()).whyNotCited(request),
    draftFix: async (request) => (await source()).draftFix(request),
    explainCitation: async (request) => (await source()).explainCitation(request),
    topicSummary: async (request) => (await source()).topicSummary(request),
    describeStep: async (request) => (await source()).describeStep(request),
    update: async (request) => (await source()).update(request)
  }
}

let shared: { mode: ClientMode; source: TopicResultsSource } | null = null

/** The source for this window: the IPC channels, or the in-memory mock in a mock build. */
export function topicResultsSource(mode: ClientMode): TopicResultsSource {
  if (shared?.mode === mode) return shared.source
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  const source =
    mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')
      ? createLazyMockSource()
      : createIpcTopicResultsSource()
  shared = { mode, source }
  return source
}
