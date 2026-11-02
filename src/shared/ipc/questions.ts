/**
 * The project-wide Questions screen: every tracked question of every page and
 * topic in one grid, with its latest check in one market.
 */

import type { BrandLens } from '../brand-mentions'
import type {
  ClaimTone,
  IntentStage,
  PageKind,
  PromptCheckStatus,
  PromptSource,
  TopicPromptKind,
  TopicStage
} from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { LiveCheck, LiveRowState } from './live-results'
import type { PromptTextRules } from './prompts'

/**
 * What the latest check showed for the project. `cited` is the own site (this page or
 * another own page); `named` is the brand named without a citation; `error` is a capture
 * that failed after retries; `not_checked` has no finished check in the market yet.
 */
export const QUESTION_RESULTS = [
  'cited',
  'named',
  'not_cited',
  'no_overview',
  'error',
  'not_checked'
] as const
export type QuestionResult = (typeof QUESTION_RESULTS)[number]

/**
 * Compared with the question's previous check in the same market and wording.
 * `gained` and `lost` are the own-site citation; `new_overview` and `gone` are the AI
 * Overview itself. A citation change wins over an overview change. `none` covers no
 * change, a first check, and a failed capture on either side.
 */
export const QUESTION_CHANGES = ['gained', 'lost', 'new_overview', 'gone', 'none'] as const
export type QuestionChange = (typeof QUESTION_CHANGES)[number]

export function isQuestionResult(value: string): value is QuestionResult {
  return (QUESTION_RESULTS as readonly string[]).includes(value)
}

export function isQuestionChange(value: string): value is QuestionChange {
  return (QUESTION_CHANGES as readonly string[]).includes(value)
}

/** `questions:list`. `marketId` omitted or null is the project's default market. */
export interface QuestionsListRequest {
  projectId: string
  marketId?: string | null
}

/** A page or topic the questions come from (topics are `pages` rows with `kind = 'topic'`). */
export interface QuestionSource {
  id: string
  kind: PageKind
  /** The page's label or title, or the topic's name. */
  name: string
  /** The page's full URL. Null for a topic. */
  url: string | null
  /** The URL path, such as `/pricing/`. Null for a topic. */
  path: string | null
  /** Samples per prompt per check: one search each, two when Google loads the overview separately. */
  samples: number
  /** Markets this source is checked in. */
  marketIds: readonly string[]
}

/** One question: a prompt of a page's or topic's active prompt set. */
export interface QuestionRow {
  promptId: string
  sourceId: string
  /** The wording in the picked market (the first market's when that market has none). */
  text: string
  enabled: boolean
  /** False when the source is not checked in the picked market. */
  inMarket: boolean
  result: QuestionResult
  /** The rolled-up status of the latest check (section 7.1). Null when not checked. */
  status: PromptCheckStatus | null
  /** An AI Overview showed. Null when not checked or the capture failed. */
  overview: boolean | null
  /**
   * The own site was cited: a page by its rolled-up status (this page or another own
   * page), a topic by its own-site references. Null when there was no overview.
   */
  cited: boolean | null
  /**
   * Own-site citation position, 1-based: a page's mean over the winning samples (as
   * Results), a topic's best own reference (as topic results). Null when not cited.
   */
  position: number | null
  /**
   * The own page that overview cites: the target page when it is cited, else the best
   * placed other own page (as a topic row's `citedOwnUrl`). Null when not cited. Absent
   * from rows built before this field; read it as the target page when the status is
   * `page_cited`.
   */
  citedOwnUrl?: string | null
  /** The brand was named in the overview text (FR-6.4). Null when there was no overview. */
  named: boolean | null
  /**
   * Sources cited instead of the own site, best position first, at most three:
   * a competitor's name from `competitorContext()`, else the domain.
   */
  citedInstead: readonly string[]
  /** Tone of the claims about the brand in that overview. Null when none was read. */
  sentiment: ClaimTone | null
  change: QuestionChange
  /** ISO-8601 UTC finish of the check the result comes from. Null when not checked. */
  checkedAt: string | null
  /** The check (run) the result comes from. Null when not checked. */
  runId: string | null
  /**
   * The prompt id in that check. A saved prompt-set version gives every prompt a new id,
   * so this is an earlier version's id when the wording has not changed since.
   */
  resultPromptId: string | null
  /**
   * The page or topic that check belongs to: `sourceId`, or the one the question was
   * moved from when its latest check ran there. Null when not checked.
   */
  resultPageId: string | null
  /**
   * The journey stage label: a topic question's own (`topic_prompts.stage`), a page
   * question's from its intent stage. Null when unset.
   */
  stage: TopicStage | null
  /** `keyword` for a topic's keyword; every other question is a `question`. */
  promptKind: TopicPromptKind
  /**
   * The own page that should be cited: a topic question's target page, a page
   * question's own page. Both null for a topic question with no page yet.
   */
  targetPageId: string | null
  targetUrl: string | null
  /** The check before `checkedAt` in the same market and wording, for before and after. */
  previous: QuestionPrevious | null
  /**
   * A check running now has not scored this question yet: `checking` is being searched,
   * `waiting` comes later. A re-check keeps showing the earlier result meanwhile.
   */
  live?: LiveRowState | null
  /** The result comes from a check that is still running or stopped part-way. */
  partialCheck?: boolean
}

/** What the question's previous check showed (the one before the latest). */
export interface QuestionPrevious {
  /** An AI Overview showed. Null when the capture failed. */
  overview: boolean | null
  /** The own site was cited (the same rule as `QuestionRow.cited`). */
  cited: boolean | null
  /** The rolled-up status of that check (the same rule as `QuestionRow.status`). */
  status?: PromptCheckStatus | null
  checkedAt: string | null
  runId: string
  /** The prompt id in that check (an earlier version's, or another page's after a move). */
  promptId: string
  /** The page or topic that check belongs to (another one after a move). */
  pageId: string
}

