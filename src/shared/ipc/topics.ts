/**
 * Topics (cluster checking) and keywords & groups (Docs/TOPICS-SPEC.md sections 2–6).
 *
 * Rules every channel here follows:
 * - Nothing spends a SerpApi search except `topics:start` (which starts a check
 *   job through the queue). Discover, generate and match read saved data and the
 *   project's site (Jina or a direct read), never Google.
 * - AI suggestions come back apart (`…Suggestion` lists) and change nothing until
 *   the screen applies them with `topics:updateDraft`. The exception is a step's
 *   own primary action (Write buyer profile, Write questions, Generate keywords,
 *   Match pages, Read their page, Questions from their page), which writes the
 *   draft and returns it.
 * - Claude calls go through the project's connection and are logged in
 *   `llm_calls`; `topics:describeStep` gives the "Claude · about N s" label and
 *   what the step reads. Long multi-call steps push `topics:progress`.
 * - Questions and keywords never contain the brand or an alias: generated text
 *   naming one is dropped (or flagged `brand` for user and imported text).
 */

import type {
  CompetitorClaim,
  CompetitorPageRead,
  EngineId,
  KeywordCoreTerm,
  KeywordDepth,
  KeywordGroupKind,
  KeywordIntent,
  KeywordIntentFamily,
  KeywordUniverse,
  FunnelStage,
  PageType,
  QuestionDepth,
  TopicBands,
  TopicDraft,
  TopicDraftPrompt,
  TopicDraftSummary,
  TopicGenerate,
  TopicGoal,
  TopicProfileSection,
  TopicProgressPoint,
  TopicPromptKind,
  TopicPromptSource,
  TopicResultRow,
  TopicSource,
  TopicStage,
  TopicStageCoverage,
  TopicSummary,
  TopicTodoGroup,
  TopicWizardPath,
  TopicWizardStep,
  WorkProgressState,
  IntervalDays
} from '../domain'
import type { AssistLabel } from './assist'
import type { LiveCheck } from './live-results'
import type { CompanySuggestion, ProductSuggestion } from './projects'
import type {
  SuggestTopicTargetResult,
  TopicTargetRequest,
  TopicTargetSuggestions
} from './topicTargets'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'

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

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export interface CreateTopicDraftRequest {
  projectId: string
  path: TopicWizardPath
  /** Prefill (e.g. from Suggested start). */
  seed?: string
  name?: string
  /** Edit an existing topic: the draft is filled from it. */
  topicId?: string
}

/** A new or edited question/keyword. A missing `id` adds one. */
export interface TopicDraftPromptInput {
  id?: string
  kind: TopicPromptKind
  text: string
  stage?: TopicStage | null
  source?: TopicPromptSource
  sourceNote?: string | null
  included?: boolean
  kwGroup?: string | null
  kwGroupKind?: KeywordGroupKind | null
  kwFamily?: KeywordIntentFamily | null
  intent?: KeywordIntent | null
  funnel?: FunnelStage | null
  pageType?: PageType | null
}

export interface TopicProfilePointInput {
  id?: string
  section: TopicProfileSection
  text: string
  foundIn?: string | null
  verify?: string | null
}

/**
 * Every field is optional; only the fields sent change. Prompt edits are
 * applied in order: `removePromptIds`, then `upsertPrompts`. A `profile` patch
 * saves a new profile version; `profileVersion` switches back to one.
 */
export interface TopicDraftPatch {
  step?: TopicWizardStep
  name?: string
  seed?: string
  otherSeeds?: readonly string[]
  website?: string
  about?: string
  generate?: TopicGenerate
  questionDepth?: QuestionDepth
  keywordDepth?: KeywordDepth
  bands?: TopicBands
  marketIds?: readonly string[]
  segments?: readonly string[]
  switchingFrom?: readonly string[]
  integrations?: readonly string[]
  /** `auto` infers the product from the seed; `pick` pins one (null: the whole business). */
  product?: { mode: 'auto' } | { mode: 'pick'; productId: string | null }
  competitorUrl?: string | null
  intervalDays?: IntervalDays
  keywordTerms?: readonly KeywordCoreTerm[]
  upsertPrompts?: readonly TopicDraftPromptInput[]
  removePromptIds?: readonly string[]
  /** Points of the new version (the whole list). */
  profile?: { points: readonly TopicProfilePointInput[]; note: 'edited' | 'filled_gaps' }
  profileVersion?: number
}

