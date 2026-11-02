/**
 * Topics (cluster checking) and keywords & groups (Docs/TOPICS-SPEC.md sections 2–6).
 *
 * A topic is a `pages` row with `kind = 'topic'` and no URL. Its prompts are
 * buyer questions and/or keywords, each with a journey stage or a keyword group
 * and a target page. A check reuses the page pipeline; every result row is then
 * read as a {@link MatchState}.
 */

import { isOneOf } from './one-of'
import type { IntervalDays } from './settings'

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** Buyer journey stages, in journey order. */
export const TOPIC_STAGES = ['problem', 'options', 'doubts', 'fit', 'compare', 'decide'] as const
export type TopicStage = (typeof TOPIC_STAGES)[number]

export const TOPIC_STAGE_LABEL: Readonly<Record<TopicStage, string>> = {
  problem: 'Problem',
  options: 'Options',
  doubts: 'Doubts',
  fit: 'Fit',
  compare: 'Compare',
  decide: 'Decide'
}

/** The muted line beside a stage group header. */
export const TOPIC_STAGE_HINT: Readonly<Record<TopicStage, string>> = {
  problem: 'They feel the pain',
  options: 'Ways people solve it',
  doubts: 'What worries them',
  fit: 'Is it right for us',
  compare: 'Weighing the options',
  decide: 'Ready to pick'
}

/** Questions and keywords are scored and shown apart, each with its own band. */
export const TOPIC_PROMPT_KINDS = ['question', 'keyword'] as const
export type TopicPromptKind = (typeof TOPIC_PROMPT_KINDS)[number]

/** How the topic was started (`topics.source`). */
export const TOPIC_SOURCES = ['seed', 'questions', 'competitor'] as const
export type TopicSource = (typeof TOPIC_SOURCES)[number]

/** Where one prompt came from. */
export const TOPIC_PROMPT_SOURCES = ['claude', 'imported', 'competitor', 'user'] as const
export type TopicPromptSource = (typeof TOPIC_PROMPT_SOURCES)[number]

/** What the seed path generates. */
export const TOPIC_GENERATE = ['questions', 'keywords', 'both'] as const
export type TopicGenerate = (typeof TOPIC_GENERATE)[number]

export const KEYWORD_GROUP_KINDS = ['coverage', 'intent'] as const
export type KeywordGroupKind = (typeof KEYWORD_GROUP_KINDS)[number]

export const KEYWORD_INTENTS = ['informational', 'commercial', 'navigational'] as const
export type KeywordIntent = (typeof KEYWORD_INTENTS)[number]

export const FUNNEL_STAGES = ['tofu', 'mofu', 'bofu'] as const
export type FunnelStage = (typeof FUNNEL_STAGES)[number]

export const FUNNEL_LABEL: Readonly<Record<FunnelStage, string>> = {
  tofu: 'TOFU',
  mofu: 'MOFU',
  bofu: 'BOFU'
}

export const PAGE_TYPES = [
  'landing page',
  'blog',
  'comparison page',
  'listicle',
  'glossary',
  'product page'
] as const
export type PageType = (typeof PAGE_TYPES)[number]

/** The intent families a keyword group can be (spec section 3, Keywords & groups). */
export const KEYWORD_INTENT_FAMILIES = [
  'definitional',
  'core_category',
  'best_lists',
  'pricing',
  'alternatives_vs',
  'features',
  'how_to',
  'benefits_roi',
  'problem_aware',
  'question_long_tail',
  'trust_risk',
  'emerging_terms',
  'branded_defensive',
  'competitor_vs'
] as const
export type KeywordIntentFamily = (typeof KEYWORD_INTENT_FAMILIES)[number]

export const KEYWORD_INTENT_FAMILY_LABEL: Readonly<Record<KeywordIntentFamily, string>> = {
  definitional: 'Definitional',
  core_category: 'Core category',
  best_lists: 'Best / top lists',
  pricing: 'Pricing / free / trial',
  alternatives_vs: 'Alternatives & vs',
  features: 'Features',
  how_to: 'How-to',
  benefits_roi: 'Benefits / ROI',
  problem_aware: 'Problem-aware',
  question_long_tail: 'Question long-tail',
  trust_risk: 'Trust / risk',
  emerging_terms: 'Emerging terms',
  branded_defensive: 'Branded defensive',
  competitor_vs: 'Competitor vs'
}

