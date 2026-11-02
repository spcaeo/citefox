/** Buyer profiles and buyer prompts. */

import type {
  BuyerProfile,
  IntentStage,
  IntervalDays,
  Market,
  NamedReason,
  PageKind,
  PageStatus,
  PromptSetRef,
  PromptSetView,
  PromptSource,
  TopicPromptKind,
  TopicPromptSource,
  TopicStage
} from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { PageIdRequest } from './pages'
import type { ProjectIdRequest } from './projects'

/**
 * `buyerProfile:generate`.
 * `templateId` omitted uses the app-wide default `buyer_profile` template.
 * A soft-deleted id is rejected. Profiles already stored keep their id.
 */
export interface GenerateBuyerProfileRequest extends PageIdRequest {
  templateId?: string
  /**
   * True writes a new profile even when the page and template are unchanged
   * (Regenerate). Otherwise the stored profile comes back as it is.
   */
  fresh?: boolean
}

/**
 * `prompts:generate`.
 * `templateId` omitted uses the app-wide default `buyer_prompts` template.
 * A soft-deleted id is rejected. Prompt sets already stored keep their id.
 */
export interface GeneratePromptsRequest extends PageIdRequest {
  templateId?: string
}

/**
 * `prompts:listSets`.
 * Saved sets for the page, newest `createdAt` first.
 * `sets` is empty when the page has no saved set.
 */
export interface PromptSetList {
  pageId: string
  sets: readonly PromptSetRef[]
}

/**
 * `prompts:setActive`.
 * Makes this saved set the only active set for the page and returns that set.
 * It does not write a new version.
 */
export interface SetActivePromptSetRequest {
  projectId: string
  pageId: string
  promptSetId: string
}

/** Arguments for `buyerProfile:update`. Omitted fields stay as they are. Does not rewrite prompts. */
export interface UpdateBuyerProfileRequest {
  projectId: string
  pageId: string
  who?: string
  environment?: string
  segments?: readonly NamedReason[]
  triggers?: readonly string[]
  values?: readonly string[]
  poorFit?: readonly NamedReason[]
}

/** FR-3.9. Suggestions only. Adding one is `buyerProfile:update`. */
export interface TriggerSuggestion {
  text: string
  reason: string
}

export interface AddPromptRequest {
  projectId: string
  pageId: string
  label: string
  /** Wording for the page's default market. Other markets are copied until edited. Empty is allowed. */
  text: string
  source: PromptSource
  intentStage: IntentStage
  mappedElement: string
}

/** Arguments for `prompts:edit`. Omitted fields stay as they are. This does not save a version. */
export interface EditPromptRequest {
  projectId: string
  pageId: string
  promptId: string
  label?: string
  source?: PromptSource
  intentStage?: IntentStage
  mappedElement?: string
  /** Replaces one market's wording. Other markets stay. */
  variant?: {
    marketId: string
    text: string
  }
}

export interface PromptIdRequest {
  projectId: string
  pageId: string
  promptId: string
}

/** `prompts:setEnabled`. A disabled prompt stays in the set and is left out of the next check. */
export interface SetPromptEnabledRequest {
  projectId: string
  pageId: string
  promptId: string
  enabled: boolean
}

/** `prompts:reorder`. Ids in the new top-to-bottom order (FR-3.5). */
export interface ReorderPromptsRequest {
  projectId: string
  pageId: string
  promptIds: readonly string[]
}

/**
 * `prompts:reword` (prompt detail "Edit question"). Changes one prompt's wording in the
 * page's or topic's active set and saves it at once as a new prompt-set version, so the
 * results of the old wording stay with the old prompt id and never mix with the new one.
 * `allMarkets` false changes only `marketId`'s wording. The text is checked as the
 * Prompts tab checks it (length, no brand name). Refused while the Prompts tab holds
 * unsaved edits for the page, and for a prompt that is not in the active set.
 */
export interface RewordPromptRequest {
  projectId: string
  pageId: string
  promptId: string
  marketId: string
  text: string
  allMarkets: boolean
}

export interface RewordPromptResult {
  pageId: string
  /** The prompt in the new version. Unchanged wording keeps the old id and saves nothing. */
  promptId: string
  previousPromptId: string
  changed: boolean
  version: number
  savedAt: string
}

/** One saved version of a prompt. */
export interface PromptVersionStep {
  promptId: string
  promptSetVersion: number
  /** When that prompt-set version was saved. */
  savedAt: string
  /** The wording per market in that version. */
  texts: readonly { marketId: string; text: string }[]
}

/** The checks the editor runs before saving; the engine runs them again on save. */
export interface PromptTextRules {
  kind: 'buyer_prompt' | 'question' | 'keyword'
  /** 0 when there is no lower limit. */
  minWords: number
  maxWords: number
  /** Brand names and aliases a prompt must not contain. */
  brands: readonly string[]
}

/** `prompts:versions`: a prompt's earlier versions and what an edit is checked against. */
export interface PromptVersions {
  pageId: string
  promptId: string
  /** True when the prompt is in the active set, so it can be edited and re-checked. */
  active: boolean
  /** The same prompt in the active set when this one is an older version. Null when none. */
  currentPromptId: string | null
  /** This version first, then the versions it was carried from, newest first. */
  steps: readonly PromptVersionStep[]
  rules: PromptTextRules
}