export interface UpdateTopicDraftRequest {
  projectId: string
  draftId: string
  patch: TopicDraftPatch
}

export interface TopicDraftList {
  drafts: readonly TopicDraftSummary[]
}

// ---------------------------------------------------------------------------
// Seed step
// ---------------------------------------------------------------------------

export interface DiscoverSeedResult {
  draftId: string
  /** Site pages read (cached per project; no search). */
  pagesRead: readonly { url: string; role: string; ok: boolean }[]
  /**
   * Problems to start from, best first. `caution` is set when the statement needs
   * checking. `productId` is the saved product the seed is about (Docs/PROMPT-AUDIT.md
   * P2; null: the whole business): "Use as seed" picks it, so every later step reads
   * that product's competitors. `evidence` is the page path or heading that shows it.
   */
  seeds: readonly {
    id: string
    text: string
    caution: string | null
    productId: string | null
    evidence: string | null
  }[]
  segments: readonly { id: string; name: string; reason: string }[]
  /**
   * The products the seeds and competitors refer to: the saved catalog, or, when the
   * topic's product has no saved competitors, the product the web search ran for
   * (batch 2 row 5).
   */
  products?: readonly ProductSuggestion[]
  /**
   * Live products the same buyer could choose instead (Docs/FEEDBACK.md row 3): the
   * saved competitors of the topic's product, else one web search for it.
   */
  competitors: readonly CompanySuggestion[]
  /** Replaced or discontinued options buyers migrate from (saved on the project). */
  switchingFrom: readonly CompanySuggestion[]
  /** Partners and tools users connect or send from (saved on the project). */
  integrations: readonly CompanySuggestion[]
  /** An "About the business" suggestion built from the saved products. */
  about: string | null
  info: TopicCallInfo | null
  message: string | null
}

// ---------------------------------------------------------------------------
// Buyer profile step
// ---------------------------------------------------------------------------

export interface WriteTopicProfileRequest {
  projectId: string
  draftId: string
  /** True rewrites every section as a new version ("Rewrite all"). */
  rewrite?: boolean
  instruction?: string | null
}

export interface TopicProfileSuggestion {
  id: string
  section: TopicProfileSection
  text: string
  foundIn: string | null
  verify: string | null
  /** For a rewrite: the point it replaces. */
  replacesPointId: string | null
}

export type TopicProfileAction = 'discover' | 'rewrite' | 'shorter' | 'explain'

export interface DiscoverProfileSectionRequest {
  projectId: string
  draftId: string
  /** Null fills gaps across every section ("Fill gaps from your site"). */
  section: TopicProfileSection | null
  action: TopicProfileAction
  instruction?: string | null
}

export interface TopicProfileSuggestions {
  draftId: string
  section: TopicProfileSection | null
  action: TopicProfileAction
  suggestions: readonly TopicProfileSuggestion[]
  /** For `explain`: the plain-words explanation of the sources. */
  explanation: string | null
  /** "4 facts to re-check before you rely on them". */
  toVerify: number
  info: TopicCallInfo
}

export interface RewriteTopicSectionRequest {
  projectId: string
  draftId: string
  section: TopicProfileSection
  mode: 'rewrite' | 'shorter'
  instruction?: string | null
}

// ---------------------------------------------------------------------------
// Questions step
// ---------------------------------------------------------------------------

export interface GenerateTopicQuestionsRequest {
  projectId: string
  draftId: string
  /** Replace the current Claude-written questions (user and imported ones stay). */
  replace?: boolean
}

