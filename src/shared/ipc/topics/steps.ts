import type {
  FunnelStage,
  KeywordCoreTerm,
  KeywordGroupKind,
  KeywordIntent,
  KeywordIntentFamily,
  PageType,
  TopicDraft,
  TopicDraftPrompt,
  TopicProfileSection,
  TopicPromptKind,
  TopicStage
} from '../../domain'
import type { CompanySuggestion, ProductSuggestion } from '../projects'
import type { TopicCallInfo } from './types'

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
