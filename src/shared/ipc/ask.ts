/**
 * Ask CiteFox (FR-25.7). A question becomes structured filters over the results
 * CiteFox already stored. Claude only proposes the filters (validated against a
 * schema); a deterministic local query runs them and writes the answer. No
 * SerpApi search is ever made. Editing a chip re-runs the query without Claude.
 */

import type { IntentStage, PromptCheckStatus, PromptMovement } from '../domain'
import type { AssistLabel } from './assist'
import { invokeWith, type InvokeChannelSpecs } from './contract'

/** Most characters in one question. */
export const ASK_QUESTION_MAX = 500

/** Most rows one answer returns. `total` still counts every match. */
export const ASK_ROW_LIMIT = 200

/** Null on a field means "any". Empty arrays are read as null. */
export interface AskFilters {
  pageIds: readonly string[] | null
  marketIds: readonly string[] | null
  statuses: readonly PromptCheckStatus[] | null
  movements: readonly PromptMovement[] | null
  intentStages: readonly IntentStage[] | null
  /** A domain the AI Overview cited, such as a competitor. Lowercase, no scheme. */
  citedDomain: string | null
  /** Words the prompt text contains, case-insensitive. */
  text: string | null
}

export const EMPTY_ASK_FILTERS: AskFilters = {
  pageIds: null,
  marketIds: null,
  statuses: null,
  movements: null,
  intentStages: null,
  citedDomain: null,
  text: null
}

/** One editable chip: the filter field, one of its values, and the words shown. */
export interface AskChip {
  field: keyof AskFilters
  value: string
  label: string
}

/** One prompt in one market, from that page's latest finished check there. */
export interface AskRow {
  pageId: string
  pageLabel: string
  /** Null for a topic, which has no single URL. */
  pageUrl: string | null
  /** `topic` when the row is a topic's question or keyword. */
  pageKind?: 'page' | 'topic'
  marketId: string
  marketLabel: string
  promptId: string
  promptText: string
  intentStage: IntentStage
  status: PromptCheckStatus
  /** Citation position of the page, when cited. */
  position: number | null
  movement: PromptMovement | null
  /** Domains the overview cited, in order. */
  citedDomains: readonly string[]
  /** ISO-8601 UTC. */
  checkedAt: string | null
}

export interface AskAnswer {
  /** The question as asked. Null when chips were edited by hand. */
  question: string | null
  filters: AskFilters
  chips: readonly AskChip[]
  /** Plain-words answer built from the matched rows. */
  answer: string
  rows: readonly AskRow[]
  /** Every match, including rows past {@link ASK_ROW_LIMIT}. */
  total: number
  /** Prompt checks the filters ran over (the denominator). */
  searched: number
  /** Newest check among the rows searched. Null when nothing is stored. */
  checkedThrough: string | null
  /** Always true: Ask CiteFox never runs a search. */
  savedDataOnly: true
  /** The Claude label for a question. Null when chips were edited (no Claude call). */
  label: AssistLabel | null
  /** Part of the question the filters could not express, in Claude's words. */
  notCovered: string | null
}

export interface AskQuestionRequest {
  projectId: string
  question: string
}

export interface AskFilterRequest {
  projectId: string
  filters: AskFilters
}

export interface AskOption {
  id: string
  label: string
  /** Pages only: `topic` for a topic (label it "Topic:"), else `page`. Markets leave it out. */
  kind?: 'page' | 'topic'
}

/** Choices for the chip editor. */
export interface AskOptions {
  pages: readonly AskOption[]
  markets: readonly AskOption[]
  /** Domains cited in stored overviews, most cited first, at most 30. */
  domains: readonly string[]
}

export interface AskProjectRequest {
  projectId: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const askChannels = {
  'ask:question': invokeWith<AskQuestionRequest, AskAnswer>(),
  'ask:filter': invokeWith<AskFilterRequest, AskAnswer>(),
  'ask:options': invokeWith<AskProjectRequest, AskOptions>()
} as const satisfies InvokeChannelSpecs