export interface TopicPromptSuggestion {
  id: string
  kind: TopicPromptKind
  text: string
  stage: TopicStage | null
  kwGroup: string | null
  kwGroupKind: KeywordGroupKind | null
  kwFamily: KeywordIntentFamily | null
  intent: KeywordIntent | null
  funnel: FunnelStage | null
  pageType: PageType | null
  /** Why Claude suggests it, one line. */
  reason: string | null
  /** For a rewrite: the draft prompt it replaces. */
  replacesId: string | null
}

export interface TopicPromptSuggestions {
  draftId: string
  suggestions: readonly TopicPromptSuggestion[]
  /** Suggestions dropped because they named the brand or an alias. */
  droppedForBrand: number
  info: TopicCallInfo
}

export interface DiscoverStageQuestionsRequest {
  projectId: string
  draftId: string
  stage: TopicStage
  count?: number
}

export interface JourneyGapsResult {
  draftId: string
  /** Stages with something missing, e.g. "Fit has nothing for clinics". */
  gaps: readonly { stage: TopicStage; note: string }[]
  /** Overlapping pairs of draft question ids, worked out in code. */
  overlaps: readonly { a: string; b: string; reason: string }[]
  /** Questions that fill the gaps. */
  suggestions: readonly TopicPromptSuggestion[]
  /** "3 gaps, 3 overlapping pairs. Fit has nothing for clinics; …" */
  headline: string
  info: TopicCallInfo
}

export interface RewriteTopicQuestionRequest {
  projectId: string
  draftId: string
  promptIds: readonly string[]
  instruction?: string | null
}

// ---------------------------------------------------------------------------
// Keywords step
// ---------------------------------------------------------------------------

export interface DiscoverTermsResult {
  draftId: string
  terms: readonly KeywordCoreTerm[]
  /** Modifier patterns saved on the draft for the coverage expansion ("{X} service"). */
  patterns?: readonly string[]
  info: TopicCallInfo
}

export interface GenerateTopicKeywordsRequest {
  projectId: string
  draftId: string
  replace?: boolean
}

export interface TopicKeywordSummary {
  keywords: number
  groups: number
  searchesLo: number
  searchesHi: number
  /** Searches left this month; null when CiteFox cannot say. */
  searchesLeft: number | null
  /** "118 keywords in 22 groups · ≈118–236 searches per market · 13 left". */
  line: string
}

export interface GenerateTopicKeywordsResult {
  draft: TopicDraft
  summary: TopicKeywordSummary
  /** Keywords from code patterns vs from Claude intent groups. */
  fromPatterns: number
  fromClaude: number
  droppedForBrand: number
  info: TopicCallInfo
}

export interface MissingGroupsResult {
  draftId: string
  groups: readonly {
    name: string
    kind: KeywordGroupKind
    family: KeywordIntentFamily | null
    reason: string
    keywords: readonly TopicPromptSuggestion[]
  }[]
  info: TopicCallInfo
}

export interface MergeNearDuplicatesRequest {
  projectId: string
  draftId: string
  /** False lists the pairs; true merges them (keeps the first of each pair). */
  apply: boolean
}

export interface NearDuplicatePair {
  keepId: string
  dropId: string
  keep: string
  drop: string
  reason: string
}

export interface MergeNearDuplicatesResult {
  pairs: readonly NearDuplicatePair[]
  /** Set when `apply` was true. */
  draft: TopicDraft | null
}

// ---------------------------------------------------------------------------
// My own questions
// ---------------------------------------------------------------------------

export interface TopicCsvMapping {
  /** Zero-based column index of the question text. */
  question: number
  source?: number | null
  notes?: number | null
  hasHeader: boolean
}

export interface ReadCsvColumnsRequest {
  projectId: string
  content: string
}

export interface CsvColumnsResult {
  columns: readonly string[]
  /** First rows, for the column picker. */
  sample: readonly (readonly string[])[]
  rows: number
  /** Best guess at the mapping. */
  guess: TopicCsvMapping
}

