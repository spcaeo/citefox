/** Brand sentiment: brand prompts, brand facts, claims, and re-reading saved overviews (SRS 4.16). */

import type { BrandFact, BrandPromptKind, BrandPromptSet, SentimentView } from '../domain'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'

/** `sentiment:get`. Null `marketId` is the page's default market (FR-9.8). */
export interface SentimentRequest {
  projectId: string
  pageId: string
  marketId: string | null
}

/** `sentiment:generateBrandPrompts`. Writes one set per market language and saves it as the next version. */
export interface GenerateBrandPromptsRequest {
  projectId: string
  pageId: string
}

/** One brand prompt as the user edits it. The text must name the brand (FR-16.1). */
export interface BrandPromptDraft {
  kind: BrandPromptKind
  language: string
  text: string
}

/** `sentiment:saveBrandPrompts`. Saves the next version. Past checks keep the prompts they used. */
export interface SaveBrandPromptsRequest {
  projectId: string
  pageId: string
  prompts: readonly BrandPromptDraft[]
}

/** `sentiment:addFact`. Changes apply from the next check or re-read (FR-16.6). */
export interface AddBrandFactRequest {
  projectId: string
  text: string
  source: string | null
}

export interface DeleteBrandFactRequest {
  projectId: string
  factId: string
}

export interface BrandFactsRequest {
  projectId: string
}

/**
 * `sentiment:reread`. Claude reads the saved overviews of the page's latest full
 * check in every market again, with no new searches (FR-16.6). An unchanged
 * overview with unchanged facts reuses the stored reading and costs nothing.
 */
export interface RereadSentimentRequest {
  projectId: string
  pageId: string
}

/** The re-read runs in the background. `sentiment:updated` fires when it ends. */
export interface RereadSentimentResult {
  started: boolean
  /** Saved overviews the re-read covers. */
  overviews: number
  message: string
}

/** Pushed when claims for a page changed: after a check's reading or a re-read. */
export interface SentimentUpdated {
  projectId: string
  pageId: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const sentimentChannels = {
  'sentiment:get': invokeWith<SentimentRequest, SentimentView>(),
  'sentiment:generateBrandPrompts': invokeWith<GenerateBrandPromptsRequest, BrandPromptSet>(),
  'sentiment:saveBrandPrompts': invokeWith<SaveBrandPromptsRequest, BrandPromptSet>(),
  'sentiment:listFacts': invokeWith<BrandFactsRequest, readonly BrandFact[]>(),
  'sentiment:addFact': invokeWith<AddBrandFactRequest, readonly BrandFact[]>(),
  'sentiment:deleteFact': invokeWith<DeleteBrandFactRequest, readonly BrandFact[]>(),
  'sentiment:reread': invokeWith<RereadSentimentRequest, RereadSentimentResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const sentimentEvents = {
  'sentiment:updated': push<SentimentUpdated>()
} as const satisfies PushChannelSpecs
