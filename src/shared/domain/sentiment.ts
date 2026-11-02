/**
 * Brand sentiment (SRS section 4.16, REPORT-SPEC section 5).
 *
 * A claim is one statement about one brand in an AI Overview. Claude reads each
 * overview (brand prompts and buyer prompts) with `sentiment_claims.md`. Brand
 * prompts name the brand on purpose. They feed sentiment only and are never
 * counted in visibility (FR-16.1).
 */

import type { CitationClass, CitationSourceType } from './checks'
import { isOneOf } from './one-of'

/** FR-16.1 and `brand_prompts.md`: reviews, pricing, alternatives, comparisons, use cases. */
export const BRAND_PROMPT_KINDS = [
  'review',
  'pricing',
  'alternatives',
  'comparison',
  'use_case'
] as const

export type BrandPromptKind = (typeof BRAND_PROMPT_KINDS)[number]

/** FR-16.1. Each page gets this many brand prompts by default. */
export const DEFAULT_BRAND_PROMPT_COUNT = 5

/** Most brand prompts per language on one page. */
export const MAX_BRAND_PROMPTS = 10

/** A brand prompt is 3 to this many characters. */
export const BRAND_PROMPT_MAX_LENGTH = 300

/** FR-16.3. Below this many claims the net sentiment is "Not enough data". */
export const SENTIMENT_MIN_CLAIMS = 5

/** FR-16.7. A brand × theme cell with fewer claims stays empty. */
export const SENTIMENT_CELL_MIN_CLAIMS = 2

/** FR-16.2. Positive, neutral (a plain fact, no judgment), or negative. */
export const CLAIM_TONES = ['positive', 'neutral', 'negative'] as const

export type ClaimTone = (typeof CLAIM_TONES)[number]

/** FR-16.6. A brand fact is a short true statement. */
export const BRAND_FACT_MAX_LENGTH = 300

/** Most brand facts one project keeps. */
export const MAX_BRAND_FACTS = 100

/** Which prompt an overview answered. Brand prompts name the brand; buyer prompts do not. */
export type SentimentSource = 'brand' | 'buyer'

/** Whether Claude has read an overview yet. */
export type OverviewReadState = 'read' | 'pending' | 'failed'

/**
 * Where a claim's nearest cited source sits: this page, another own page, a
 * tracked competitor, or the observed source type. Null when the claim has no source.
 */
export type ClaimSourceKind = 'this_page' | 'own' | 'competitor' | CitationSourceType

/** One brand prompt. `language` is the market language it is searched in. */
export interface BrandPrompt {
  id: string
  position: number
  kind: BrandPromptKind
  language: string
  text: string
}

/**
 * FR-16.1. The searches brand prompts add to one check of this page:
 * `prompts` matched to each market's language, 1 sample, 1 to 2 searches each.
 */
export interface BrandSearchEstimate {
  prompts: number
  markets: number
  minSearches: number
  maxSearches: number
}

/**
 * A page's current brand prompts. Saving an edit creates the next version.
 * `languages` is every language among the page's markets. `missingLanguages`
 * have no brand prompts yet, so markets in them skip brand prompts.
 */
export interface BrandPromptSet {
  pageId: string
  /** Null before the first save. */
  version: number | null
  /** ISO-8601 UTC. Null before the first save. */
  savedAt: string | null
  /** Lowercase SHA-256 of the template body that wrote the set. Null when typed by the user. */
  templateHash: string | null
  prompts: readonly BrandPrompt[]
  languages: readonly string[]
  missingLanguages: readonly string[]
  estimate: BrandSearchEstimate
}

/** FR-16.6. Project-level. Checked against every claim from the next read. */
export interface BrandFact {
  id: string
  text: string
  /** Where the fact comes from, such as a URL. Null when the user typed it. */
  source: string | null
  /** ISO-8601 UTC. */
  addedAt: string
}

/**
 * FR-16.5. Why a claim is wrong. `basis` is `fact` when it contradicts a brand
 * fact and `page` when it contradicts the own page. Without facts only `page` occurs.
 */
export interface FactProblem {
  basis: 'fact' | 'page'
  why: string
  correction: string
  /** URL to fix: the cited source, or the own page. Null when unknown. */
  sourceToFix: string | null
}

/** One cited reference of an overview, as the classifier stored it. */
export interface SentimentReference {
  position: number
  url: string
  domain: string
  title: string | null
  classification: CitationClass
  sourceType: CitationSourceType
}

/**
 * One AI Overview in a check, from a brand prompt or a buyer prompt.
 * `brandsNamed` are brand keys in rank order (rank 1 first): the own brand's
 * display name or a configured competitor.
 */
export interface SentimentOverview {
  /** The capture id. Brand and buyer captures never share an id. */
  id: string
  source: SentimentSource
  runId: string
  marketId: string
  promptId: string
  /** Brand prompt kind, or the buyer prompt label. */
  promptLabel: string
  promptText: string
  /** ISO-8601 UTC of the run. */
  checkedAt: string
  readState: OverviewReadState
  brandsNamed: readonly string[]
  /** One written reason for the brand's place in this answer. Null until read. */
  reason: string | null
  references: readonly SentimentReference[]
}

/** FR-16.2. One claim about one brand. */
export interface SentimentClaim {
  id: string
  overviewId: string
  runId: string
  marketId: string
  source: SentimentSource
  promptId: string
  /** Brand key: the own brand's display name or a configured competitor. */
  brand: string
  isOwn: boolean
  /** Named in English (FR-16.8). */
  theme: string
  attribute: string
  tone: ClaimTone
  /** Word for word, in the overview's language. */
  sentence: string
  /** Nearest cited URL. Null when no cited source sits next to the sentence. */
  url: string | null
  sourceKind: ClaimSourceKind | null
  factProblem: FactProblem | null
}

/** Own-brand claim counts for one full check (FR-16.4). */
export interface SentimentCheckPoint {
  runId: string
  /** ISO-8601 UTC. */
  checkedAt: string
  overviews: number
  overviewsRead: number
  positive: number
  neutral: number
  negative: number
}

/** Overviews still waiting for Claude, or that failed, in the latest check. */
export interface SentimentReading {
  pending: number
  failed: number
  /** True while a re-read of this page runs. */
  running: boolean
}

/**
 * Everything the Sentiment tab draws for one page and market.
 * `overviews` and `claims` are the latest full check. `trend` is every full
 * check in time order. Partial (follow-up) checks are never included (section 7.4).
 */
export interface SentimentView {
  projectId: string
  pageId: string
  marketId: string
  /** The own brand's display name: the first brand name. Null when none is stored. */
  brand: string | null
  competitors: readonly string[]
  brandPrompts: BrandPromptSet
  facts: readonly BrandFact[]
  latestRunId: string | null
  overviews: readonly SentimentOverview[]
  claims: readonly SentimentClaim[]
  trend: readonly SentimentCheckPoint[]
  /**
   * Own-brand claims of the earlier full checks in `trend` (every source), so
   * each trend point drills to exactly the claims it counts (NFR-14).
   * The latest check's claims are in `claims`.
   */
  earlierClaims: readonly SentimentClaim[]
  /** The overviews `earlierClaims` come from. */
  earlierOverviews: readonly SentimentOverview[]
  reading: SentimentReading
}

export function isBrandPromptKind(value: string): value is BrandPromptKind {
  return isOneOf(BRAND_PROMPT_KINDS, value)
}

export function isClaimTone(value: string): value is ClaimTone {
  return isOneOf(CLAIM_TONES, value)
}
