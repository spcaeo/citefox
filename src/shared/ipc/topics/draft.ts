import type {
  FunnelStage,
  IntervalDays,
  KeywordCoreTerm,
  KeywordDepth,
  KeywordGroupKind,
  KeywordIntent,
  KeywordIntentFamily,
  PageType,
  QuestionDepth,
  TopicBands,
  TopicDraftSummary,
  TopicGenerate,
  TopicProfileSection,
  TopicPromptKind,
  TopicPromptSource,
  TopicStage,
  TopicWizardPath,
  TopicWizardStep
} from '../../domain'

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
