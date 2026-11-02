/**
 * Shipped `CiteFox default` bodies for the topic steps (Docs/TOPICS-SPEC.md
 * section 6). Each body starts with its `Template:` line so the e2e Claude
 * stand-in can route it. `{{ name }}` only (see `@shared/template-syntax`).
 * Every output is JSON checked against the step's schema; questions and
 * keywords are checked again in code for the brand and its aliases.
 * Steps that suggest or use competitors share the rules in `competitor-rules.ts`.
 *
 * The bodies live in `./bodies/*`, one file per package of the prompt audit
 * (Docs/PROMPT-AUDIT.md, P0), so packages never edit the same file. This file
 * re-exports them so existing imports keep working.
 */

export { TOPIC_SEED_DISCOVER_TEMPLATE } from './bodies/discover'
export {
  TOPIC_BUYER_PROFILE_TEMPLATE,
  TOPIC_PROFILE_DISCOVER_TEMPLATE,
  TOPIC_PROFILE_DISCOVER_V2_TEMPLATE,
  TOPIC_PROFILE_REWRITE_TEMPLATE
} from './bodies/profile'
export {
  TOPIC_JOURNEY_QUESTIONS_TEMPLATE,
  TOPIC_QUESTIONS_DISCOVER_TEMPLATE,
  TOPIC_QUESTIONS_CLEANUP_TEMPLATE
} from './bodies/journey'
export {
  TOPIC_KEYWORD_TERMS_TEMPLATE,
  TOPIC_KEYWORD_EXPAND_TEMPLATE,
  TOPIC_KEYWORD_COMPETITOR_TEMPLATE
} from './bodies/keywords'
export {
  COMPETITOR_PAGE_QUESTIONS_TEMPLATE,
  COMPETITOR_PAGE_QUESTIONS_V2_TEMPLATE,
  COMPETITOR_PAGE_CLAIMS_TEMPLATE
} from './bodies/competitor'
export { TOPIC_PAGE_MATCH_TEMPLATE, TOPIC_PAGE_BRIEF_TEMPLATE } from './bodies/pages'
export {
  TOPIC_SUMMARY_TEMPLATE,
  TOPIC_WHY_NOT_CITED_TEMPLATE,
  TOPIC_EXPLAIN_CITATION_TEMPLATE,
  TOPIC_NEXT_ACTIONS_TEMPLATE,
  TOPIC_CITATION_DIAGNOSIS_TEMPLATE,
  TOPIC_FIX_DRAFT_TEMPLATE
} from './bodies/insights'
export { TOPIC_RULES } from './bodies/shared'