/**
 * Per run result (spec section 2):
 * - `right_page` the target page is cited;
 * - `other_page` another own-domain page is cited ("wrong page");
 * - `not_cited` a target page exists, own domain not cited;
 * - `no_page` no target page and own domain not cited;
 * - `no_aio` no AI Overview (left out of the goal).
 */
export const MATCH_STATES = ['right_page', 'other_page', 'not_cited', 'no_page', 'no_aio'] as const
export type MatchState = (typeof MATCH_STATES)[number]

/** To-do group headers, in to-do order (the grid groups by these). */
export const MATCH_STATE_LABEL: Readonly<Record<MatchState, string>> = {
  not_cited: 'Page exists, not cited',
  other_page: 'Cited your site, not the target page',
  no_page: 'No page yet',
  right_page: 'Cited by the right page',
  no_aio: 'No AI Overview'
}

export const MATCH_STATE_HINT: Readonly<Record<MatchState, string>> = {
  not_cited: 'Improve the target page',
  other_page: 'Point the right page at it, or switch the target',
  no_page: 'Needs a new page',
  right_page: 'Keep it fresh',
  no_aio: 'Left out of the goal'
}

/** To-do grid order. */
export const TODO_STATE_ORDER: readonly MatchState[] = [
  'not_cited',
  'other_page',
  'no_page',
  'right_page'
]

/**
 * A prompt row's state on one check. `failed` is a search that failed after
 * retries (named apart, never counted as no overview); `not_checked` has no
 * result yet in this market.
 */
export type TopicRowState = MatchState | 'failed' | 'not_checked'

/** Win odds label: High ≥ 70, Medium 40–69, Low < 40. A ranking aid, labelled as such. */
export const WIN_ODDS_LEVELS = ['high', 'medium', 'low'] as const
export type WinOddsLevel = (typeof WIN_ODDS_LEVELS)[number]

export const WIN_ODDS_LABEL: Readonly<Record<WinOddsLevel, string>> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

/** Page match confidence: high ≥ 75 ("a title or heading answers it"), medium 45–74, low < 45. */
export type MatchConfidenceLevel = 'high' | 'medium' | 'low'

/** Where a draft prompt's target stands on the Pages step. */
export const MATCH_STATUSES = ['unmatched', 'suggested', 'confirmed', 'none'] as const
export type TopicMatchStatus = (typeof MATCH_STATUSES)[number]

/** Flags on a question or keyword (grid "Flags" column). */
export const TOPIC_PROMPT_FLAGS = ['brand', 'short', 'overlap', 'merged', 'long'] as const
export type TopicPromptFlag = (typeof TOPIC_PROMPT_FLAGS)[number]

export const TOPIC_PROMPT_FLAG_LABEL: Readonly<Record<TopicPromptFlag, string>> = {
  brand: 'Names your brand',
  short: 'Very short',
  overlap: 'Overlaps',
  merged: 'Duplicates merged',
  long: 'Over 32 words'
}

// ---------------------------------------------------------------------------
// Depth and bands
// ---------------------------------------------------------------------------

export const DEPTH_PRESETS = ['quick', 'standard', 'deep', 'custom'] as const
export type DepthPreset = (typeof DEPTH_PRESETS)[number]

/** Question totals per preset; Custom sets per-stage counts (max {@link MAX_TOPIC_QUESTIONS}). */
export const QUESTION_DEPTH_TOTAL: Readonly<Record<Exclude<DepthPreset, 'custom'>, number>> = {
  quick: 15,
  standard: 30,
  deep: 60
}

export const MAX_TOPIC_QUESTIONS = 100
export const MAX_TOPIC_KEYWORDS = 500

export interface QuestionDepth {
  preset: DepthPreset
  /** Questions per stage. Sums to the preset total (or the Custom total, max 100). */
  perStage: Readonly<Record<TopicStage, number>>
}

/** Keyword expansion settings (Depth settings tab). */
export interface KeywordDepth {
  preset: DepthPreset
  /** Hard cap on the keyword list. Quick ≈30, Standard ≈120, Deep up to 500. */
  maxKeywords: number
  /** Synonyms kept per core term (each becomes a coverage group). */
  synonymsPerCoreTerm: number
  /**
   * Pattern variants expanded in code. `{X}` is a core term or synonym, `{segment}`
   * a buyer segment, e.g. "{X} service", "{X} for {segment}". A preset applies the
   * defaults; Custom applies these. The topic's own patterns are added to both.
   */
  patternVariants: readonly string[]
  /** Long-tail question keywords on or off. */
  longTailQuestions: boolean
  /** Intent families to build groups for. */
  intentFamilies: readonly KeywordIntentFamily[]
  /** Most keywords in one group. */
  perGroupCap: number
}

