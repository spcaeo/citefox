/**
 * Multi-engine tracking (owner decision 2026-10-24): which engines a project, page or
 * topic checks, what that costs before saving or running, and each engine's answers.
 *
 * Google AI Overview runs on cloro or SerpApi; ChatGPT, Perplexity, Google AI Mode,
 * Gemini and Copilot need a cloro key. Money is micro-dollars (USD × 1,000,000) so sums
 * stay exact; credits are cloro's; searches are calls (SerpApi searches, cloro requests).
 */

import type {
  CitationClass,
  EngineAnswerStatus,
  EngineId,
  ProviderChoice,
  SearchProvider
} from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'

export interface EnginesProjectRequest {
  projectId: string
}

/** One engine as a picker shows it. */
export interface EngineOption {
  id: EngineId
  label: string
  /** cloro credits for one question in one market (one sample). */
  credits: number
  /** True for every engine but Google AI Overview: it needs a cloro key. */
  needsCloro: boolean
  /** False when it needs a cloro key and the project has none it may use. */
  runnable: boolean
}

/** `engines:get` and `engines:set`. */
export interface ProjectEnginesView {
  projectId: string
  /** The project's engines, in display order. Never empty. */
  engines: readonly EngineId[]
  /** The saved setting. `auto` is cloro when a cloro key is saved, else SerpApi. */
  provider: ProviderChoice
  /** Who runs the Google AI Overview search now. */
  activeProvider: SearchProvider
  /** A cloro key the project may use is on. */
  cloroReady: boolean
  /** A SerpApi key the project may use is on. */
  serpapiReady: boolean
  options: readonly EngineOption[]
  /** Pages and topics with their own engines. */
  overrides: number
  /** Null until the project saves a choice. */
  updatedAt: string | null
}

/** `engines:set`. Fields left out keep their saved value. */
export interface SetProjectEnginesRequest {
  projectId: string
  engines?: readonly EngineId[]
  provider?: ProviderChoice
}

export interface PageEnginesRequest {
  projectId: string
  /** A page id, or a topic's id (a topic is a page row). */
  pageId: string
}

/** `engines:page` and `engines:setPage`. */
export interface PageEnginesView {
  projectId: string
  pageId: string
  kind: 'page' | 'topic'
  /** The engines a check uses: its own, else the project's. */
  engines: readonly EngineId[]
  /** Its own choice. Null: it follows the project. */
  own: readonly EngineId[] | null
  projectEngines: readonly EngineId[]
}

/** `engines:setPage`. Null (or an empty list) returns the page to the project's engines. */
export interface SetPageEnginesRequest {
  projectId: string
  pageId: string
  engines: readonly EngineId[] | null
}

/**
 * `engines:estimate`: questions × markets × samples × engines, once and over a month of
 * scheduled checks. With no `pageIds`, every tracked page and topic. `engines` previews a
 * choice before it is saved: it replaces the engines of the pages asked for (with no
 * `pageIds`, of every page that follows the project). `provider` previews a provider.
 */
export interface EngineEstimateRequest {
  projectId: string
  pageIds?: readonly string[] | null
  engines?: readonly EngineId[] | null
  provider?: ProviderChoice | null
}

export interface SpendFigure {
  searches: number
  credits: number
  costMicros: number
}

export interface EngineEstimateRow extends SpendFigure {
  engine: EngineId
  label: string
  /** Calls one check makes on this engine. */
  calls: number
  /** False when it needs a cloro key the project does not have: left out of the totals. */
  runnable: boolean
}

/** The plan an estimate prices at. */
export interface EstimatePlan {
  provider: SearchProvider
  label: string
  usd: number
  /** Credits (cloro) or searches (SerpApi) the plan buys a month. */
  units: number
}

export interface EngineEstimate {
  projectId: string
  /** Who would run the Google AI Overview search. */
  provider: SearchProvider
  cloroReady: boolean
  pages: number
  /** Question × market pairs one check covers. */
  questions: number
  /** One check of every page in scope. */
  perCheck: SpendFigure
  /** Scheduled checks over 30 days (tracked pages only, each at its own interval). */
  perMonth: SpendFigure
  /** Per check, in display order; every engine any page in scope uses. */
  byEngine: readonly EngineEstimateRow[]
  plans: readonly EstimatePlan[]
  /** Selected engines that need a cloro key the project does not have. */
  skipped: readonly EngineId[]
}