export interface ImportTopicQuestionsRequest {
  projectId: string
  draftId: string
  /** Pasted lines (one question per line). */
  text?: string | null
  csv?: { fileName: string; content: string; mapping: TopicCsvMapping } | null
  /** True adds to the questions already imported ("Add more"). */
  append?: boolean
}

export interface ImportTopicQuestionsResult {
  draft: TopicDraft
  /** Imported rows as they now stand in the draft. */
  rows: readonly TopicDraftPrompt[]
  stats: {
    lines: number
    kept: number
    duplicatesMerged: number
    brandFlagged: number
    shortFlagged: number
  }
}

export interface QuestionCleanupItem {
  id: string
  before: string
  after: string
  stage: TopicStage | null
  /** What changed, e.g. "Brand name removed", "Made it a question". */
  change: string
}

export interface QuestionCleanupResult {
  draftId: string
  items: readonly QuestionCleanupItem[]
  info: TopicCallInfo
}

// ---------------------------------------------------------------------------
// Competitor page
// ---------------------------------------------------------------------------

export interface ReadCompetitorPageRequest {
  projectId: string
  draftId: string
  url: string
}

export interface ReadCompetitorPageResult {
  draft: TopicDraft
  page: CompetitorPageRead
}

export interface CompetitorQuestionsRequest {
  projectId: string
  draftId: string
  marketId: string | null
}

export interface CompetitorQuestionsResult {
  draft: TopicDraft
  claims: readonly CompetitorClaim[]
  droppedForBrand: number
  info: TopicCallInfo
}

// ---------------------------------------------------------------------------
// Pages step
// ---------------------------------------------------------------------------

/** One page a prompt can target: a tracked page or a sitemap entry. */
export interface TopicPageCandidate {
  /** Tracked page id; null for a sitemap entry that is not tracked. */
  pageId: string | null
  url: string
  title: string | null
  source: 'tracked' | 'sitemap'
  /** H2/H3 outline where a snapshot exists. */
  outline: readonly string[]
}

export interface TopicPageCandidates {
  candidates: readonly TopicPageCandidate[]
  /** ISO-8601 UTC of the latest sitemap read; null when none. */
  sitemapReadAt: string | null
}

/** `topics:matchTracked`: CiteFox AI picks each tracked question's best page, with a fit %. */
export interface MatchTrackedTopicRequest {
  projectId: string
  topicId: string
  marketId?: string | null
}

export interface MatchTrackedTopicResult {
  /** Questions that got a page. */
  matched: number
  /** Questions no page on the site fits. */
  noPage: number
  /** Questions whose page you picked, left as they were. */
  kept: number
}

export interface MatchTopicPagesRequest {
  projectId: string
  draftId: string
  /** Null matches every prompt not confirmed by the user. */
  promptIds?: readonly string[] | null
}

export interface MatchTopicPagesResult {
  draft: TopicDraft
  matched: number
  noPage: number
  info: TopicCallInfo
}

/** Target for one or more prompts. `url` null with `pageId` null means "No page yet". */
export interface TopicTarget {
  pageId: string | null
  url: string | null
}

/**
 * Change or confirm a target. With `draftId` it edits the wizard draft; with
 * `topicId` it edits a started topic (`topic_prompts`, kept across prompt-set
 * versions). `target` omitted confirms the current target.
 */
export interface SetTopicTargetRequest {
  projectId: string
  draftId?: string | null
  topicId?: string | null
  promptIds: readonly string[]
  target?: TopicTarget
  /**
   * Other own pages that may answer these questions besides the target (a started
   * topic only). Google citing any of them counts as the right page. Left out: kept.
   */
  alsoUrls?: readonly string[]
}

export interface SetTopicTargetResult {
  draft: TopicDraft | null
  /** Updated rows for a started topic. */
  rows: readonly { promptId: string; targetPageId: string | null; targetUrl: string | null }[]
}

