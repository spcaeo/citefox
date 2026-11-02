import {
  TOPIC_TEMPLATE_KINDS as TOPIC_TEMPLATE_KIND_LIST,
  type TopicTemplateKind
} from '@shared/domain'
import {
  COMPETITOR_PAGE_CLAIMS_TEMPLATE,
  COMPETITOR_PAGE_QUESTIONS_TEMPLATE,
  COMPETITOR_PAGE_QUESTIONS_V2_TEMPLATE
} from './bodies/competitor'
import {
  TOPIC_CLUSTER_NAME_TEMPLATE,
  TOPIC_CLUSTER_SORT_TEMPLATE,
  TOPIC_CLUSTER_SUGGEST_TEMPLATE
} from './bodies/clusters'
import { TOPIC_SEED_DISCOVER_TEMPLATE } from './bodies/discover'
import {
  TOPIC_CITATION_DIAGNOSIS_TEMPLATE,
  TOPIC_EXPLAIN_CITATION_TEMPLATE,
  TOPIC_FIX_DRAFT_TEMPLATE,
  TOPIC_NEXT_ACTIONS_TEMPLATE,
  TOPIC_SUMMARY_TEMPLATE,
  TOPIC_WHY_NOT_CITED_TEMPLATE
} from './bodies/insights'
import { TOPIC_OWNER_WHY_TEMPLATE } from './bodies/owner-why'
import { TOPIC_PAGE_EDIT_TEMPLATE } from './bodies/page-edit'
import {
  TOPIC_JOURNEY_QUESTIONS_TEMPLATE,
  TOPIC_QUESTIONS_CLEANUP_TEMPLATE,
  TOPIC_QUESTIONS_DISCOVER_TEMPLATE
} from './bodies/journey'
import {
  TOPIC_KEYWORD_COMPETITOR_TEMPLATE,
  TOPIC_KEYWORD_EXPAND_TEMPLATE,
  TOPIC_KEYWORD_TERMS_TEMPLATE
} from './bodies/keywords'
import {
  TOPIC_PAGE_BRIEF_TEMPLATE,
  TOPIC_PAGE_MATCH_TEMPLATE,
  TOPIC_TARGET_SUGGEST_TEMPLATE
} from './bodies/pages'
import {
  TOPIC_BUYER_PROFILE_TEMPLATE,
  TOPIC_PROFILE_DISCOVER_TEMPLATE,
  TOPIC_PROFILE_DISCOVER_V2_TEMPLATE,
  TOPIC_PROFILE_REWRITE_TEMPLATE
} from './bodies/profile'
import {
  COMPETITOR_PAGE_CLAIMS_SCHEMA,
  COMPETITOR_PAGE_QUESTIONS_SCHEMA,
  COMPETITOR_PAGE_QUESTIONS_V2_SCHEMA
} from './schemas/competitor'
import {
  TOPIC_CLUSTER_NAME_SCHEMA,
  TOPIC_CLUSTER_SORT_SCHEMA,
  TOPIC_CLUSTER_SUGGEST_SCHEMA
} from './schemas/clusters'
import { TOPIC_SEED_DISCOVER_SCHEMA } from './schemas/discover'
import {
  TOPIC_CITATION_DIAGNOSIS_SCHEMA,
  TOPIC_EXPLAIN_CITATION_SCHEMA,
  TOPIC_FIX_DRAFT_SCHEMA,
  TOPIC_NEXT_ACTIONS_SCHEMA,
  TOPIC_OWNER_WHY_SCHEMA,
  TOPIC_PAGE_EDIT_SCHEMA,
  TOPIC_SUMMARY_SCHEMA,
  TOPIC_WHY_NOT_CITED_SCHEMA
} from './schemas/insights'
import {
  TOPIC_JOURNEY_QUESTIONS_SCHEMA,
  TOPIC_QUESTIONS_CLEANUP_SCHEMA,
  TOPIC_QUESTIONS_DISCOVER_SCHEMA
} from './schemas/journey'
import {
  TOPIC_KEYWORD_COMPETITOR_SCHEMA,
  TOPIC_KEYWORD_EXPAND_SCHEMA,
  TOPIC_KEYWORD_TERMS_SCHEMA
} from './schemas/keywords'
import {
  TOPIC_PAGE_BRIEF_SCHEMA,
  TOPIC_PAGE_MATCH_SCHEMA,
  TOPIC_TARGET_SUGGEST_SCHEMA
} from './schemas/pages'
import {
  TOPIC_BUYER_PROFILE_SCHEMA,
  TOPIC_PROFILE_DISCOVER_SCHEMA,
  TOPIC_PROFILE_DISCOVER_V2_SCHEMA,
  TOPIC_PROFILE_REWRITE_SCHEMA
} from './schemas/profile'

/**
 * The topic template kinds (Docs/TOPICS-SPEC.md section 6), their shipped
 * bodies and output schemas. They seed through the shared template system
 * (`SHIPPED`), so each is versioned, overridable per project and logged in
 * `llm_calls` like every other step.
 *
 * Bodies live in `./bodies/*` and schemas in `./schemas/*`, one file per package
 * of the prompt audit (Docs/PROMPT-AUDIT.md, P0). This file only assembles them.
 */