/** One question for `prompts:addQuestions`. Omitted facts use the "written by you" defaults. */
export interface NewQuestion {
  /** The wording for every market on the page or topic. */
  text: string
  /** A suggestion's intent stage. `unset` when omitted. */
  intentStage?: IntentStage
  /** A suggestion's source. `written_by_user` when omitted. */
  source?: PromptSource
  /** The page element a suggestion maps to. Empty when omitted. */
  mappedElement?: string
  /**
   * A topic question's own facts (the importer sets them; `prompts:addQuestions`
   * does not accept them from the renderer). Omitted: a question with no stage
   * and no target page, written by the user or suggested by Claude.
   */
  topic?: NewTopicQuestionFacts
}

/** What a topic question keeps besides its wording. */
export interface NewTopicQuestionFacts {
  kind: TopicPromptKind
  stage: TopicStage | null
  origin: TopicPromptSource
  note: string | null
  targetPageId: string | null
  targetUrl: string | null
}

/**
 * `prompts:addQuestions` (+ Add → Questions). Appends questions to a page's or topic's
 * active set and saves it at once as a new prompt-set version, so they are live and
 * tracked from the next check (no Save step). Every earlier prompt is carried into the
 * new version with a lineage row, as `prompts:reword` does, and a topic's questions keep
 * their topic facts. Each text is checked as the Prompts tab (page) or the topic rules
 * (topic) check it. A text equal to a saved question or to an earlier one in the request,
 * with case, punctuation and spaces ignored, is skipped and listed in `skipped`.
 * Refused for a page that is not tracked, while the Prompts tab holds unsaved edits for
 * the page, and when nothing new is left.
 */
export interface AddQuestionsRequest {
  projectId: string
  pageId: string
  questions: readonly NewQuestion[]
}

export interface AddQuestionsResult {
  pageId: string
  /** The added questions' prompt ids, in request order. Skipped texts have none. */
  promptIds: readonly string[]
  /** Texts left out because the question is already tracked or repeated. */
  skipped: readonly string[]
  version: number
  savedAt: string
}

/** One page or topic in `prompts:addTargets`. */
export interface QuestionTarget {
  id: string
  kind: PageKind
  /** A page's label, title or URL; a topic's name. */
  name: string
  /** Null for a topic. */
  url: string | null
  /** Only `tracked` and `paused` take questions. */
  status: PageStatus
  /** Enabled questions in the active set, keywords included (each one is searched). */
  questions: number
  /** How many of `questions` are topic keywords (short searches), shown apart. */
  keywords: number
  samples: number
  /** The markets each question is checked in, in the order they were added. */
  marketIds: readonly string[]
  /** ISO-8601 UTC of its soonest scheduled check, as All pages shows it. Null when none is planned. */
  nextCheckAt: string | null
  /** Days between scheduled checks (Add questions' expert option shows and changes it). */
  intervalDays?: IntervalDays
}

/**
 * `prompts:addTargets`: what + Add → Questions offers. Every page and topic that is
 * not removed, pages first, with what the cost line needs. Reads saved data only.
 */
export interface QuestionTargets {
  projectId: string
  markets: readonly Market[]
  /** Searches left this month: the keys' and the project cap's, whichever is lower. Null when neither is known. */
  searchesLeft: number | null
  targets: readonly QuestionTarget[]
}

/**
 * `prompts:googleQuestions`: Google's "People also ask" from the page's or topic's
 * latest check in each market, read from the searches already stored (no search is
 * run). Repeats and questions tracked anywhere in the project are left out; the
 * most often asked come first. Empty before the first check.
 */
export interface GoogleQuestions {
  pageId: string
  questions: readonly string[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const promptsChannels = {
  'buyerProfile:get': invokeWith<PageIdRequest, BuyerProfile | null>(),
  'buyerProfile:generate': invokeWith<GenerateBuyerProfileRequest, BuyerProfile>(),
  'buyerProfile:update': invokeWith<UpdateBuyerProfileRequest, BuyerProfile>(),
  'prompts:list': invokeWith<PageIdRequest, PromptSetView>(),
  'prompts:listSets': invokeWith<PageIdRequest, PromptSetList>(),
  'prompts:setActive': invokeWith<SetActivePromptSetRequest, PromptSetView>(),
  'prompts:generate': invokeWith<GeneratePromptsRequest, PromptSetView>(),
  'prompts:add': invokeWith<AddPromptRequest, PromptSetView>(),
  'prompts:edit': invokeWith<EditPromptRequest, PromptSetView>(),
  'prompts:remove': invokeWith<PromptIdRequest, PromptSetView>(),
  'prompts:setEnabled': invokeWith<SetPromptEnabledRequest, PromptSetView>(),
  'prompts:reorder': invokeWith<ReorderPromptsRequest, PromptSetView>(),
  'prompts:save': invokeWith<PageIdRequest, PromptSetView>(),
  'prompts:discard': invokeWith<PageIdRequest, PromptSetView>(),
  'prompts:reword': invokeWith<RewordPromptRequest, RewordPromptResult>(),
  'prompts:versions': invokeWith<PromptIdRequest, PromptVersions>(),
  'prompts:addQuestions': invokeWith<AddQuestionsRequest, AddQuestionsResult>(),
  'prompts:textRules': invokeWith<PageIdRequest, PromptTextRules>(),
  'prompts:addTargets': invokeWith<ProjectIdRequest, QuestionTargets>(),
  'prompts:googleQuestions': invokeWith<PageIdRequest, GoogleQuestions>()
} as const satisfies InvokeChannelSpecs
