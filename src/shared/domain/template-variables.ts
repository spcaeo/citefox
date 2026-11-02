/**
 * The variables each Claude step may use, with what each holds (FR-26.2).
 * Page-setup steps use flat names (`{{ title }}`). Check steps read grouped
 * names (`{{ page.title }}`, `{{ run.page_cited }}`). A kind this module does not
 * know accepts both lists, so its editor never warns on a name its step fills.
 */

import { TEMPLATE_VARIABLES, type TemplateVariable } from './templates'
import { ASSISTANT_TEMPLATE_VARIABLES } from './assistant-templates'
import { TOPIC_TEMPLATE_VARIABLES } from './topic-templates'

export interface TemplateVariableHelp {
  name: string
  holds: string
}

/** What each flat page-setup variable holds. */
export const PAGE_VARIABLE_HELP: Readonly<Record<TemplateVariable, string>> = {
  url: 'The page address, read live when the template runs',
  title: "The page's title tag",
  meta_description: 'The meta description',
  h1: 'The H1 heading',
  page_text: 'Main text, without menus and footers',
  brand_name: 'The brand name for this run',
  prompt_count: 'How many prompts to write',
  outline: 'The H2 and H3 headings, in page order',
  faqs: 'The FAQ questions and answers on the page',
  last_modified: 'When the page says it was last updated',
  competitors: 'The competitors listed on the project',
  market: 'The market: country, city and device',
  market_language: "The market's language",
  buyer_values: 'What the buyer profile says they value',
  prompt: 'The prompt Google answered',
  aio_text: 'The AI Overview text, word for word',
  aio_references: 'The sources the overview cites, numbered',
  brand_facts: 'Your brand facts, one per line',
  own_pages: 'Text from your tracked pages, to check claims against',
  prompt_text: 'The buyer prompt Google answered',
  overview_text: 'The stored AI Overview text, word for word',
  business_block: 'The business: domain, one-line summary and brand names to leave out',
  product_block: "The page's product: name, job and buyer, or a note that none is set",
  market_block: 'The market (country, language, city) and the language to write in',
  buyer_block: 'A compact buyer profile: who, environment and triggers',
  competitor_block:
    "The product's direct and partial competitors, what buyers switch from, and tools used with it",
  stage_rules: 'Definitions of the stages this step writes',
  mode_rules: 'The rules for the chosen action only',
  evidence: 'Your own pages most related to this step, fenced as data'
}

/** Grouped names the check steps (`aio_gap`, `run_summary`) are filled with. */
export const CHECK_VARIABLES: readonly TemplateVariableHelp[] = [
  { name: 'page.url', holds: 'The page address' },
  { name: 'page.title', holds: "The page's title tag, from the snapshot the check used" },
  { name: 'page.meta_description', holds: 'The meta description' },
  { name: 'page.h1', holds: 'The H1 heading' },
  { name: 'page.body', holds: 'Main text of the snapshot, without menus and footers' },
  { name: 'market.country', holds: 'Country of the market that was checked' },
  { name: 'market.language', holds: 'Language of that market' },
  { name: 'market.location', holds: 'City or region, if the market has one' },
  { name: 'market.device', holds: 'Desktop or mobile' },
  {
    name: 'icp',
    holds: 'The buyer profile: who, environment, segments, triggers, values, poor fit'
  },
  { name: 'brand_names', holds: 'Your brand names' },
  { name: 'product', holds: "The page's product: name, job and buyer, or a note that none is set" },
  {
    name: 'competitors',
    holds: "The page product's direct and partial competitors, with their domains"
  },
  { name: 'count', holds: 'How many prompts were checked' },
  {
    name: 'prompts',
    holds:
      'The prompts that were checked, each with its status, the sources its overview cites and what the overview states that the page does not'
  },
  { name: 'aio.prompt', holds: 'The buyer prompt being analysed' },
  { name: 'aio.text', holds: 'Full text of the AI Overview' },
  { name: 'aio.references', holds: 'Sources the AI Overview cites, in order' },
  { name: 'aio.status', holds: "This page's status for the prompt" },
  { name: 'run.aios_shown', holds: 'Prompts that showed an AI Overview in this check' },
  { name: 'run.page_cited', holds: 'Prompts where this page was cited' },
  { name: 'run.other_own_page', holds: 'Prompts where another page of yours was cited' },
  { name: 'run.named_without_link', holds: 'Prompts that named your brand without a link' },
  { name: 'run.invisible', holds: 'Prompts with an overview that left you out' },
  { name: 'run.previous_page_cited', holds: 'Page cited on the previous check' },
  { name: 'run.baseline_page_cited', holds: 'Page cited on the baseline check' },
  { name: 'run.content_changed', holds: 'Yes when the page changed since the previous check' },
  { name: 'run.content_change', holds: 'What changed on the page, in a sentence' },
  { name: 'notes', holds: 'Your notes between the two checks' }
]

function flat(names: readonly TemplateVariable[]): readonly TemplateVariableHelp[] {
  return names.map((name) => ({ name, holds: PAGE_VARIABLE_HELP[name] }))
}

/** The page-setup steps' names (buyer profile, buyer prompts, content gaps). */
const PAGE_VARIABLES = flat([
  'url',
  'title',
  'meta_description',
  'h1',
  'page_text',
  'brand_name',
  'prompt_count',
  'outline',
  'faqs',
  'last_modified'
])

