import type { TopicWizardPath, WorkProgressState } from '../../domain'
import type { AssistLabel } from '../assist'

// ---------------------------------------------------------------------------
// Shared request pieces
// ---------------------------------------------------------------------------

export interface TopicProjectRequest {
  projectId: string
}

export interface TopicDraftRequest {
  projectId: string
  draftId: string
}

export interface TopicIdRequest {
  projectId: string
  topicId: string
}

/** Claude steps of this area, one per shipped template (section 6) plus assists. */
export const TOPIC_STEPS = [
  'suggested_start',
  'seed_discover',
  'buyer_profile',
  'profile_discover',
  'journey_questions',
  'questions_discover',
  'journey_gaps',
  'question_rewrite',
  'keyword_terms',
  'keyword_expand',
  'keyword_groups',
  'questions_cleanup',
  'competitor_questions',
  'page_match',
  'page_brief',
  'why_not_cited',
  'draft_fix',
  'topic_summary',
  'explain_citation',
  'target_suggest'
] as const
export type TopicStep = (typeof TOPIC_STEPS)[number]

/** What an AI action shows before it runs ("Claude · about 15 s · Uses your site, no searches"). */
export interface TopicStepDescription {
  step: TopicStep
  label: AssistLabel
  /** "Uses your site, no searches" or "No new searches". */
  reads: string
  /** Always 0: no step here spends a search. */
  searchCost: 0
}

export interface TopicDescribeStepRequest {
  projectId: string
  step: TopicStep
}

/** Pushed while a long Claude step runs (several calls, or a site read first). */
export interface TopicProgress {
  projectId: string
  /** The draft or topic the step works on. */
  draftId: string | null
  topicId: string | null
  step: TopicStep
  state: WorkProgressState
  /** Calls or pages done and planned in this step. */
  done: number
  total: number
  /** e.g. "Reading example.com/pricing", "Writing Compare questions". */
  detail: string
}

/** Every Claude reply that the user may act on carries what it cost. */
export interface TopicCallInfo {
  label: AssistLabel
  durationMs: number
  model: string | null
  /** Always 0. */
  searchesUsed: 0
  /**
   * A plain line for the owner when the step did not run as saved: the project's own
   * version failed the step's current reply shape and the built-in one ran instead.
   */
  notice?: string
}

// ---------------------------------------------------------------------------
// Start screen ("What do you want to track?")
// ---------------------------------------------------------------------------

export interface TopicSuggestedStart {
  seed: string
  /**
   * The saved product the seed is about (Docs/PROMPT-AUDIT.md P2); the topic started
   * from it picks this product. Null: the whole business. Absent on older replies.
   */
  productId?: string | null
  /** "3 of your pages already cover parts of it" style facts, from saved data. */
  facts: readonly { value: string; text: string }[]
  /** "Why this?" in plain words. */
  why: string
  path: TopicWizardPath
  info: TopicCallInfo
}

export interface TopicSuggestedStartResult {
  /** Null when the project has no saved data to suggest from yet. */
  suggestion: TopicSuggestedStart | null
  message: string | null
}
