import type { BrandFact, BrandPromptSet, SentimentView } from '@shared/domain'
import type {
  AddBrandFactRequest,
  BrandFactsRequest,
  DeleteBrandFactRequest,
  GenerateBrandPromptsRequest,
  RereadSentimentRequest,
  RereadSentimentResult,
  SaveBrandPromptsRequest,
  SentimentRequest,
  SentimentUpdated
} from '@shared/ipc'

/**
 * The sentiment channels the tab uses (SRS 4.16). Production uses the preload
 * allow-list; tests pass another `SentimentSource`.
 */
export interface SentimentSource {
  'sentiment:get'(request: SentimentRequest): Promise<SentimentView>
  'sentiment:generateBrandPrompts'(request: GenerateBrandPromptsRequest): Promise<BrandPromptSet>
  'sentiment:saveBrandPrompts'(request: SaveBrandPromptsRequest): Promise<BrandPromptSet>
  'sentiment:listFacts'(request: BrandFactsRequest): Promise<readonly BrandFact[]>
  'sentiment:addFact'(request: AddBrandFactRequest): Promise<readonly BrandFact[]>
  'sentiment:deleteFact'(request: DeleteBrandFactRequest): Promise<readonly BrandFact[]>
  'sentiment:reread'(request: RereadSentimentRequest): Promise<RereadSentimentResult>
  /** Subscribes to `sentiment:updated`. Returns the unsubscribe. */
  'sentiment:updated'(listener: (payload: SentimentUpdated) => void): () => void
}

export function createSentimentSource(): SentimentSource {
  return {
    'sentiment:get': (request) => requireApi()['sentiment:get'](request),
    'sentiment:generateBrandPrompts': (request) =>
      requireApi()['sentiment:generateBrandPrompts'](request),
    'sentiment:saveBrandPrompts': (request) => requireApi()['sentiment:saveBrandPrompts'](request),
    'sentiment:listFacts': (request) => requireApi()['sentiment:listFacts'](request),
    'sentiment:addFact': (request) => requireApi()['sentiment:addFact'](request),
    'sentiment:deleteFact': (request) => requireApi()['sentiment:deleteFact'](request),
    'sentiment:reread': (request) => requireApi()['sentiment:reread'](request),
    'sentiment:updated': (listener) => {
      if (typeof window === 'undefined' || !window.citefox) return () => undefined
      return window.citefox['sentiment:updated'](listener)
    }
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
