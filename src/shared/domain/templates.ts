/** Generation templates and the playground limits. */

import { isOneOf } from './one-of'
import type { TemplateSettings } from './template-kinds'

/**
 * Every editable Claude step. Run order and copy live in `template-kinds.ts`, keyed
 * by plain string, so adding a kind here is the whole change for it to list and edit.
 * `aio_gap` and `run_summary` are the check-report steps (section 9.1);
 * `brand_prompts` and `sentiment_claims` are the brand-sentiment steps (SRS 4.16, 9.1);
 * `video_brief` writes a community video brief (FR-18.4);
 * `answer_shape` classifies stored AI Overview text for reports (Docs/REPORT-SPEC.md section 9);
 * the `topic_*` kinds and `competitor_page_*` are the topic steps (Docs/TOPICS-SPEC.md section 6).
 *
 * The prompt audit (Docs/PROMPT-AUDIT.md, package P0) registers the split kinds ahead
 * of the packages that write them: `coverage_matrix`, `page_audit`, `coverage_fixes`,
 * `sentiment_claims_v2`, `sentiment_fact_check` and the new topic kinds. Until their
 * package ships a body they are planned (`PLANNED_TEMPLATE_KINDS` in `template-kinds.ts`):
 * hidden from the Templates screen and never run. The combined kinds they replace stay
 * in this list so old project versions still load (rule 6, retired kinds).
 */
export const GENERATION_TEMPLATE_KINDS = [
  'buyer_profile',
  'buyer_prompts',
  'brand_prompts',
  'coverage',
  'coverage_matrix',
  'page_audit',
  'coverage_fixes',
  'aio_gap',
  'answer_shape',
  'sentiment_claims',
  'sentiment_claims_v2',
  'sentiment_fact_check',
  'video_brief',
  'run_summary',
  'topic_seed_discover',
  'topic_buyer_profile',
  'topic_profile_discover',
  'topic_profile_discover_v2',
  'topic_profile_rewrite',
  'topic_journey_questions',
  'topic_questions_discover',
  'topic_keyword_terms',
  'topic_keyword_expand',
  'topic_keyword_competitor',
  'topic_page_match',
  'topic_page_brief',
  'topic_target_suggest',
  'topic_questions_cleanup',
  'competitor_page_questions',
  'competitor_page_questions_v2',
  'competitor_page_claims',
  'topic_summary',
  'topic_next_actions',
  'topic_why_not_cited',
  'topic_explain_citation',
  'topic_citation_diagnosis',
  'topic_fix_draft',
  'topic_page_edit',
  'topic_owner_why',
  'topic_cluster_suggest',
  'topic_cluster_sort',
  'topic_cluster_name',
  // Ask CiteFox (`assistant-templates.ts`): one single-purpose prompt per kind of question.
  'assistant_explain',
  'assistant_why_not_cited',
  'assistant_next_steps',
  'assistant_draft',
  'assistant_questions',
  'assistant_changes',
  'assistant_summary',
  'assistant_help'
] as const

export type GenerationTemplateKind = (typeof GENERATION_TEMPLATE_KINDS)[number]

/**
 * Variables a generation template may use.
 * Written as `{{ url }}`, `{{ title }}`, and so on (see `template-syntax.ts`).
 * Whitespace around the name is optional. An unknown name warns on save.
 * A syntax error, a tag, or a filter fails the call.
 * `outline`, `faqs`, and `last_modified` are readable text built from the snapshot.
 * The brand-sentiment templates also read `competitors`, `market`, `market_language`,
 * `buyer_values`, `prompt`, `aio_text`, `aio_references`, `brand_facts`, and `own_pages`.
 * The answer-shape template reads `prompt_text` and `overview_text`.
 * The `*_block`, `stage_rules`, `mode_rules` and `evidence` names are context blocks
 * built in code by `src/main/prompts/blocks.ts`, so the rules stay in one place and the
 * template stays editable.
 */
