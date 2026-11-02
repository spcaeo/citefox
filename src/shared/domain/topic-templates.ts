/**
 * The topic template kinds (Docs/TOPICS-SPEC.md section 6) as the template
 * editor lists them: run order, variables and the shipped duration estimate.
 * Bodies and schemas live in main (`src/main/topics/templates.ts`).
 */

export const TOPIC_TEMPLATE_KINDS = [
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
  'topic_cluster_name'
] as const

export type TopicTemplateKind = (typeof TOPIC_TEMPLATE_KINDS)[number]

/** Seconds each step usually takes, until `llm_calls` has history. */
export const TOPIC_EXPECTED_SECONDS: Readonly<Record<TopicTemplateKind, number>> = {
  topic_seed_discover: 15,
  topic_buyer_profile: 20,
  topic_profile_discover: 15,
  topic_profile_discover_v2: 15,
  topic_profile_rewrite: 8,
  topic_journey_questions: 15,
  topic_questions_discover: 15,
  topic_keyword_terms: 12,
  topic_keyword_expand: 20,
  topic_keyword_competitor: 8,
  topic_page_match: 25,
  topic_page_brief: 20,
  topic_target_suggest: 12,
  topic_questions_cleanup: 20,
  competitor_page_questions: 30,
  competitor_page_questions_v2: 30,
  competitor_page_claims: 25,
  topic_summary: 10,
  topic_next_actions: 10,
  topic_why_not_cited: 8,
  topic_explain_citation: 6,
  topic_citation_diagnosis: 10,
  topic_fix_draft: 10,
  topic_page_edit: 40,
  topic_owner_why: 30,
  topic_cluster_suggest: 20,
  topic_cluster_sort: 15,
  topic_cluster_name: 6
}

/** The context blocks built in code (`src/main/prompts/blocks.ts`). */
const blocks = {
  business: v('business_block', 'The business: domain, one-line summary, brand names to leave out'),
  product: v('product_block', 'The product this step is about: name, job and buyer'),
  market: v('market_block', 'The market and the language to write in'),
  buyer: v('buyer_block', 'A compact buyer profile: who, environment, triggers'),
  competitor: v(
    'competitor_block',
    "The product's direct and partial competitors, what buyers switch from, and tools used with it"
  ),
  stageRules: v('stage_rules', 'Definitions of the journey stages this step writes'),
  modeRules: v('mode_rules', 'The rules for the chosen action only'),
  evidence: v('evidence', "The site's own pages most related to the topic, fenced as data")
} as const

/**
 * Variables each topic step fills (the template editor lists these). The context
 * blocks (`business_block`, `product_block`, `market_block`, `buyer_block`,
 * `competitor_block`, `stage_rules`, `mode_rules`, `evidence`) are built in code by
 * `src/main/prompts/blocks.ts`. A live step lists a block only once its package
 * fills it (Docs/PROMPT-AUDIT.md); the planned steps list theirs already.
 */
export const TOPIC_TEMPLATE_VARIABLES: Readonly<
  Record<TopicTemplateKind, readonly { name: string; holds: string }[]>
