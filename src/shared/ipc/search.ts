/**
 * The top bar search's question lookup. Pages come from `pages:search` and topics
 * from the sidebar's list; questions need their own call because the shell never
 * loads every prompt of the project.
 */

import type { PageKind } from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'

/** Questions one search returns at most; the box shows a short list, not a grid. */
export const QUESTION_SEARCH_LIMIT = 8

/**
 * `search:questions`. `query` is split on spaces and every word must appear in the
 * question's wording (any market), case-insensitive for ASCII letters. A blank query
 * returns no rows.
 */
export interface SearchQuestionsRequest {
  projectId: string
  query: string
}

/** One question: a prompt of a tracked page's or topic's active prompt set. */
export interface QuestionSearchHit {
  promptId: string
  /** The page or topic the question belongs to (the prompt route's `pageId`). */
  sourceId: string
  sourceKind: PageKind
  /** The page's label, title or path, or the topic's name. */
  sourceName: string
  /** The matching wording, the source's default market first. May hold `**` emphasis. */
  text: string
}

export interface SearchQuestionsResult {
  /** Best match first: the earliest match in the wording, then the shorter question. */
  questions: readonly QuestionSearchHit[]
  /** True when more questions match than `QUESTION_SEARCH_LIMIT`. */
  more: boolean
}

/** Invoke channels for this area. Each one is declared here only. */
export const searchChannels = {
  'search:questions': invokeWith<SearchQuestionsRequest, SearchQuestionsResult>()
} as const satisfies InvokeChannelSpecs