export interface QuestionMarket {
  id: string
  label: string
  isDefault: boolean
}

/** Counts over every row (no filter applied), for the filter chips. */
export interface QuestionFacets {
  kind: Readonly<Record<PageKind, number>>
  source: Readonly<Record<string, number>>
  result: Readonly<Record<QuestionResult, number>>
  change: Readonly<Record<QuestionChange, number>>
}

export interface QuestionsList {
  projectId: string
  /** The market the rows are for. Null when the project has no market. */
  marketId: string | null
  markets: readonly QuestionMarket[]
  /** Sources with at least one question, topics first, then pages, in list order. */
  sources: readonly QuestionSource[]
  /** Source order, then prompt position. */
  rows: readonly QuestionRow[]
  facets: QuestionFacets
  /** The brand names and own site the screen marks (`--mark`). */
  lens: BrandLens
  /** True when any row has a sentiment reading, so the screen shows the column. */
  hasSentiment: boolean
  /** A check running now in this market (every page and topic together). Absent or null otherwise. */
  live?: LiveCheck | null
}

export const QUESTION_UPDATE_ACTIONS = ['disable', 'enable', 'remove'] as const
export type QuestionUpdateAction = (typeof QUESTION_UPDATE_ACTIONS)[number]

/**
 * `questions:update`. Saves each affected page or topic once, as a new prompt-set
 * version (the way "Edit question" saves), with the questions disabled, enabled or
 * removed. Past results stay with the earlier version. A source with unsaved edits on
 * its Prompts tab, or one the change would leave with no question, is skipped.
 */
export interface QuestionsUpdateRequest {
  projectId: string
  action: QuestionUpdateAction
  items: readonly { sourceId: string; promptId: string }[]
}

export interface QuestionsUpdateResult {
  /** Questions changed. */
  changed: number
  skipped: readonly { sourceId: string; reason: string }[]
  /** One sentence for the screen, such as "Disabled 3 questions." */
  message: string
  /** What `questions:restore` needs to put each saved source back (Undo). */
  restore: readonly QuestionRestorePoint[]
}

/**
 * One page or topic a question change saved: the version that was active before and
 * the one the change wrote. Undo makes `promptSetId` active again, only while
 * `replacedBy` is still the active one (nothing else was saved since).
 */
export interface QuestionRestorePoint {
  sourceId: string
  promptSetId: string
  replacedBy: string
}

/** `questions:restore` (Undo of a remove, pause, resume or edit). */
export interface QuestionsRestoreRequest {
  projectId: string
  points: readonly QuestionRestorePoint[]
}

export interface QuestionsRestoreResult {
  restored: number
  skipped: readonly { sourceId: string; reason: string }[]
  message: string
}

/** `questions:get`: one question with everything its edit drawer shows. */
export interface QuestionGetRequest {
  projectId: string
  sourceId: string
  promptId: string
}

/** One market's wording of a question. */
export interface QuestionWording {
  marketId: string
  /** "US · EN". */
  marketLabel: string
  isDefault: boolean
  text: string
}

export interface QuestionDetail {
  projectId: string
  sourceId: string
  sourceKind: PageKind
  /** The page's label or title, or the topic's name. */
  sourceName: string
  /** The page's URL. Null for a topic. */
  sourceUrl: string | null
  promptId: string
  /** False for an older version: it cannot be edited, `currentPromptId` can. */
  active: boolean
  currentPromptId: string | null
  label: string
  source: PromptSource
  intentStage: IntentStage
  /** A topic question's journey stage. Null on a page, or unset. */
  topicStage: TopicStage | null
  /** `keyword` or `question` in a topic; null for a page's buyer prompt. */
  topicKind: TopicPromptKind | null
  enabled: boolean
  /** One per market the page or topic is checked in, default market first. */
  wordings: readonly QuestionWording[]
  /** The checks the editor runs; the engine runs them again on save. */
  rules: PromptTextRules
  /** True while the page's Prompts tab holds unsaved edits: saving is refused. */
  draftOpen: boolean
}

/**
 * `questions:edit`: every change to one question saved at once as ONE new prompt-set
 * version (the way `questions:update` saves), so earlier results stay with the old
 * wording. Omitted fields stay as they are. `texts` lists the markets whose wording
 * changes. `topicStage` applies to a topic question only, `intentStage` and `label`
 * to a page's buyer prompt only (a topic question's label is its wording).
 */
export interface QuestionEditRequest {
  projectId: string
  sourceId: string
  promptId: string
  texts?: readonly { marketId: string; text: string }[]
  label?: string
  source?: PromptSource
  intentStage?: IntentStage
  topicStage?: TopicStage | null
  enabled?: boolean
}

export interface QuestionEditResult {
  sourceId: string
  /** The question's id in the new version (the old id when nothing changed). */
  promptId: string
  previousPromptId: string
  changed: boolean
  /** Null when nothing was saved. */
  restore: QuestionRestorePoint | null
  message: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const questionsChannels = {
  'questions:list': invokeWith<QuestionsListRequest, QuestionsList>(),
  'questions:update': invokeWith<QuestionsUpdateRequest, QuestionsUpdateResult>(),
  'questions:get': invokeWith<QuestionGetRequest, QuestionDetail>(),
  'questions:edit': invokeWith<QuestionEditRequest, QuestionEditResult>(),
  'questions:restore': invokeWith<QuestionsRestoreRequest, QuestionsRestoreResult>()
} as const satisfies InvokeChannelSpecs
