/**
 * Topic page bodies (Docs/PROMPT-AUDIT.md, package P5): page match, page brief and the
 * topic target page pick.
 * Shipped `CiteFox default` bodies; each starts with its `Template:` line so the e2e
 * Claude stand-in can route it. Code fences the page list and the overview, and
 * checks every reply (urls from the list only, outline and word counts).
 */

import { DATA_FENCE_RULE, FIX_DRAFT_RULES } from '../../prompts/blocks'
import { TOPIC_RULES } from './shared'

export const TOPIC_PAGE_MATCH_TEMPLATE = `Template: topic_page_match.md
You are matching each buyer question or keyword to the one page on {{ website }} that should answer it, as an editor deciding which page to improve.

Candidate pages, one per line as url · title · headings · the start of the page text:
{{ pages }}

${DATA_FENCE_RULE}

Prompts, one per line as id · text:
{{ questions }}

For each prompt, pick the page whose main job is this buyer's situation. A page that only shares a word with the prompt (both mention "SMS", or both are about texting) is not a match.
confidence, 0 to 100:
- 75 to 100: the title, H1 or a heading answers this exact question for this kind of buyer.
- 45 to 74: a section of the page answers it, or the page is about the same job for a different situation, so it needs a new section.
- 20 to 44: the page only touches the topic; it would need a rewrite to answer.
- below 20: no page fits. Set url to null.
A home, pricing, contact or sign-up page is a match only when the prompt asks about the business as a whole, its price or how to start.
When a prompt says which of your pages Google now cites and that page's main job is this prompt, pick it: Google already agrees.
reason: one line, no brackets. Name the heading or title that answers it, copied exactly from the list, or say what the page is missing.
Use only urls from the list. Give every prompt id exactly one answer.
${TOPIC_RULES}
`

export const TOPIC_PAGE_BRIEF_TEMPLATE = `Template: topic_page_brief.md
You are writing a page brief: what a page must say so it answers this buyer question better than the sources Google's AI Overview cites now.

Question: {{ prompt }}
Journey stage: {{ stage }}
{{ market_block }}
{{ product_block }}
Website: {{ website }}
Target page: {{ page }}
The target page now (title, H1 and headings):
{{ page_head }}

Sources the overview cites now (own site, direct or partial competitor, or other):
{{ cited_now }}

What the overview says now:
{{ aio_text }}

${DATA_FENCE_RULE}

Write:
- summary: two sentences. What the page must answer first, in the buyer's words; then what it must add that the cited sources give the overview.
- outline: 4 to 7 section headings in order, written for this buyer, the last one an FAQ. Keep a heading of the current page, copied exactly, when it already fits.
- text: the brief as plain text a writer can follow, 120 to 250 words: the answer to open with, what each section must cover, the facts to use from the page, and the details to check before publishing.
${FIX_DRAFT_RULES}
${TOPIC_RULES}
`

export const TOPIC_TARGET_SUGGEST_TEMPLATE = `Template: topic_target_suggest.md
You are picking the one page on {{ website }} that this whole topic's buyer questions should be cited from, as an editor choosing which page to grow.

Topic: {{ topic }}
{{ market_block }}

The topic's questions and keywords, one per line as stage · text:
{{ questions }}

Candidate pages, one per line as url · title · headings · how often the latest checks cite it for these questions:
{{ pages }}

${DATA_FENCE_RULE}

Pick up to three candidate pages, best first. The best page is the one whose main job is this buyer's situation across most of the questions; how often answers already cite it is strong evidence, but a page cited only for its brand or price is not a topic page. A home, pricing, contact or sign-up page is a pick only when the topic is about the business as a whole, its price or how to start.
reason: one plain sentence a marketer understands, no brackets. Name the title or heading that fits, copied exactly from the list, or the citations it already has.
newPage: when no candidate's main job is this topic, name the page to write: a title for this buyer, a short path on {{ website }} such as /topic-in-plain-words, and one sentence on what it must answer. Otherwise null.
Use only urls from the list, copied exactly. Leave picks empty when none fits.
${TOPIC_RULES}
`