export interface TopicDepth {
  questions: QuestionDepth
  keywords: KeywordDepth
}

/** Target band in whole percent, lo ≤ hi. */
export interface TopicBand {
  lo: number
  hi: number
}

export interface TopicBands {
  questions: TopicBand
  keywords: TopicBand
}

export const DEFAULT_TOPIC_BANDS: TopicBands = {
  questions: { lo: 50, hi: 70 },
  keywords: { lo: 25, hi: 40 }
}

// ---------------------------------------------------------------------------
// Wizard draft
// ---------------------------------------------------------------------------

/** The three wizard paths. A page URL keeps the existing Add page flow. */
export const TOPIC_WIZARD_PATHS = ['seed', 'questions', 'competitor'] as const
export type TopicWizardPath = (typeof TOPIC_WIZARD_PATHS)[number]

/**
 * Wizard steps. Seed path: seed → profile → questions → keywords (only when
 * generating keywords) → pages → estimate. My own questions: import → cleanup →
 * pages → estimate. Competitor page: competitor → questions → pages → estimate.
 */
export const TOPIC_WIZARD_STEPS = [
  'seed',
  'profile',
  'questions',
  'keywords',
  'import',
  'cleanup',
  'competitor',
  'pages',
  'estimate'
] as const
export type TopicWizardStep = (typeof TOPIC_WIZARD_STEPS)[number]

/** One point of a buyer profile section, with its evidence ("Found in"). */
export interface TopicProfilePoint {
  id: string
  /** Same six parts as a page buyer profile. */
  section: TopicProfileSection
  text: string
  /** Evidence: a site path ("/use-cases/"), a page name ("FAQ") or null when unsourced. */
  foundIn: string | null
  /** A fact to re-check before relying on it, in plain words. Null when none. */
  verify: string | null
  /** True when this point is new in the current version ("New in v2"). */
  isNew: boolean
}

export const TOPIC_PROFILE_SECTIONS = [
  'who',
  'environment',
  'segments',
  'triggers',
  'values',
  'poor_fit'
] as const
export type TopicProfileSection = (typeof TOPIC_PROFILE_SECTIONS)[number]

export const TOPIC_PROFILE_SECTION_LABEL: Readonly<Record<TopicProfileSection, string>> = {
  who: 'Who they are',
  environment: 'Their environment',
  segments: 'Segments',
  triggers: 'Triggers',
  values: 'What they value',
  poor_fit: 'Poor fit'
}

export const TOPIC_PROFILE_SECTION_HINT: Readonly<Record<TopicProfileSection, string>> = {
  who: 'The people who type these questions',
  environment: 'Tools and places they work',
  segments: 'Teams this fits best',
  triggers: 'What makes them search now',
  values: 'What they care about, price included',
  poor_fit: 'Who this is not for'
}

/** One saved profile version (versions are kept; one is current). */
export interface TopicProfileVersion {
  version: number
  points: readonly TopicProfilePoint[]
  /** ISO-8601 UTC. */
  writtenAt: string
  /** Why this version exists. */
  note: 'written' | 'rewritten' | 'edited' | 'filled_gaps'
  /** Template that wrote it; null for a hand edit. */
  templateId: string | null
  templateName: string | null
  templateHash: string | null
}

export interface TopicProfileState {
  versions: readonly TopicProfileVersion[]
  /** The version in use. */
  current: number
}

/** A core term and its synonyms (Keywords step "Discover core terms & synonyms"). */
export interface KeywordCoreTerm {
  id: string
  term: string
  synonyms: readonly string[]
  /** True when the user kept it for expansion. */
  kept: boolean
}

/**
 * One question or keyword in the wizard. `id` is stable for the life of the
 * draft and becomes the prompt's stable key when the topic starts.
 */
