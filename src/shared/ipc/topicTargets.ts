/**
 * Target page suggestions for a topic (`drawer=topic-page`). Two channels, both on
 * `topicsChannels`:
 *
 * - `topics:targetSuggestions` ranks the project's own pages by how the topic's
 *   questions and keywords already cite them in their latest checks (Google AI
 *   Overview and every answer engine). Reads saved checks only: free and instant.
 * - `topics:suggestTarget` asks CiteFox AI to pick the best target page from the
 *   project's pages, with a reason each, or to name a page worth writing. It spends
 *   no search; every page it returns is one of the candidates it was given.
 *
 * Neither changes the topic: the drawer saves a pick with `topics:update`.
 */

import type { EngineId } from '../domain'
import type { TopicCallInfo } from './topics'

export interface TopicTargetRequest {
  projectId: string
  topicId: string
  /** The market on screen; null reads the topic's default market. */
  marketId?: string | null
}

/** How often one engine cites the page for the topic. */
export interface TopicTargetEngineCount {
  engine: EngineId
  /** Topic questions and keywords whose latest check on this engine cites the page. */
  prompts: number
}

/** One page of the own site, ranked by how the topic's checks cite it. */
export interface TopicTargetSuggestion {
  /** The page on the own site (`https://`, no query or trailing slash), as `topics:update` saves it. */
  url: string
  title: string | null
  /** The tracked page's id; null when it is not tracked. */
  pageId: string | null
  /** Tracked, in the sitemap, or only known because an answer cites it. */
  source: 'tracked' | 'sitemap' | 'cited'
  /** Topic questions and keywords whose latest check cites it on any engine. */
  citedPrompts: number
  /** Engines that cite it, Google AI Overview first, then by count. Engines with none are left out. */
  engines: readonly TopicTargetEngineCount[]
  /** Its best (lowest) source position in those checks; null when no position was stored. */
  bestPosition: number | null
}

export interface TopicTargetSuggestions {
  topicId: string
  marketId: string | null
  /** Most cited first. Only pages cited at least once; empty before a check. */
  suggestions: readonly TopicTargetSuggestion[]
  /** Topic questions and keywords with a finished check: the "of 12" in "Cited for 5 of 12". */
  checkedPrompts: number
  /** Those whose latest check cites any own page. */
  citedPrompts: number
  /** `questions`, `keywords`, or `questions and keywords`: what the counts count. */
  noun: string
  /**
   * The clear winner (cited for at least half the prompts that cite the site at all,
   * and more often than any other page), with the line that says why. Null when none.
   * The drawer preselects it only while the topic has no target page.
   */
  pick: { url: string; note: string } | null
}

/** One page CiteFox AI picked, always one of the candidates it was given. */
export interface TopicTargetAiPick {
  url: string
  title: string | null
  /** One plain sentence. */
  reason: string
}

/** A page worth writing when none of the candidates fits. */
export interface TopicTargetNewPage {
  title: string
  /** A path on the own site, such as `/email-to-text-gateway-replacement`. */
  path: string
  /** What the page should be about, one sentence. */
  about: string
}

export interface SuggestTopicTargetResult {
  /** At most three, best first. */
  picks: readonly TopicTargetAiPick[]
  newPage: TopicTargetNewPage | null
  /** Pages CiteFox AI named that are not on the site's page list, left out. */
  dropped: number
  info: TopicCallInfo
}