export const TOPIC_SCHEMAS: Readonly<Record<TopicTemplateKind, Record<string, unknown>>> = {
  topic_seed_discover: TOPIC_SEED_DISCOVER_SCHEMA,
  topic_buyer_profile: TOPIC_BUYER_PROFILE_SCHEMA,
  topic_profile_discover: TOPIC_PROFILE_DISCOVER_SCHEMA,
  topic_profile_discover_v2: TOPIC_PROFILE_DISCOVER_V2_SCHEMA,
  topic_profile_rewrite: TOPIC_PROFILE_REWRITE_SCHEMA,
  topic_journey_questions: TOPIC_JOURNEY_QUESTIONS_SCHEMA,
  topic_questions_discover: TOPIC_QUESTIONS_DISCOVER_SCHEMA,
  topic_keyword_terms: TOPIC_KEYWORD_TERMS_SCHEMA,
  topic_keyword_expand: TOPIC_KEYWORD_EXPAND_SCHEMA,
  topic_keyword_competitor: TOPIC_KEYWORD_COMPETITOR_SCHEMA,
  topic_page_match: TOPIC_PAGE_MATCH_SCHEMA,
  topic_page_brief: TOPIC_PAGE_BRIEF_SCHEMA,
  topic_target_suggest: TOPIC_TARGET_SUGGEST_SCHEMA,
  topic_questions_cleanup: TOPIC_QUESTIONS_CLEANUP_SCHEMA,
  competitor_page_questions: COMPETITOR_PAGE_QUESTIONS_SCHEMA,
  competitor_page_questions_v2: COMPETITOR_PAGE_QUESTIONS_V2_SCHEMA,
  competitor_page_claims: COMPETITOR_PAGE_CLAIMS_SCHEMA,
  topic_summary: TOPIC_SUMMARY_SCHEMA,
  topic_next_actions: TOPIC_NEXT_ACTIONS_SCHEMA,
  topic_why_not_cited: TOPIC_WHY_NOT_CITED_SCHEMA,
  topic_explain_citation: TOPIC_EXPLAIN_CITATION_SCHEMA,
  topic_citation_diagnosis: TOPIC_CITATION_DIAGNOSIS_SCHEMA,
  topic_fix_draft: TOPIC_FIX_DRAFT_SCHEMA,
  topic_page_edit: TOPIC_PAGE_EDIT_SCHEMA,
  topic_owner_why: TOPIC_OWNER_WHY_SCHEMA,
  topic_cluster_suggest: TOPIC_CLUSTER_SUGGEST_SCHEMA,
  topic_cluster_sort: TOPIC_CLUSTER_SORT_SCHEMA,
  topic_cluster_name: TOPIC_CLUSTER_NAME_SCHEMA
}

export const TOPIC_TEMPLATE_BODIES: Readonly<Record<TopicTemplateKind, string>> = {
  topic_seed_discover: TOPIC_SEED_DISCOVER_TEMPLATE,
  topic_buyer_profile: TOPIC_BUYER_PROFILE_TEMPLATE,
  topic_profile_discover: TOPIC_PROFILE_DISCOVER_TEMPLATE,
  topic_profile_discover_v2: TOPIC_PROFILE_DISCOVER_V2_TEMPLATE,
  topic_profile_rewrite: TOPIC_PROFILE_REWRITE_TEMPLATE,
  topic_journey_questions: TOPIC_JOURNEY_QUESTIONS_TEMPLATE,
  topic_questions_discover: TOPIC_QUESTIONS_DISCOVER_TEMPLATE,
  topic_keyword_terms: TOPIC_KEYWORD_TERMS_TEMPLATE,
  topic_keyword_expand: TOPIC_KEYWORD_EXPAND_TEMPLATE,
  topic_keyword_competitor: TOPIC_KEYWORD_COMPETITOR_TEMPLATE,
  topic_page_match: TOPIC_PAGE_MATCH_TEMPLATE,
  topic_page_brief: TOPIC_PAGE_BRIEF_TEMPLATE,
  topic_target_suggest: TOPIC_TARGET_SUGGEST_TEMPLATE,
  topic_questions_cleanup: TOPIC_QUESTIONS_CLEANUP_TEMPLATE,
  competitor_page_questions: COMPETITOR_PAGE_QUESTIONS_TEMPLATE,
  competitor_page_questions_v2: COMPETITOR_PAGE_QUESTIONS_V2_TEMPLATE,
  competitor_page_claims: COMPETITOR_PAGE_CLAIMS_TEMPLATE,
  topic_summary: TOPIC_SUMMARY_TEMPLATE,
  topic_next_actions: TOPIC_NEXT_ACTIONS_TEMPLATE,
  topic_why_not_cited: TOPIC_WHY_NOT_CITED_TEMPLATE,
  topic_explain_citation: TOPIC_EXPLAIN_CITATION_TEMPLATE,
  topic_citation_diagnosis: TOPIC_CITATION_DIAGNOSIS_TEMPLATE,
  topic_fix_draft: TOPIC_FIX_DRAFT_TEMPLATE,
  topic_page_edit: TOPIC_PAGE_EDIT_TEMPLATE,
  topic_owner_why: TOPIC_OWNER_WHY_TEMPLATE,
  topic_cluster_suggest: TOPIC_CLUSTER_SUGGEST_TEMPLATE,
  topic_cluster_sort: TOPIC_CLUSTER_SORT_TEMPLATE,
  topic_cluster_name: TOPIC_CLUSTER_NAME_TEMPLATE
}

/** Rows for the shared `SHIPPED` list: one `CiteFox default` per topic kind. */
export const TOPIC_SHIPPED_TEMPLATES = TOPIC_TEMPLATE_KIND_LIST.map((kind) => ({
  id: topicTemplateId(kind),
  kind,
  body: TOPIC_TEMPLATE_BODIES[kind],
  schema: TOPIC_SCHEMAS[kind]
}))

/** Shipped template ids, `tpl-topic-seed-discover` style. */
export function topicTemplateId(kind: TopicTemplateKind): string {
  return `tpl-${kind.replace(/_/g, '-')}`
}

export {
  TOPIC_EXPECTED_SECONDS,
  TOPIC_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_VARIABLES,
  type TopicTemplateKind
} from '@shared/domain'