> = {
  topic_seed_discover: [
    blocks.business,
    blocks.market,
    v('products', 'The saved products, each with its id, job and buyer'),
    v('website_text', 'Homepage and key pages, read without a search, fenced as data'),
    v('saved_data', "The site's pages by kind, tracked pages and what overviews cite now"),
    v('count', 'How many seeds to write')
  ],
  topic_buyer_profile: [
    v('seed', "The topic: the buyer's problem"),
    v('about', 'About the business'),
    v('segments', 'Segments the user picked'),
    blocks.product,
    blocks.market,
    blocks.evidence,
    ...buyerContext(),
    v('instruction', 'What the user asked to change'),
    ...brand()
  ],
  topic_profile_discover: [
    v('seed', 'The topic'),
    v('website', 'The project website'),
    v('action', 'discover, rewrite, shorter or explain'),
    v('section', 'The profile section, or all'),
    v('profile', 'The current profile points'),
    v('website_text', 'Homepage and key pages'),
    v('instruction', 'What the user asked to change'),
    ...brand()
  ],
  topic_profile_discover_v2: [
    v('seed', 'The topic'),
    v('action', 'discover or explain'),
    v('section', 'The profile section, or all'),
    v('profile', 'The current profile points'),
    v('market_language', "The market's language"),
    blocks.evidence,
    blocks.modeRules,
    v('instruction', 'What the user asked to change'),
    ...brand()
  ],
  topic_profile_rewrite: [
    v('seed', 'The topic'),
    v('action', 'rewrite or shorter'),
    v('section', 'The profile section'),
    v('profile', "The section's points, each with its id"),
    v('market_language', "The market's language"),
    blocks.modeRules,
    v('instruction', 'What the user asked to change'),
    ...brand()
  ],
  topic_journey_questions: [
    v('seed', 'The topic'),
    v('stage', 'The journey stage this call writes'),
    v('count', 'Questions to write for this stage'),
    blocks.product,
    blocks.market,
    blocks.buyer,
    blocks.stageRules,
    v(
      'competitor_block',
      'Compare and decide: the competitors to name, what buyers switch from and the software that sends the emails. Other stages: what buyers switch from and that software'
    ),
    v('buyers', 'The buyer for each question this call writes, one per line'),
    v(
      'instruction',
      'Questions already written for this stage, when a stage takes more than one call'
    ),
    ...brand()
  ],
  topic_questions_discover: [
    v('seed', 'The topic'),
    v('mode', 'discover, gaps or rewrite'),
    v('stage', 'The journey stage, or all'),
    v('count', 'How many to write'),
    blocks.market,
    blocks.buyer,
    v('competitor_block', 'The competitors to name, for the compare and decide stages only'),
    v('questions', 'The questions so far'),
    blocks.modeRules,
    v('instruction', 'What the user asked to change'),
    ...brand()
  ],
  topic_keyword_terms: [
    v('seed', 'The topic'),
    v('count', 'Synonyms per core term'),
    blocks.product,
    blocks.market,
    v('buyer_block', 'Who the buyer is and where they work (from the topic profile)'),
    blocks.evidence,
    ...brand()
  ],
  topic_keyword_expand: [
    v('seed', 'The topic'),
    v('terms', 'Core terms and synonyms'),
    v('segments', 'Buyer segments'),
    v('keywords', 'Keywords already made in code'),
    v('families', 'Intent families to write groups for, with what each holds'),
    v('count', 'Most keywords per group'),
    blocks.market,
    ...brand()
  ],
  topic_keyword_competitor: [
    v('seed', 'The topic'),
    v('terms', 'Core terms and synonyms'),
    v('families', 'The competitor families to write groups for, with what each holds'),
    v('count', 'Most keywords per group'),
    blocks.competitor,
    blocks.market,
    ...brand()
  ],
  topic_page_match: [
    v('website', 'The project website'),
    v('pages', 'Tracked pages and sitemap entries with headings and the start of their text'),
    v('questions', 'The prompts to match'),
    ...brand()
  ],
  topic_page_brief: [
    v('prompt', 'The question'),
    v('stage', 'Its journey stage and what the buyer does at it'),
    v('page', 'The target page, or none yet'),
    v('page_head', "The target page's title, H1 and headings"),
    v('website', 'The project website'),
    v('cited_now', 'Sources the overview cites now, tagged own, competitor or other'),
    v('aio_text', 'What the overview says now'),
    blocks.market,
    blocks.product,
    ...brand()
  ],
  topic_target_suggest: [
    v('topic', 'The topic name'),
    v('website', 'The project website'),
    v('questions', "The topic's questions and keywords with their journey stage"),
    v('pages', 'Candidate pages with headings and how often the checks cite each'),
    blocks.market,
    ...brand()
  ],
  topic_questions_cleanup: [
    v('topic', 'The topic name'),
    blocks.market,
    v('stage_rules', 'Definitions of the six journey stages'),
    v('questions', 'The imported questions, fenced as data'),
    ...brand()
  ],
  competitor_page_questions: [
    v('competitor_url', "Their page's address"),
    v('competitor_name', "The competitor's name"),
    v('title', "Their page's title"),
    v('meta_description', 'Their meta description'),
    v('h1', 'Their H1'),
    v('outline', 'Their headings'),
    v('page_text', "Their page's text"),
    v('website_text', 'Your own site'),
    v('market', 'The market'),
    v('market_language', "The market's language"),
    v('count', 'Questions to write'),
    ...brand()
  ],
  competitor_page_questions_v2: [
    v('competitor_url', "Their page's address"),
    v('competitor_name', "The competitor's name"),
    v('title', "Their page's title"),
    v('meta_description', 'Their meta description'),
    v('h1', 'Their H1'),
    v('outline', 'Their headings'),
    v('page_text', "Their page's text"),
    v('seed', 'The topic'),
    v('count', 'Questions to write'),
    blocks.buyer,
    blocks.market,
    blocks.stageRules,
    ...brand()
  ],
  competitor_page_claims: [
    v('competitor_url', "Their page's address"),
    v('competitor_name', "The competitor's name"),
    v('outline', 'Their headings'),
    v('page_text', "Their page's text"),
    v('seed', 'The topic'),
    blocks.evidence,
    blocks.market,
    ...brand()
  ],
  topic_summary: [
    v('topic', 'The topic name'),
    v('market', 'The market'),
    v('results', 'Goals, stages, to-do and changes since the last check'),
    v('edits', 'Notes logged between the checks'),
    ...brand()
  ],
  topic_next_actions: [
    v('topic', 'The topic name'),
    v('market', 'The market'),
    v('results', 'Goals, stages, to-do and changes since the last check'),
    v('gaps', 'Open journey gaps'),
    v('matches', 'Questions with the page that should answer them'),
    ...brand()
  ],
  topic_why_not_cited: [
    v('prompt', 'The question'),
    v('stage', 'Its journey stage'),
    v('mode', 'why or fix'),
    v('page', 'The target page'),
    v('page_text', "The target page's headings and text"),
    v('aio_text', 'The stored overview text'),
    v('aio_references', 'Sources the overview cites, in order'),
    ...brand()
  ],
  topic_explain_citation: [
    v('prompt', 'The question or keyword'),
    v('stage', 'Its journey stage'),
    v('page', 'The target page'),
    v('checked_at', 'When the check ran'),
    v('aio_text', 'The stored overview text'),
    v('aio_references', 'Sources the overview cites, in order, with their class'),
    ...brand()
  ],
  topic_citation_diagnosis: [
    v('prompt', 'The question or keyword'),
    v('stage', 'Its journey stage'),
    v('checked_at', 'When the check ran'),
    v('status', 'Where the business stands: cited, another page cited, or not cited'),
    v('page', 'The target page'),
    v('page_text', "The target page's head, headings and the section matched to the question"),
    v('aio_text', 'The stored overview text'),
    v('aio_references', 'Sources the overview cites, in order, tagged own, competitor or other'),
    blocks.market,
    ...brand()
  ],
  topic_fix_draft: [
    v('prompt', 'The question'),
    v('stage', 'Its journey stage'),
    v('page', 'The target page'),
    v('page_text', "The target page's text"),
    v('diagnosis', 'The citation diagnosis: summary, reasons and sources cited instead'),
    blocks.market,
    ...brand()
  ],
  topic_page_edit: [
    v('page', 'The page to edit'),
    v('page_title', "The page's title"),
    v('blocks', "The page's blocks in reading order, each with its id and kind, fenced as data"),
    v('searches', 'The searches the page should win, best first'),
    v('aio_text', 'What the AI Overview says now for the best search'),
    v('cited_now', 'Sources the overview cites now, tagged own, competitor or other'),
    v(
      'extra_context',
      'What a comparison with the page Google cites instead found this page needs, or None'
    ),
    blocks.market,
    ...brand()
  ],
  topic_owner_why: [
    v('target_url', 'The page the business chose for these searches'),
    v('cited_url', 'The page of the business Google cites instead'),
    v('searches', 'The searches, best first'),
    v(
      'overviews',
      'What the saved AI Overview says for the top searches, and the sources it cites'
    ),
    v('target_page', "The target page's text, headings marked, fenced as data"),
    v('cited_page', "The cited page's text, headings marked, fenced as data"),
    blocks.market,
    ...brand()
  ],
  topic_cluster_suggest: [
    blocks.business,
    blocks.market,
    v('products', 'The saved products, each with its job and buyer'),
    v('competitors', 'Competitors per product, with the market they compete in'),
    blocks.buyer,
    v('own_pages', "The site's own pages: tracked pages and sitemap titles with their URLs"),
    v('existing_topics', 'Topics already tracked, to leave out'),
    v('avoid', 'Ideas already shown, to leave out'),
    v('count', 'Topic ideas to write'),
    blocks.stageRules,
    ...brand()
  ],
  topic_cluster_sort: [
    blocks.business,
    v('candidates', 'The topics to sort into, each with its id and situation'),
    v('questions', 'The questions to sort, each with its id'),
    v('new_topic_rule', 'Whether a question may go to a new topic'),
    ...brand()
  ],
  topic_cluster_name: [
    blocks.business,
    blocks.market,
    v('questions', 'The questions the topic holds'),
    ...brand()
  ]
}

function v(name: string, holds: string): { name: string; holds: string } {
  return { name, holds }
}

/** Notes from "Use in buyer questions" and "Note as integration" (Docs/FEEDBACK.md row 3). */
function buyerContext(): { name: string; holds: string }[] {
  return [
    v('switching_from', 'Replaced or discontinued options buyers switch from'),
    v('integrations', 'Integrations and tools buyers already use with it')
  ]
}

function brand(): { name: string; holds: string }[] {
  return [v('brand_name', 'Your brand names'), v('aliases', 'Brand aliases to leave out')]
}