/** The buyer profile: the page plus the business, its product and the market (P1). */
const BUYER_PROFILE_VARIABLES = [
  ...PAGE_VARIABLES,
  ...flat(['business_block', 'product_block', 'market_block'])
]

/** Buyer prompts: the profile's blocks plus the page's competitors (P1). */
const BUYER_PROMPT_VARIABLES = [...BUYER_PROFILE_VARIABLES, ...flat(['competitor_block'])]

/** The page audit and the fixes write in the market's language (P1). */
const PAGE_AUDIT_VARIABLES = [...PAGE_VARIABLES, ...flat(['market_block'])]

const COVERAGE_FIX_VARIABLES = [...PAGE_VARIABLES, ...flat(['business_block', 'market_block'])]

/** Every flat name, for a kind this module does not know. */
const ALL_FLAT_VARIABLES = flat(TEMPLATE_VARIABLES)

/** Brand-sentiment steps (SRS 4.16, section 9.1). */
const BRAND_PROMPT_VARIABLES = flat([
  'url',
  'title',
  'brand_name',
  'competitors',
  'market',
  'market_language',
  'buyer_values',
  'prompt_count',
  'product_block',
  'market_block'
])

const SENTIMENT_CLAIM_VARIABLES = flat([
  'url',
  'title',
  'brand_name',
  'competitors',
  'market',
  'market_language',
  'prompt',
  'aio_text',
  'aio_references',
  'brand_facts',
  'own_pages'
])

/** Claims only (Docs/PROMPT-AUDIT.md, P6): no brand facts or own pages. */
const SENTIMENT_CLAIM_V2_VARIABLES = flat([
  'url',
  'title',
  'brand_name',
  'market',
  'market_language',
  'prompt',
  'aio_text',
  'aio_references',
  'competitor_block'
])

/** The fact check of the claims about the brand (Docs/PROMPT-AUDIT.md, P6). */
const SENTIMENT_FACT_CHECK_VARIABLES: readonly TemplateVariableHelp[] = [
  ...flat(['brand_name', 'market_language']),
  { name: 'claims', holds: 'The claims about your brand, numbered from 0' },
  ...flat(['brand_facts', 'own_pages'])
]

/** The answer-shape step reads stored overview text only (Docs/REPORT-SPEC.md section 9). */
const ANSWER_SHAPE_VARIABLES = flat(['prompt_text', 'overview_text'])

/** What the community video brief step fills (FR-18.4). */
export const VIDEO_BRIEF_VARIABLES: readonly TemplateVariableHelp[] = [
  { name: 'question', holds: 'The question AI Overviews answer with videos' },
  { name: 'related_prompts', holds: 'Related prompts with an overview, one per line' },
  { name: 'markets', holds: 'Markets where the question was checked' },
  { name: 'brand_names', holds: 'Your brand names' },
  { name: 'videos_cited', holds: 'Videos the overviews cite now' },
  { name: 'page_url', holds: 'The page the video should link to' },
  { name: 'page_title', holds: "That page's title tag" },
  { name: 'page_h1', holds: "That page's H1 heading" },
  { name: 'page_sections', holds: "That page's headings and FAQ questions" },
  { name: 'page_text', holds: "That page's main text, fenced as data" },
  { name: 'product_block', holds: PAGE_VARIABLE_HELP.product_block },
  { name: 'buyer_block', holds: PAGE_VARIABLE_HELP.buyer_block }
]

const CHECK_KINDS: readonly string[] = ['aio_gap', 'run_summary']

const KIND_VARIABLES: Readonly<Record<string, readonly TemplateVariableHelp[]>> = {
  // A live step lists a context block (`business_block` and the rest) only once its
  // package fills it (Docs/PROMPT-AUDIT.md); the planned steps list theirs already.
  buyer_profile: BUYER_PROFILE_VARIABLES,
  buyer_prompts: BUYER_PROMPT_VARIABLES,
  coverage: PAGE_VARIABLES,
  coverage_matrix: PAGE_VARIABLES,
  page_audit: PAGE_AUDIT_VARIABLES,
  coverage_fixes: COVERAGE_FIX_VARIABLES,
  brand_prompts: BRAND_PROMPT_VARIABLES,
  answer_shape: ANSWER_SHAPE_VARIABLES,
  sentiment_claims: SENTIMENT_CLAIM_VARIABLES,
  sentiment_claims_v2: SENTIMENT_CLAIM_V2_VARIABLES,
  sentiment_fact_check: SENTIMENT_FACT_CHECK_VARIABLES,
  video_brief: VIDEO_BRIEF_VARIABLES,
  ...TOPIC_TEMPLATE_VARIABLES,
  ...ASSISTANT_TEMPLATE_VARIABLES
}

/** The variables shown for a kind, in the order the editor lists them. */
export function templateVariablesFor(kind: string): readonly TemplateVariableHelp[] {
  if (CHECK_KINDS.includes(kind)) return CHECK_VARIABLES
  const known = KIND_VARIABLES[kind]
  if (known !== undefined) return known
  return [...ALL_FLAT_VARIABLES, ...CHECK_VARIABLES]
}

/** True when a kind's step fills `name`. */
export function isVariableForKind(kind: string, name: string): boolean {
  return templateVariablesFor(kind).some((item) => item.name === name)
}

/** True when the step renders grouped names such as `page.url` (the check steps). */
export function usesGroupedVariables(kind: string): boolean {
  return CHECK_KINDS.includes(kind)
}