export interface TopicDraftPrompt {
  id: string
  kind: TopicPromptKind
  text: string
  /** Journey stage; questions always have one after generation, keywords usually null. */
  stage: TopicStage | null
  source: TopicPromptSource
  /** e.g. "Sales call", "From their section: What are SMS alerts?". */
  sourceNote: string | null
  /** False leaves it out of the check ("In check" column). */
  included: boolean
  kwGroup: string | null
  kwGroupKind: KeywordGroupKind | null
  /** The intent family of an intent group. Null for coverage groups and questions. */
  kwFamily: KeywordIntentFamily | null
  intent: KeywordIntent | null
  funnel: FunnelStage | null
  pageType: PageType | null
  /** An own tracked page id, when the target is tracked. */
  targetPageId: string | null
  /** The target page URL (tracked page or sitemap entry). Null when there is none. */
  targetUrl: string | null
  /** 0–100. Null until matched. */
  matchConfidence: number | null
  matchReason: string | null
  /** The page CiteFox AI picked, even when too unsure to be the target. */
  aiPageUrl?: string | null
  /** Other own pages that may answer it; Google citing any counts as the right page. */
  alsoUrls?: readonly string[]
  matchStatus: TopicMatchStatus
  flags: readonly TopicPromptFlag[]
  /** Ids of draft prompts this one overlaps with. */
  overlapWith: readonly string[]
  /** Original lines merged into this one (import clean-up). */
  mergedFrom: readonly string[]
  /** Wording before the last Rewrite, for Undo. */
  previousText: string | null
}

/** Their page, read once (Jina or direct read, no search). */
export interface CompetitorPageRead {
  url: string
  domain: string
  ok: boolean
  title: string | null
  metaDescription: string | null
  h1: string | null
  /** H2/H3 headings in page order. */
  outline: readonly string[]
  faqCount: number
  wordCount: number
  /** ISO-8601 UTC. */
  readAt: string
  /** Plain words when the read failed. */
  message: string | null
}

/** "Claims you don't make": a claim on their page and whether your site makes it. */
export interface CompetitorClaim {
  id: string
  claim: string
  onYourSite: 'no' | 'partly' | 'yes'
  /** Their section the claim is in. */
  section: string | null
  /** The path of the business's own page that makes it too (yes or partly). Absent on older drafts. */
  yourEvidence?: string | null
}

/** Pasted text or CSV the user imported (My own questions). */
export interface TopicImportSource {
  pastedLines: number
  csvFileName: string | null
  csvRows: number
  /** Header names of the CSV columns used, e.g. ["question", "channel", "notes"]. */
  csvColumns: readonly string[]
}

/** Clean-up counts under the import grid. */
export interface TopicImportStats {
  lines: number
  kept: number
  duplicatesMerged: number
  brandFlagged: number
  shortFlagged: number
}

/**
 * The wizard's whole state, persisted in `topic_drafts` so it survives restarts.
 * Every AI suggestion is returned apart and only lands here through Apply
 * (`topics:updateDraft`), except the step's own primary action (Write buyer
 * profile, Write questions, Generate keywords, Match pages, Read their page).
 */
export interface TopicDraft {
  id: string
  projectId: string
  path: TopicWizardPath
  step: TopicWizardStep
  /** Set once started, or when editing an existing topic. */
  topicId: string | null
  name: string
  /** Problem statement in the buyer's words. */
  seed: string
  /** Other seeds offered on the Seed step. */
  otherSeeds: readonly string[]
  /** Bare domain; the project's domain by default. */
  website: string
  about: string
  generate: TopicGenerate
  depth: TopicDepth
  bands: TopicBands
  /** Markets to check; the project's default market by default. */
  marketIds: readonly string[]
  /** From the project, read only here. */
  brandNames: readonly string[]
  competitors: readonly string[]
  /** Segments picked for the profile (Seed step chips). */
  segments: readonly string[]
  /**
   * Options buyers switch from ("Use in buyer questions", Docs/FEEDBACK.md row 3), from
   * the project and the Seed step. Fed to the profile and journey questions, never
   * as competitors. Absent on drafts saved before it existed.
   */
  switchingFrom?: readonly string[]
  /** Integrations and tools buyers use with it ("Note as integration"). Absent as above. */
  integrations?: readonly string[]
  /**
   * The product this topic is about (Docs/PROMPT-AUDIT.md PC), picked on the Seed step.
   * Absent: automatic (inferred from the seed when read). Null: the whole business.
   */
  productId?: string | null
  profile: TopicProfileState | null
  /** Both kinds, questions first. Filter by `kind`. */
  prompts: readonly TopicDraftPrompt[]
  keywordTerms: readonly KeywordCoreTerm[]
  /**
   * Modifier patterns buyers of this category search ("{X} service", "free {X}"),
   * written with the core terms and applied by the coverage expansion on top of the
   * depth's patterns. Absent on drafts saved before it existed.
   */
  keywordPatterns?: readonly string[]
  importSource: TopicImportSource | null
  importStats: TopicImportStats | null
  competitorUrl: string | null
  competitorPage: CompetitorPageRead | null
  competitorClaims: readonly CompetitorClaim[]
  /** Re-check interval chosen on Estimate. */
  intervalDays: IntervalDays
  /** ISO-8601 UTC. */
  createdAt: string
  updatedAt: string
  /** ISO-8601 UTC when Start ran. */
  startedAt: string | null
}

