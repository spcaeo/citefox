import type { CiteFoxApi } from '@shared/ipc'
import type { ClientMode } from '../../onboarding/flags'

/** The `topics:*` channels the Add wizard calls (src/shared/ipc/topics.ts). */
export const WIZARD_CHANNELS = [
  'topics:describeStep',
  'topics:suggestedStart',
  'topics:listDrafts',
  'topics:createDraft',
  'topics:getDraft',
  'topics:updateDraft',
  'topics:discardDraft',
  'topics:discoverSeed',
  'topics:writeProfile',
  'topics:discoverProfileSection',
  'topics:rewriteSection',
  'topics:generateQuestions',
  'topics:discoverStageQuestions',
  'topics:findJourneyGaps',
  'topics:rewriteQuestion',
  'topics:discoverTerms',
  'topics:generateKeywords',
  'topics:suggestMissingGroups',
  'topics:mergeNearDuplicates',
  'topics:keywordSummary',
  'topics:readCsvColumns',
  'topics:importQuestions',
  'topics:cleanupWithClaude',
  'topics:readCompetitorPage',
  'topics:competitorQuestions',
  'topics:pageCandidates',
  'topics:matchPages',
  'topics:setTarget',
  'topics:draftPageBrief',
  'topics:estimate',
  'topics:start'
] as const

export type WizardChannel = (typeof WIZARD_CHANNELS)[number]

/**
 * The wizard's data adapter: exactly the IPC channels' signatures, so the live
 * client is the preload bridge itself. The mock (dev and e2e builds only)
 * answers from the TextBolt fixture and keeps drafts in localStorage.
 */
export type TopicsClient = Pick<CiteFoxApi, WizardChannel> & {
  /** Long Claude steps push progress; absent in tests. */
  onProgress?: CiteFoxApi['topics:progress']
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** A client whose channels resolve on first call (keeps a lazy chunk out of the main bundle). */
function lazy(load: () => Promise<Pick<CiteFoxApi, WizardChannel>>): TopicsClient {
  let loaded: Promise<Pick<CiteFoxApi, WizardChannel>> | null = null
  const entries = WIZARD_CHANNELS.map((channel) => [
    channel,
    async (request: unknown) => {
      loaded ??= load()
      const client = await loaded
      return (client[channel] as (value: unknown) => Promise<unknown>)(request)
    }
  ])
  return Object.fromEntries(entries) as unknown as TopicsClient
}

function ipcClient(): TopicsClient {
  const entries = WIZARD_CHANNELS.map((channel) => [
    channel,
    // Async so a missing bridge rejects the promise instead of throwing during render.
    async (request: unknown) =>
      (requireApi()[channel] as (value: unknown) => Promise<unknown>)(request)
  ])
  const client = Object.fromEntries(entries) as unknown as TopicsClient
  client.onProgress = (listener) => {
    if (typeof window === 'undefined' || !window.citefox) return () => undefined
    return window.citefox['topics:progress'](listener)
  }
  return client
}

export function createTopicsClient(mode: ClientMode): TopicsClient {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return lazy(() => import('./mock/mockTopics').then((module) => module.createMockTopicsClient()))
  }
  return ipcClient()
}