/** `engines:question`: one question's latest answer on each engine. */
export interface QuestionEnginesRequest {
  projectId: string
  pageId: string
  promptId: string
  /** Null: the page's default market. */
  marketId?: string | null
}

export interface EngineSourceView {
  position: number
  url: string
  domain: string
  title: string | null
  classification: CitationClass
}

export interface EngineAnswerView {
  engine: EngineId
  label: string
  /** The page or topic checks this engine now. */
  selected: boolean
  /** Null: never checked on this engine. */
  status: EngineAnswerStatus | null
  checkedAt: string | null
  /** Our domain is among the sources. */
  cited: boolean
  /** Our brand is in the answer text. */
  named: boolean
  citedUrl: string | null
  position: number | null
  text: string | null
  markdown: string | null
  /** At most 20, in position order. */
  sources: readonly EngineSourceView[]
  /** Why it failed or was unavailable, in plain words. */
  message: string | null
  provider: SearchProvider | null
  credits: number
  costMicros: number
}

export interface QuestionEnginesView {
  projectId: string
  pageId: string
  promptId: string
  marketId: string | null
  engines: readonly EngineAnswerView[]
}

/**
 * `engines:summary`: each engine's latest status per question × market, counted. With
 * no `pageIds`, every page and topic in the project. `perQuestion` adds the statuses of
 * each question (up to 50 pages).
 */
export interface EngineSummaryRequest {
  projectId: string
  pageIds?: readonly string[] | null
  marketId?: string | null
  perQuestion?: boolean
}

export interface EngineCounts {
  engine: EngineId
  label: string
  /** Question × market pairs with a stored answer. */
  checked: number
  cited: number
  named: number
  notCited: number
  noAnswer: number
  unavailable: number
  error: number
  /** Cited now, not cited at the check before. */
  gained: number
  /** Cited at the check before, not now. */
  lost: number
  lastCheckedAt: string | null
}

export interface QuestionEngineStatuses {
  pageId: string
  promptId: string
  marketId: string
  statuses: Partial<Record<EngineId, EngineAnswerStatus>>
  /**
   * Answer engines whose latest answer cites you: the own pages among its sources (any
   * sample), so a screen can tell the target page from another of your pages (audit #4).
   */
  ownUrls?: Partial<Record<EngineId, readonly string[]>>
  /**
   * Engines whose citation moved since the check before: `gained` (cited now, not
   * then) or `lost` (cited then, not now), so the gained and lost counts drill.
   */
  moved?: Partial<Record<EngineId, 'gained' | 'lost'>>
}

export interface EngineSummaryView {
  projectId: string
  /** The project's engines, so a screen knows which columns to show. */
  engines: readonly EngineId[]
  counts: readonly EngineCounts[]
  /** Present when `perQuestion` was asked. */
  questions?: readonly QuestionEngineStatuses[]
}

/** `engines:spend`: credits and money per check, and the month's totals. */
export interface EngineSpendRequest {
  projectId: string
  /** `YYYY-MM` in the computer's time zone. Default: this month. */
  month?: string | null
}

export interface CheckSpend extends SpendFigure {
  jobId: string
  startedAt: string
  finishedAt: string | null
  status: string
  /** Who ran the Google AI Overview search. Null on checks before cloro: SerpApi. */
  provider: SearchProvider | null
  engines: readonly EngineId[]
}

export interface EngineSpendView {
  projectId: string
  month: string
  /** This project's checks in the month. */
  total: SpendFigure & { checks: number }
  byEngine: readonly (SpendFigure & { engine: EngineId; label: string })[]
  /** Newest first, at most 50. */
  checks: readonly CheckSpend[]
  /** Every project's use of each provider's keys this month, from the key ledger. */
  account: readonly { provider: SearchProvider; searches: number; credits: number }[]
}

export const enginesChannels = {
  'engines:get': invokeWith<EnginesProjectRequest, ProjectEnginesView>(),
  'engines:set': invokeWith<SetProjectEnginesRequest, ProjectEnginesView>(),
  'engines:page': invokeWith<PageEnginesRequest, PageEnginesView>(),
  'engines:setPage': invokeWith<SetPageEnginesRequest, PageEnginesView>(),
  'engines:estimate': invokeWith<EngineEstimateRequest, EngineEstimate>(),
  'engines:question': invokeWith<QuestionEnginesRequest, QuestionEnginesView>(),
  'engines:summary': invokeWith<EngineSummaryRequest, EngineSummaryView>(),
  'engines:spend': invokeWith<EngineSpendRequest, EngineSpendView>()
} as const satisfies InvokeChannelSpecs