/** A draft in the "continue where you left off" list. */
export interface TopicDraftSummary {
  id: string
  path: TopicWizardPath
  step: TopicWizardStep
  name: string
  topicId: string | null
  questions: number
  keywords: number
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Saved topics and results
// ---------------------------------------------------------------------------

/** Sidebar and Topics list row. */
export interface TopicSummary {
  id: string
  projectId: string
  name: string
  source: TopicSource
  status: 'not_tracked' | 'setting_up' | 'tracked' | 'paused' | 'removed'
  questions: number
  keywords: number
  /** Questions goal % in the default market (latest results). Null before a check. */
  questionsGoal: number | null
  keywordsGoal: number | null
  /**
   * The topic's headline in the default market: target page cited ÷ searches with an
   * AI Overview (questions and keywords, `targetRate`). Null before a check.
   */
  targetPct: number | null
  bands: TopicBands
  intervalDays: number
  /** ISO-8601 UTC of the latest finished check in any market. */
  checkedAt: string | null
  /** Batches still waiting in a "rest over 7 days" plan. */
  pendingBatches: number
}

/** Goal for one kind on one check: cited ÷ prompts with an AI Overview. */
export interface TopicGoal {
  kind: TopicPromptKind
  /** Prompts of this kind in the check (included). */
  prompts: number
  /** Prompts with a result (any state except not_checked). */
  checked: number
  /** Prompts that showed an AI Overview (the denominator). */
  withAio: number
  /** Own domain cited (right page or another own page). */
  cited: number
  rightPage: number
  otherPage: number
  /** Brand named in the overview. */
  named: number
  noAio: number
  /** Failed searches, named apart and left out of the goal. */
  failed: number
  notChecked: number
  /** cited ÷ withAio in whole percent; null when withAio is 0. */
  rate: number | null
  band: TopicBand
  /** Where the rate sits against the band. Null when rate is null. */
  bandState: 'below' | 'in' | 'above' | null
  /** More cited prompts needed to reach the band's lower edge (0 when there). */
  toReachBand: number
  /** Cited count needed at the band's lower edge (ceil(lo% × withAio)). */
  neededForBand: number
}

/** Win odds for one to-do row. */
export interface WinOdds {
  score: number
  level: WinOddsLevel
  /** One plain sentence: why the odds are what they are. */
  reason: string
}

/** One to-do / results row (one prompt in one market). */
export interface TopicResultRow {
  promptId: string
  /** Stable across prompt-set versions. */
  stableKey: string
  /** Q number in the kind's list ("Q6"); keywords are numbered apart. */
  number: number
  kind: TopicPromptKind
  text: string
  stage: TopicStage | null
  kwGroup: string | null
  kwGroupKind: KeywordGroupKind | null
  intent: KeywordIntent | null
  funnel: FunnelStage | null
  pageType: PageType | null
  state: TopicRowState
  targetPageId: string | null
  targetUrl: string | null
  matchConfidence: number | null
  matchReason: string | null
  /** The page CiteFox AI picked, even when too unsure to be the target. */
  aiPageUrl?: string | null
  /** Other own pages that may answer it; Google citing any counts as the right page. */
  alsoUrls?: readonly string[]
  /** True when the user set or confirmed the target. */
  targetConfirmed: boolean
  /** Own URL cited (target or another own page). Null when the own domain is not cited. */
  citedOwnUrl: string | null
  /** Domains cited instead (not own), in position order, at most 5. */
  citedInstead: readonly string[]
  /** Citation position of the own page, when cited. */
  position: number | null
  named: boolean | null
  /** A tracked competitor domain is cited and the own domain is not. */
  competitorCitedNotYou: boolean
  winOdds: WinOdds | null
  /** Run and time of the result this row reads; null when not checked. */
  runId: string | null
  checkedAt: string | null
  /** Short overview text, for the drawer. */
  aioSummary: string | null
  /**
   * While a check runs, a question it has not scored yet: `checking` is being searched
   * now, `waiting` comes later. Absent or null otherwise (`LiveRowState`).
   */
  live?: 'waiting' | 'checking' | null
}

/** One stage row of "By stage". */
export interface TopicStageCoverage {
  stage: TopicStage
  prompts: number
  withAio: number
  cited: number
  notCited: number
  noAio: number
  failed: number
  /** cited ÷ withAio, whole percent. */
  rate: number | null
  /** Prompt ids per bucket, for drills (lengths equal the counts). */
  citedIds: readonly string[]
  notCitedIds: readonly string[]
  noAioIds: readonly string[]
}

/** One row of a keyword universe table (by group, intent, funnel or page type). */
export interface KeywordUniverseRow {
  key: string
  label: string
  /** For "by group": coverage or intent. Null otherwise. */
  groupKind: KeywordGroupKind | null
  keywords: number
  aioShown: number
  youCited: number
  brandNamed: number
  /** youCited ÷ aioShown, whole percent. */
  citedRate: number | null
  promptIds: readonly string[]
  aioIds: readonly string[]
  citedIds: readonly string[]
  namedIds: readonly string[]
}

export interface KeywordUniverse {
  keywords: number
  aioShown: number
  youCited: number
  brandNamed: number
  citedRate: number | null
  byGroup: readonly KeywordUniverseRow[]
  byIntent: readonly KeywordUniverseRow[]
  byFunnel: readonly KeywordUniverseRow[]
  byPageType: readonly KeywordUniverseRow[]
  /** Groups where nothing is cited although overviews show. */
  groupsWithNoCitations: readonly string[]
}

/** One point on Progress (goal % per check, spaced by real dates). */
export interface TopicProgressPoint {
  runId: string
  /** ISO-8601 UTC. */
  finishedAt: string
  /** True when the run did not check every prompt (a batch); left out of the line. */
  partial: boolean
  questions: TopicGoalPoint | null
  keywords: TopicGoalPoint | null
  /** The headline: target page cited ÷ searches with an AI Overview (`targetPoint`). */
  target?: TopicGoalPoint | null
}

export interface TopicGoalPoint {
  withAio: number
  cited: number
  rate: number | null
}

/** One match-state group of the to-do grid. */
export interface TopicTodoGroup {
  state: MatchState
  label: string
  hint: string
  count: number
  promptIds: readonly string[]
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isTopicStage(value: string): value is TopicStage {
  return isOneOf(TOPIC_STAGES, value)
}

export function isTopicPromptKind(value: string): value is TopicPromptKind {
  return isOneOf(TOPIC_PROMPT_KINDS, value)
}

export function isTopicSource(value: string): value is TopicSource {
  return isOneOf(TOPIC_SOURCES, value)
}

export function isTopicPromptSource(value: string): value is TopicPromptSource {
  return isOneOf(TOPIC_PROMPT_SOURCES, value)
}

export function isTopicGenerate(value: string): value is TopicGenerate {
  return isOneOf(TOPIC_GENERATE, value)
}

export function isKeywordGroupKind(value: string): value is KeywordGroupKind {
  return isOneOf(KEYWORD_GROUP_KINDS, value)
}

export function isKeywordIntent(value: string): value is KeywordIntent {
  return isOneOf(KEYWORD_INTENTS, value)
}

export function isFunnelStage(value: string): value is FunnelStage {
  return isOneOf(FUNNEL_STAGES, value)
}

export function isPageType(value: string): value is PageType {
  return isOneOf(PAGE_TYPES, value)
}

export function isKeywordIntentFamily(value: string): value is KeywordIntentFamily {
  return isOneOf(KEYWORD_INTENT_FAMILIES, value)
}

export function isMatchState(value: string): value is MatchState {
  return isOneOf(MATCH_STATES, value)
}

export function isDepthPreset(value: string): value is DepthPreset {
  return isOneOf(DEPTH_PRESETS, value)
}

export function isTopicWizardPath(value: string): value is TopicWizardPath {
  return isOneOf(TOPIC_WIZARD_PATHS, value)
}

export function isTopicWizardStep(value: string): value is TopicWizardStep {
  return isOneOf(TOPIC_WIZARD_STEPS, value)
}

export function isTopicProfileSection(value: string): value is TopicProfileSection {
  return isOneOf(TOPIC_PROFILE_SECTIONS, value)
}

export function isTopicPromptFlag(value: string): value is TopicPromptFlag {
  return isOneOf(TOPIC_PROMPT_FLAGS, value)
}

export function isTopicMatchStatus(value: string): value is TopicMatchStatus {
  return isOneOf(MATCH_STATUSES, value)
}