export interface DraftPageBriefRequest {
  projectId: string
  draftId?: string | null
  topicId?: string | null
  promptId: string
  marketId?: string | null
}

export interface TopicPageBrief {
  promptId: string
  /** "Answer first: two sentences in the buyer's words, then …". */
  summary: string
  outline: readonly string[]
  /** Domains Google cites now (from saved checks; empty before a check). */
  citedNow: readonly string[]
  /** The whole brief as text, for Copy brief. */
  text: string
  /** External writing tool link. Opens the browser; CiteFox sends it nothing. */
  writeWithUrl: string
  info: TopicCallInfo
}

// ---------------------------------------------------------------------------
// Estimate and start
// ---------------------------------------------------------------------------

export const TOPIC_START_PLANS = ['likeliest', 'stage_first', 'stagger', 'all_now'] as const
export type TopicStartPlan = (typeof TOPIC_START_PLANS)[number]

export interface TopicEstimateRequest {
  projectId: string
  draftId: string
  /** Which prompts the first check covers. Default: what the draft generates. */
  scope?: 'questions' | 'keywords' | 'both'
}

export interface TopicPlanOption {
  plan: TopicStartPlan
  label: string
  detail: string
  /** Prompts checked today, and the searches they need. */
  todayPrompts: number
  todaySearchesLo: number
  todaySearchesHi: number
  /** Days the rest is spread over (0 when everything runs today). */
  restDays: number
  fit: 'fits' | 'may_not_fit' | 'over_budget' | 'unknown'
  /** True for the plan CiteFox suggests. */
  suggested: boolean
  /** For `stage_first`: the stage (or keyword group) checked first. */
  firstStage: TopicStage | null
  firstGroup: string | null
}

export interface TopicEstimate {
  draftId: string
  scope: 'questions' | 'keywords' | 'both'
  questions: number
  keywords: number
  stages: number
  groups: number
  markets: number
  prompts: number
  searchesLo: number
  searchesHi: number
  /** Searches left this month across keys and the project cap; null when unknown. */
  searchesLeft: number | null
  /** ISO date the SerpApi allowance renews (first of next month). */
  renewsOn: string
  plans: readonly TopicPlanOption[]
  /** Per re-check interval: searches a month. */
  recheck: readonly { intervalDays: IntervalDays; monthlyLo: number; monthlyHi: number }[]
  targets: { set: number; noPage: number }
  /** "Anything that doesn't fit waits for Nov 1. Nothing is lost." */
  note: string | null
}

export interface StartTopicRequest {
  projectId: string
  draftId: string
  plan: TopicStartPlan
  scope?: 'questions' | 'keywords' | 'both'
  /** For `stage_first`. */
  stage?: TopicStage | null
  group?: string | null
  intervalDays?: IntervalDays
}

