import type {
  EngineId,
  IntervalDays,
  KeywordUniverse,
  TopicBands,
  TopicGoal,
  TopicProgressPoint,
  TopicResultRow,
  TopicSource,
  TopicStage,
  TopicStageCoverage,
  TopicSummary,
  TopicTodoGroup
} from '../../domain'
import type { LiveCheck } from '../live-results'
import type { TopicCallInfo } from './types'

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface TopicResultsRequest {
  projectId: string
  topicId: string
  /** Null uses the topic's default market. */
  marketId: string | null
  /**
   * Null reads the latest result of every prompt across this market's runs
   * (batches included). A run id pins the view to that one check.
   */
  runId: string | null
  /**
   * The engine whose results to read (audit #4). Absent, null or `google_aio`: Google AI
   * Overview. Another engine reads its stored answers, scored by the same rule: target
   * page cited, out of the searches that got an answer.
   */
  engine?: EngineId | null
}

export interface TopicMeta {
  id: string
  name: string
  source: TopicSource
  /** "From a seed · 28 questions · 21 target pages · every 14 days". */
  sourceLine: string
  seed: string
  competitorUrl: string | null
  intervalDays: number
  status: TopicSummary['status']
  /** ISO-8601 UTC of the latest finished check in this market. */
  checkedAt: string | null
  markets: readonly { id: string; label: string; isDefault: boolean }[]
  marketId: string
  bands: TopicBands
  questions: number
  keywords: number
  targetPages: number
  /**
   * The topic's target page (migration 047): a full URL on the own site, or null.
   * Questions without a target page of their own aim at it.
   */
  targetPage: string | null
  pendingBatches: number
  /** The project's brand name and aliases (never in questions or keywords). */
  brand?: { name: string; aliases: readonly string[] }
  /** The project's own domain, e.g. `example.com`. */
  domain?: string
}

/** Summary line inputs ("Since Oct 12: 1 more cited (Q28, …)"). Timing, not proof. */
export interface TopicSummaryInputs {
  /** The check compared against; null on the first check. */
  sinceRunId: string | null
  sinceAt: string | null
  questionsCitedChange: number | null
  keywordsCitedChange: number | null
  /** Prompts newly cited / no longer cited since that check. */
  gained: readonly string[]
  lost: readonly string[]
  /** Weakest stage with at least 2 questions with an overview. */
  weakestStage: { stage: TopicStage; cited: number; withAio: number } | null
  strongestStage: { stage: TopicStage; cited: number; withAio: number } | null
  /** Highest-odds to-do rows (prompt ids), for "Next: Q6 and Q10". */
  next: readonly string[]
  /** Notes and fixes logged between the two checks. */
  edits: readonly { date: string; text: string }[]
}

export interface TopicSavedSummary {
  text: string
  createdAt: string
  runId: string | null
}

export interface TopicResults {
  topic: TopicMeta
  goals: { questions: TopicGoal; keywords: TopicGoal }
  /** Trend for the KPI tile: change in cited questions since the previous full check. */
  questionsTrend: { change: number | null; sinceAt: string | null }
  keywordsTrend: { change: number | null; sinceAt: string | null }
  rows: readonly TopicResultRow[]
  todo: readonly TopicTodoGroup[]
  byStage: readonly TopicStageCoverage[]
  keywords: KeywordUniverse
  /** One point per check in this market, oldest first (real dates). */
  progress: readonly TopicProgressPoint[]
  /** "They're cited, you're not": competitor domain cited, own domain not. */
  competitorCitedNotYou: readonly string[]
  summaryInputs: TopicSummaryInputs
  /** The latest saved Claude summary line, when one was written. */
  savedSummary: TopicSavedSummary | null
  builtAt: string
  /** A check running now, or the latest one that stopped part-way. Absent or null otherwise. */
  live?: LiveCheck | null
}

export interface TopicPromptRequest {
  projectId: string
  topicId: string
  promptId: string
  marketId?: string | null
}

export interface WhyNotCitedResult {
  promptId: string
  /** Plain-words reasons, most likely first. Never claims a cause as proof. */
  reasons: readonly { text: string; evidence: string | null }[]
  citedInstead: readonly { domain: string; url: string; whyItWins: string }[]
  summary: string
  info: TopicCallInfo
}

export interface ExplainCitationRequest {
  projectId: string
  topicId: string
  promptId: string
  marketId: string | null
  /** Null explains the latest result of the prompt in the market. */
  runId: string | null
}

/** Why the overview cites who it cites, from the stored overview only. Timing, not proof. */
export interface ExplainCitationResult {
  promptId: string
  runId: string | null
  text: string
  /** Short facts behind the text ("simpletexting.com is cited at position 1"). */
  facts: readonly string[]
  createdAt: string
  info: TopicCallInfo
}

export interface DraftFixResult {
  promptId: string
  /** Where the fix goes: the target page, or a new page. */
  where: { pageId: string | null; url: string | null; newPage: boolean }
  steps: readonly string[]
  /** Suggested FAQ or section text, in the page's voice. Unconfirmed facts in [brackets]. */
  draft: string
  text: string
  writeWithUrl: string
  info: TopicCallInfo
}

export interface TopicSummaryRequest {
  projectId: string
  topicId: string
  marketId: string | null
  /** True writes a new one even when one exists for the latest check. */
  force?: boolean
}

export interface TopicSummaryResult {
  /** "Since Oct 12: 1 more cited (Q28, after your Oct 14 edit). …" */
  line: string
  /** Executive summary paragraph (exports). */
  executive: string
  /** Next 3 actions, from saved data. */
  nextActions: readonly { text: string; promptIds: readonly string[]; verify: string | null }[]
  saved: TopicSavedSummary
  info: TopicCallInfo
}

export interface TopicList {
  topics: readonly TopicSummary[]
}

export interface UpdateTopicRequest {
  projectId: string
  topicId: string
  name?: string
  bands?: TopicBands
  intervalDays?: IntervalDays
  status?: 'tracked' | 'paused' | 'removed'
  /**
   * The topic's target page: a URL on the own site or a path such as `/pricing`
   * (main resolves it on the project's domain). Null clears it.
   */
  targetPage?: string | null
}

/** The URL behind "Write with 1000AIOverviews". Opens the browser; sends no data. */
export const WRITE_WITH_URL = 'https://1000aioverviews.com'
