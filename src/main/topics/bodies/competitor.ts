/**
 * Competitor page bodies (Docs/PROMPT-AUDIT.md, package P4). Shipped `CiteFox
 * default` bodies; each starts with its `Template:` line so the e2e Claude
 * stand-in can route it.
 *
 * `competitor_page_questions` (questions and claims in one call) is retired; its
 * body stays so an old project version can still be read. The two calls that
 * replace it run in parallel: the questions their page is built to win for this
 * topic's buyer, and the claims it makes that the business's own pages do not.
 */

import { COMPETITOR_SHORT_RULE } from '../../engine/competitor-rules'
import { DATA_FENCE_RULE, JSON_ONLY_RULE } from '../../prompts/blocks'
import { TOPIC_RULES } from './shared'

/** Retired (replaced by the two kinds below). Kept unchanged for old project versions. */
export const COMPETITOR_PAGE_QUESTIONS_TEMPLATE = `Template: competitor_page_questions.md
You are writing the buyer questions a competitor's page is built to answer, so the business can see where it is cited and where it is not.

Their page: {{ competitor_url }}
Title: {{ title }}
Meta description: {{ meta_description }}
H1: {{ h1 }}
Outline:
{{ outline }}
Text:
{{ page_text }}

The business's own site says:
{{ website_text }}
Market: {{ market }} ({{ market_language }})

Write {{ count }} questions across the journey stages (problem, options, doubts, fit, compare, decide), 15 to 32 words, first person, situational. section is their heading the question comes from. Never name either brand: leave out {{ brand_name }}, {{ aliases }} and the competitor's own name ({{ competitor_name }}).
In compare questions, weigh only live products a buyer could choose instead. ${COMPETITOR_SHORT_RULE}
Also list claims: claims their page makes, each with onYourSite: "no" when the business's site does not make it, "partly", or "yes".
${TOPIC_RULES}
`

const THEIR_PAGE = `Their page ({{ competitor_name }}, {{ competitor_url }}). ${DATA_FENCE_RULE}
<competitor_page>`

export const COMPETITOR_PAGE_QUESTIONS_V2_TEMPLATE = `Template: competitor_page_questions_v2.md
You are finding the buyer questions a competitor's page is built to answer, for one topic, so the business can write a better answer to each and be the source AI answers cite.

Topic: {{ seed }}
{{ buyer_block }}
{{ market_block }}

${THEIR_PAGE}
Title: {{ title }}
Meta description: {{ meta_description }}
H1: {{ h1 }}
Headings:
{{ outline }}
Text:
{{ page_text }}
</competitor_page>

Write up to {{ count }} questions this buyer would type into Google or ask an AI assistant, where their page holds the answer.
- Work from their sections. Use a section only when it serves this topic's buyer; skip sections about other jobs, other buyers or other industries. Fewer questions on the topic beat padding.
- Each question is one buyer's situation in their own words, first person, 15 to 32 words: what happened or what they run, then what they need to know. Use the buyer's real tools, setting and triggers from the profile.
- Ask what the page answers, not what it sells: a buyer asks "can I …", "how do I …", "what happens if …", never "which provider has <their feature name>". Ask about the buyer's problem and the solution, never about this vendor as a company (its age, demos, sales calls, sign-up steps).
- section: the heading of their page the question comes from, copied exactly from the headings list.
- Spread the questions over these stages, in the buyer's order:
{{ stage_rules }}
- No product or company is named in any question, in any stage: never {{ competitor_name }}, {{ brand_name }} ({{ aliases }}) or anyone else. Compare questions weigh kinds of solution.
- Use only facts their page or the profile gives; never invent a price, a limit or a law.
${JSON_ONLY_RULE}
`

export const COMPETITOR_PAGE_CLAIMS_TEMPLATE = `Template: competitor_page_claims.md
You are comparing a competitor's page with the business's own pages for one topic: which specific claims they make that the business does not.

Topic: {{ seed }}
{{ market_block }}

${THEIR_PAGE}
Headings:
{{ outline }}
Text:
{{ page_text }}
</competitor_page>

The business's own pages, each starting with its [path]. ${DATA_FENCE_RULE}
{{ evidence }}

List up to 12 claims their page makes that a buyer in this topic would weigh.
- A claim is one specific, checkable statement: a number, a feature, a limit, a speed, a price or trial term, an integration, a guarantee, a compliance or security point, or proof such as customer counts and years in business. Never a slogan or a promise with nothing to check ("convert more customers", "keep your audience informed"), and never something any company in the category could say.
- Write each claim in at most 25 plain words, as their page states it. Keep their numbers and names of features exactly; never add a detail their page does not give.
- section: their heading the claim sits under, copied exactly from the headings list.
- onYourSite, from the business's pages above only: "yes" when one states the same thing, "partly" when one states part of it or something weaker, "no" when none does. yourEvidence: the [path] of the page that shows it (for yes or partly), copied as written; null for no.
- These are only some of the business's pages, so "no" means "not on these pages".
- Order: the claims that matter most to this topic's buyer first. Skip claims about jobs the topic is not about.
- Never write {{ brand_name }} or its aliases ({{ aliases }}) in a claim.
${JSON_ONLY_RULE}
`
