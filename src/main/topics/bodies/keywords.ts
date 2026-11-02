/**
 * Topic keyword bodies (Docs/PROMPT-AUDIT.md, package P4): core terms, the intent
 * groups, and the competitor groups. Shipped `CiteFox default` bodies; each starts
 * with its `Template:` line so the e2e Claude stand-in can route it.
 *
 * One job each: terms name the topic; intent groups never see a competitor; the
 * competitor groups see only the topic's own competitors. Code checks every reply
 * (`steps-keywords.ts`): word counts, lower case, brand and competitor names.
 */

import { DATA_FENCE_RULE, JSON_ONLY_RULE } from '../../prompts/blocks'

const NAMES_RULE =
  'Never write the brand or an alias ({{ brand_name }}; aliases: {{ aliases }}), in any spelling.'

export const TOPIC_KEYWORD_TERMS_TEMPLATE = `Template: topic_keyword_terms.md
You are an SEO keyword researcher. Name the core search terms for one topic and the other ways buyers type each one.

Topic: {{ seed }}
{{ product_block }}
{{ market_block }}
{{ buyer_block }}

The site's own pages about this topic. ${DATA_FENCE_RULE}
{{ evidence }}

Write 2 to 6 core terms, most important first.
- A core term is a short noun phrase (2 to 4 words, lower case) for the thing a buyer searches for in this topic: the service or tool, or the job it does. Start with the topic's own subject as buyers type it, then its parent category, then the narrower phrases this buyer uses for their situation.
- Not a question, a sentence or a verb phrase ("track employee hours online" is not a term; "employee time tracking" is). No modifiers: best, top, free, cheap, pricing, cost, review, alternative, vs, near me, software for, a year. Code adds those.
- Not a buyer segment and not a place. Each term means something different from the others.
- Use the words people really type in this market, not the site's slogans.

For each term, up to {{ count }} synonyms: other phrases with real search demand that mean the same thing ("timesheet app" for "time tracking software"). A synonym is a noun phrase too, so it reads well inside the patterns below ("send email as text" is not one). A plural, a reordering or the term with one extra word is not a synonym. Fewer is better than padding.

Then 3 to 6 patterns: the modifiers real buyers of THIS category add to these terms when they search, with {X} where a term goes and {segment} where a buyer segment goes. For a business service that might be "{X} service", "{X} for business", "{X} provider", "free {X}", "best {X}", "{X} for {segment}"; for an app "{X} app"; for a regulated field "{X} compliance". Pick only the modifiers people really type for this kind of product, in this market. Never "ai", "automated" or "automation" unless the product itself is an AI or automation product. 1 to 4 words besides {X}, lower case, no names.

${NAMES_RULE} Never write a competitor, a carrier or any other company or product name.
${JSON_ONLY_RULE}
`

export const TOPIC_KEYWORD_EXPAND_TEMPLATE = `Template: topic_keyword_expand.md
You are an SEO keyword researcher. Write search keywords for one topic, one group per intent family.

Topic: {{ seed }}
Core terms, each with its synonyms in parentheses: {{ terms }}
Buyer segments: {{ segments }}
{{ market_block }}

Already made in code; do not repeat or reword these:
{{ keywords }}

Families to write, each with its intent, funnel and page type:
{{ families }}

For each family write one group: name (the family's label as given), kind "intent", family, intent, funnel and pageType exactly as given for it, and up to {{ count }} keywords.
- Write what people really type into Google or ask an AI assistant in this market: lower case, 2 to 9 words (long-tail questions 6 to 14), natural word order, no keyword stuffing ("best free cheap …").
- Stay on the topic. Most keywords carry its specific situation, not just the parent category; at most a quarter may be the broader category alone.
- Each keyword is a different search: no plurals, reorderings or one-word swaps of another keyword in any group.
- Use the market's own words (spelling, "text" or "SMS", local rules) where they differ.
- No company, product, carrier or competitor names in any group; a separate step writes those. ${NAMES_RULE}
- Write a family only from searches you know people make; leave a family with fewer keywords rather than invent phrases.
${JSON_ONLY_RULE}
`

export const TOPIC_KEYWORD_COMPETITOR_TEMPLATE = `Template: topic_keyword_competitor.md
You are an SEO keyword researcher. Write the searches buyers make about the named options for one topic.

Topic: {{ seed }}
Core terms, each with its synonyms in parentheses: {{ terms }}
{{ market_block }}

The options for this topic:
{{ competitor_block }}

Families to write, each with its intent, funnel and page type:
{{ families }}

For each family write one group: name (the family's label as given), kind "intent", family, intent, funnel and pageType exactly as given for it, and up to {{ count }} keywords.
- Every keyword names exactly one or two options from the lists above, spelled the way people type them (lower case, ".com" only where people type it).
- "Alternatives & vs" names a direct or partial competitor, or something buyers switch from ("<name> alternative", "<old option> replacement").
- "Competitor vs" names direct or partial competitors only: two of them against each other, or one against a kind of solution, or one with an evaluation word (review, pricing, is it good for …).
- Never put a tool used with it in place of an option, and never name anything that is not listed.
- Prefer the direct competitors. Keep the topic's angle where people would really search it ("<name> <core term> alternative"), but do not force it into every keyword.
- Lower case, 2 to 9 words, each a different search. ${NAMES_RULE}
${JSON_ONLY_RULE}
`