export const TEMPLATE_VARIABLES = [
  'url',
  'title',
  'meta_description',
  'h1',
  'page_text',
  'brand_name',
  'prompt_count',
  'outline',
  'faqs',
  'last_modified',
  'competitors',
  'market',
  'market_language',
  'buyer_values',
  'prompt',
  'aio_text',
  'aio_references',
  'brand_facts',
  'own_pages',
  // Used by answer_shape: the buyer prompt and the stored AI Overview text.
  'prompt_text',
  'overview_text',
  // Context blocks built in code (`src/main/prompts/blocks.ts`, Docs/PROMPT-AUDIT.md section 3).
  'business_block',
  'product_block',
  'market_block',
  'buyer_block',
  'competitor_block',
  'stage_rules',
  'mode_rules',
  'evidence'
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

/**
 * Unsaved playground runs kept in memory.
 * The engine drops the oldest when a new run would make 21, and drops all of them on quit.
 * A playground compare stores one entry per template, and each of those counts toward this cap.
 */
export const PLAYGROUND_MEMORY_RUNS = 20

/** `playground:run` accepts at most this many templates in `templateIds`. */
export const PLAYGROUND_COMPARE_LIMIT = 3

/** The one shipped template of each kind is named this. The name is read-only. */
export const SHIPPED_TEMPLATE_NAME = 'CiteFox default'

/** A template name is 1 to 80 characters and unique per kind, compared case-insensitively. */
export const TEMPLATE_NAME_MIN_LENGTH = 1

export const TEMPLATE_NAME_MAX_LENGTH = 80

/** `notes` is null or a string of at most this many characters. */
export const TEMPLATE_NOTES_MAX_LENGTH = 500

/**
 * One named generation template.
 * Each kind has many of these. Exactly one per kind is shipped, and exactly one per kind
 * is the default. The default is app-wide (FR-10.2). A project may override a step with
 * its own versions (FR-26.8, `TemplateStep.override`).
 *
 * `variables` lists supported names that occur in `body`, written `{{ url }}` and so on.
 * `warnings` lists unknown `{{ name }}` tokens in `body`. They are not errors.
 * `templateHash` is the lowercase SHA-256 hex of `body`.
 * `updatedAt` is null until the template changes after it is created.
 * An app upgrade may replace a shipped template's body in place. That updates `templateHash`
 * and `updatedAt` on that shipped row only. User copies are never changed by an upgrade.
 */
export interface GenerationTemplate {
  id: string
  kind: GenerationTemplateKind
  /**
   * 1 to {@link TEMPLATE_NAME_MAX_LENGTH} characters.
   * Unique among live templates of this kind. The comparison is case-insensitive.
   * The shipped template's name is {@link SHIPPED_TEMPLATE_NAME}.
   */
  name: string
  /** Null when the user left notes empty. At most {@link TEMPLATE_NOTES_MAX_LENGTH} characters. */
  notes: string | null
  body: string
  /**
   * True for the one shipped template of this kind.
   * Update and delete reject it. An app upgrade may still replace its body in place.
   */
  isShipped: boolean
  /**
   * True for the one default template of this kind.
   * The default is app-wide. It starts as the shipped template.
   * A deleted template is never the default.
   */
  isDefault: boolean
  /** Lowercase SHA-256 hex of `body`. */
  templateHash: string
  /** ISO-8601 UTC. */
  createdAt: string
  /**
   * ISO-8601 UTC of the last change after creation.
   * Null until then. An upgrade that replaces a shipped body sets this on that shipped row.
   */
  updatedAt: string | null
  /**
   * Stored row version. A new template, including a duplicate, starts at 1.
   * `templates:update` adds 1. Delete and restore leave it unchanged.
   */
  version: number
  /** ISO-8601 UTC when soft-deleted. Null while the template is live. */
  deletedAt: string | null
  /** Supported names that occur in `body`, for this kind (`templateVariablesFor`). */
  variables: readonly string[]
  warnings: readonly TemplateVariableWarning[]
  /** FR-26.3. Stored in `settings_json`. Null fields use the default. */
  settings: TemplateSettings
}

/** A `{{ name }}` in a template body that is not in {@link TEMPLATE_VARIABLES}. */
export interface TemplateVariableWarning {
  /** The identifier inside the braces, without the braces or the whitespace. */
  name: string
  message: string
}

export function isGenerationTemplateKind(value: string): value is GenerationTemplateKind {
  return isOneOf(GENERATION_TEMPLATE_KINDS, value)
}

export function isTemplateVariable(value: string): value is TemplateVariable {
  return isOneOf(TEMPLATE_VARIABLES, value)
}
