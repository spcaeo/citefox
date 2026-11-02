import type {
  CitationClass,
  CitationSourceType,
  CoverageAction,
  CoverageFindingKind,
  CoverageLevel,
  IntentStage,
  PromptCheckStatus,
  PromptSource,
  ReportSectionId
} from '@shared/domain'

/**
 * Enum value lists for the export schemas. Each comes from a `Record<Type, true>`, so a
 * value added to the shared type fails `npm run typecheck` until it is listed here.
 */
function keys<T extends string>(record: Record<T, true>): readonly T[] {
  return Object.keys(record) as T[]
}

export const INTENT_STAGE_VALUES = keys<IntentStage>({
  problem: true,
  solution: true,
  comparison: true,
  objection: true,
  trigger: true,
  unset: true
})

export const PROMPT_SOURCE_VALUES = keys<PromptSource>({
  title_meta_h1: true,
  trigger_event: true,
  objection: true,
  detail_check: true,
  written_by_user: true
})

export const PROMPT_STATUS_VALUES = keys<PromptCheckStatus>({
  page_cited: true,
  other_own_page: true,
  brand_mentioned: true,
  not_cited: true,
  no_aio: true,
  error: true
})

export const CITATION_CLASS_VALUES = keys<CitationClass>({
  target: true,
  own: true,
  competitor: true,
  other: true
})

export const CITATION_SOURCE_TYPE_VALUES = keys<CitationSourceType>({
  web: true,
  reddit: true,
  youtube: true,
  linkedin: true,
  review: true,
  forum: true,
  other: true
})

export const COVERAGE_LEVEL_VALUES = keys<CoverageLevel>({
  strong: true,
  partial: true,
  weak: true,
  none: true
})

export const COVERAGE_ACTION_VALUES = keys<CoverageAction>({
  update_existing: true,
  new_faq: true,
  small_update: true,
  optional_faq: true,
  none: true
})

export const COVERAGE_FINDING_VALUES = keys<CoverageFindingKind>({
  factual_claim: true,
  missing_promised_section: true,
  typo: true,
  title_length: true,
  title_meta_mismatch: true,
  other: true
})

export const REPORT_SECTION_VALUES = keys<ReportSectionId>({
  overview: true,
  topic_coverage: true,
  pages: true,
  competition: true,
  reputation: true,
  trends: true,
  universe: true,
  sources: true,
  answer_shape: true,
  content_gaps: true,
  prompts: true
})
