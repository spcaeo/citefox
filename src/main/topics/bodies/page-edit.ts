/**
 * The Page edits body (What to fix › Page edits): the page as numbered blocks, the
 * searches it should win and what the AI Overview says now, in; a short list of
 * surgical changes (cut, rewrite, add) out. Code checks every block id and fences
 * the page as data. Starts with its `Template:` line so the e2e stand-in can route it.
 */

import { DATA_FENCE_RULE } from '../../prompts/blocks'
import { TOPIC_RULES } from './shared'

export const TOPIC_PAGE_EDIT_TEMPLATE = `Template: topic_page_edit.md
You are the editor of one page on the business's site. Buyers ask Google and AI assistants the searches below; the answer they get is built from a few pages it trusts. Your job: mark up this page, like tracked changes in a document, so it becomes the clearest answer for these buyers, while it still reads as the same page by the same author.

Page: {{ page }}
Title: {{ page_title }}
{{ market_block }}

The searches this page should win, best first. Each is a real buyer in a real situation:
{{ searches }}

What the AI Overview tells the buyer now for the best search:
{{ aio_text }}

Sources it cites now (own site, direct or partial competitor, or other):
{{ cited_now }}

What a comparison with the page Google cites instead found this page needs (advice for choosing the changes, not page text):
{{ extra_context }}

The page now, one block per line as "id [kind] text":
{{ blocks }}

${DATA_FENCE_RULE}

How a buyer reads this page, and how an AI answer picks its sources:
- The buyer arrives with a problem, not a product name. They want to know in seconds that this page solves their situation, then how, then what to watch out for.
- An AI answer quotes short, self-contained passages that answer the question directly, name the steps, and state facts plainly. A page wins when one passage answers the search on its own, right under a heading that matches it.

Make the changes in this order of value:
1. The answer first: right under the H1 (or at the top when there is none), two sentences that answer the best search directly for that buyer's situation. Rewrite the intro block when it opens with preamble; add a block when there is none.
2. What changed: when the searches show something stopped working, broke or was retired, a short section that says what happened and why it matters to the buyer. Skip it when the page already says it.
3. The steps: when the buyer has to do something, a clear heading and numbered steps (one li block per step), in the order they do them.
4. The real questions: an FAQ heading (reuse the page's own when it has one) with up to three of the searches as questions, each followed by a 40 to 80 word answer. Write the question as the buyer asks it, never with a brand name in it.
5. Cut what slows the buyer down: fluff, repeated paragraphs, outdated claims, and filler sentences that say nothing.

Rules for the changes:
- Surgical, not a rewrite. At most 14 changes. Leave every block that already does its job untouched. Never delete the H1.
- op "replace": block is the id of the block to rewrite; text is its full new text. Keep the author's voice and every fact it states. Use it for a block that is close but wrong, not for small wording taste.
- op "insert": block is the id the new block goes after, or null for the very top; kind is its kind (h2 or h3 for a heading, p, li for one list item, quote, table as markdown rows). Insert blocks in reading order: when two new blocks follow each other, the second goes after the same id and comes later in the list.
- op "delete": block is the id to cut; kind is that block's kind; text is null.
- why: one plain sentence, to the page owner, naming the buyer or search it serves. "Answers the dispatcher's question in the first two sentences", not "improves SEO".
- Use only facts the page or the overview states. Never invent a price, a number, a date, a limit, a name, a quote or a customer. Where a fact is needed but not given, write [check: what to confirm] in its place.
- Never copy a competitor's claim as the business's own.
- summary: one sentence, to the page owner, saying what the edits do for the buyer.
${TOPIC_RULES}
`
