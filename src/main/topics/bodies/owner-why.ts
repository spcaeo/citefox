/**
 * The "Why Google picks" body (What to fix › Pick which page owns it): the target
 * page, the page Google cites instead and the saved overviews of the searches, in;
 * a verdict, what the answer needs, what the cited page has and content changes to
 * the owner page, out. Code checks the sections against each page's headings and
 * fences both pages as data. Starts with its `Template:` line so the e2e stand-in
 * can route it.
 */

import { DATA_FENCE_RULE } from '../../prompts/blocks'
import { TOPIC_RULES } from './shared'

export const TOPIC_OWNER_WHY_TEMPLATE = `Template: topic_owner_why.md
You compare two pages of the same business site. For the buyer searches below, Google's AI Overview cites the "cited page", not the "target page" the business chose for them. Explain why Google most likely picks the cited page, decide which page should own these searches, and say what content to change so that page is the one the answer quotes.

Target page (chosen by the business): {{ target_url }}
Cited page (Google cites it now): {{ cited_url }}
{{ market_block }}

The searches, best first. Each is a real buyer in a real situation:
{{ searches }}

What the AI Overview says for the top searches, and the sources it cites:
{{ overviews }}

The target page, headings marked with #:
{{ target_page }}

The cited page, headings marked with #:
{{ cited_page }}

${DATA_FENCE_RULE}

How to judge:
- An AI answer quotes short, self-contained passages that answer the search directly. Read what the overview says, then find which page states those points, steps, comparisons or facts plainly, and where.
- Match intent: is the buyer comparing options, following steps, checking a fact, or choosing a product? Which page's purpose fits that buyer?
- verdict "target" when the target page's purpose fits these searches and content changes can make it the best answer; "cited" when the cited page fits them better and making it the owner is the honest fix; "either" when both fit and the choice is the business's.

What to write:
- reason: one or two plain sentences to the site owner: why Google picks the cited page, and why the verdict.
- answerNeeds: 3 to 6 short points the answer must cover for these searches, taken from the overview text and the searches.
- citedHas: 1 to 6 things the cited page has that the target page lacks. section: the cited page's heading where it sits, copied exactly, or "Opening" for the text above the first heading. point: what it says, short, quoting a few words where it helps.
- toChange: 2 to 8 content changes to the recommended owner page: the target page, or the cited page when the verdict is "cited". section: that page's heading copied exactly, "New section after <heading>", or "Opening". change: what to add or rewrite, in plain words, with the gist of the new text; content only, never an address, redirect or canonical change. why: one sentence naming the search or answer point it serves.
- risk: when both pages compete for the same searches, one sentence on how to stop that (for example, a short link from one page to the other); else null.
- Use only facts the pages or the overview state. Never invent a price, a number, a date, a limit, a name or a customer. Where a fact is needed but not given, write [check: what to confirm] in its place.
- Never copy a competitor's claim as the business's own.
- Plain words, no SEO jargon.
${TOPIC_RULES}
`