export interface StartTopicResult {
  topicId: string
  promptSetId: string
  /** The check job started now; null when nothing could start (message says why). */
  jobId: string | null
  /** Batches planned for later days. */
  batches: readonly { batchNo: number; dueAt: string; prompts: number }[]
  message: string
  nextStep: string | null
}

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

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Invoke channels for this area. Each one is declared here only. */
export const topicsChannels = {
  // Topics and drafts
  'topics:list': invokeWith<TopicProjectRequest, TopicList>(),
  'topics:update': invokeWith<UpdateTopicRequest, TopicSummary>(),
  'topics:describeStep': invokeWith<TopicDescribeStepRequest, TopicStepDescription>(),
  'topics:suggestedStart': invokeWith<TopicProjectRequest, TopicSuggestedStartResult>(),
  'topics:listDrafts': invokeWith<TopicProjectRequest, TopicDraftList>(),
  'topics:createDraft': invokeWith<CreateTopicDraftRequest, TopicDraft>(),
  'topics:getDraft': invokeWith<TopicDraftRequest, TopicDraft>(),
  'topics:updateDraft': invokeWith<UpdateTopicDraftRequest, TopicDraft>(),
  'topics:discardDraft': invokeWith<TopicDraftRequest, TopicDraftList>(),
  // Seed and profile
  'topics:discoverSeed': invokeWith<TopicDraftRequest, DiscoverSeedResult>(),
  'topics:writeProfile': invokeWith<WriteTopicProfileRequest, TopicDraft>(),
  'topics:discoverProfileSection': invokeWith<
    DiscoverProfileSectionRequest,
    TopicProfileSuggestions
  >(),
  'topics:rewriteSection': invokeWith<RewriteTopicSectionRequest, TopicProfileSuggestions>(),
  // Questions
  'topics:generateQuestions': invokeWith<GenerateTopicQuestionsRequest, TopicDraft>(),
  'topics:discoverStageQuestions': invokeWith<
    DiscoverStageQuestionsRequest,
    TopicPromptSuggestions
  >(),
  'topics:findJourneyGaps': invokeWith<TopicDraftRequest, JourneyGapsResult>(),
  'topics:rewriteQuestion': invokeWith<RewriteTopicQuestionRequest, TopicPromptSuggestions>(),
  // Keywords
  'topics:discoverTerms': invokeWith<TopicDraftRequest, DiscoverTermsResult>(),
  'topics:generateKeywords': invokeWith<
    GenerateTopicKeywordsRequest,
    GenerateTopicKeywordsResult
  >(),
  'topics:suggestMissingGroups': invokeWith<TopicDraftRequest, MissingGroupsResult>(),
  'topics:mergeNearDuplicates': invokeWith<MergeNearDuplicatesRequest, MergeNearDuplicatesResult>(),
  'topics:keywordSummary': invokeWith<TopicDraftRequest, TopicKeywordSummary>(),
  // My own questions
  'topics:readCsvColumns': invokeWith<ReadCsvColumnsRequest, CsvColumnsResult>(),
  'topics:importQuestions': invokeWith<ImportTopicQuestionsRequest, ImportTopicQuestionsResult>(),
  'topics:cleanupWithClaude': invokeWith<TopicDraftRequest, QuestionCleanupResult>(),
  // Competitor page
  'topics:readCompetitorPage': invokeWith<ReadCompetitorPageRequest, ReadCompetitorPageResult>(),
  'topics:competitorQuestions': invokeWith<CompetitorQuestionsRequest, CompetitorQuestionsResult>(),
  // Pages
  'topics:pageCandidates': invokeWith<TopicProjectRequest, TopicPageCandidates>(),
  'topics:matchPages': invokeWith<MatchTopicPagesRequest, MatchTopicPagesResult>(),
  'topics:setTarget': invokeWith<SetTopicTargetRequest, SetTopicTargetResult>(),
  'topics:draftPageBrief': invokeWith<DraftPageBriefRequest, TopicPageBrief>(),
  'topics:targetSuggestions': invokeWith<TopicTargetRequest, TopicTargetSuggestions>(),
  'topics:suggestTarget': invokeWith<TopicTargetRequest, SuggestTopicTargetResult>(),
  'topics:matchTracked': invokeWith<MatchTrackedTopicRequest, MatchTrackedTopicResult>(),
  // Estimate and start
  'topics:estimate': invokeWith<TopicEstimateRequest, TopicEstimate>(),
  'topics:start': invokeWith<StartTopicRequest, StartTopicResult>(),
  // Results
  'topics:results': invokeWith<TopicResultsRequest, TopicResults>(),
  'topics:whyNotCited': invokeWith<TopicPromptRequest, WhyNotCitedResult>(),
  'topics:explainCitation': invokeWith<ExplainCitationRequest, ExplainCitationResult>(),
  'topics:draftFix': invokeWith<TopicPromptRequest, DraftFixResult>(),
  'topics:topicSummary': invokeWith<TopicSummaryRequest, TopicSummaryResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const topicsEvents = {
  'topics:progress': push<TopicProgress>()
} as const satisfies PushChannelSpecs
