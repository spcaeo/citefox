/**
 * Topic insight bodies (Docs/PROMPT-AUDIT.md, package P5): the summary, the next
 * actions, the citation diagnosis and the fix draft. Shipped `CiteFox default`
 * bodies; each starts with its `Template:` line so the e2e Claude stand-in can
 * route it. Code fences the untrusted inputs (`<overview>`, `<page_text>`) and
 * computes what it can (source tags, positions, Q numbers) before the call.
 *
 * `topic_why_not_cited` and `topic_explain_citation` are retired (Docs/PROMPT-AUDIT.md
 * section 3, rule 6): kept so old project versions stay readable, never run.
 */

import {
  CITATION_DIAGNOSIS_RULES,
  DATA_FENCE_RULE,
  FIX_DRAFT_RULES,
  NO_CAUSE_RULE
} from '../../prompts/blocks'
import { NEXT_ACTION_RULES } from '../../prompts/citations'
import { TOPIC_RULES } from './shared'

export const TOPIC_SUMMARY_TEMPLATE = `Template: topic_summary.md
You are writing the summary line and the executive summary of a topic's Google AI Overview results, for the business that tracks them. Report what the numbers show; another step picks the next actions.

Topic: {{ topic }}
Market: {{ market }}
Results:
{{ results }}

Notes and edits logged between the checks:
{{ edits }}

Write:
- line: one sentence of at most 40 words. Start "Since <date>:" with the earlier check's date from the results, or "First check:" when there is no earlier check. Say what changed (newly or no longer cited, by Q number), then the weakest stage with its numbers. Leave out what is unchanged.
- executive: 2 to 4 sentences for a report: the cited share of questions with an overview against the target band and how many more are needed to reach it, the change since the earlier check, the strongest and weakest stages with their numbers, and the keywords as a separate measure when there are any.
Use only numbers from the results. When an edit is logged between the checks, give its date beside the change. ${NO_CAUSE_RULE}
${TOPIC_RULES}
`

export const TOPIC_NEXT_ACTIONS_TEMPLATE = `Template: topic_next_actions.md
You are choosing the next three things the business should do so more of this topic's buyer questions get cited in Google's AI Overviews.

Topic: {{ topic }}
Market: {{ market }}
Results:
{{ results }}

Questions to work on, one per line as Q number · stage · state · target page (match confidence) · who the overview cites instead:
{{ matches }}

Stages and pages with open gaps:
{{ gaps }}

${NEXT_ACTION_RULES}

Write nextActions: exactly 3, best first.
- text: one instruction of at most 35 words. Start with a verb, name the page by its path or say "a new page", and say what it must answer for the buyer.
- promptNumbers: the Q numbers from the list the action covers, at least one.
- verify: a fact the user must re-check before acting on it (a price, a law, a competitor claim), else null.
${TOPIC_RULES}
`
export const TOPIC_WHY_NOT_CITED_TEMPLATE = `Template: topic_why_not_cited.md
You are explaining why an AI Overview cites other sources and not the business, and drafting the fix. Use the stored overview only; no new searches.

Question: {{ prompt }}
Stage: {{ stage }}
Mode: {{ mode }}
Target page: {{ page }}
Target page headings and text:
{{ page_text }}

The AI Overview says:
{{ aio_text }}

Sources it cites, in order:
{{ aio_references }}

Write summary (one or two sentences), reasons (2 to 4 likely reasons, most likely first, each with evidence from the overview or the page, or null), citedInstead (each cited source: domain, url, and why it likely wins), and fix: where ("target" to improve the target page, "new" for a new page), steps (3 to 6 concrete edits), and draft (a 60 to 120 word FAQ answer or section in the page's voice, unconfirmed facts in [brackets]). In "why" mode keep fix short; in "fix" mode keep reasons short.
${TOPIC_RULES}
`

export const TOPIC_EXPLAIN_CITATION_TEMPLATE = `Template: topic_explain_citation.md
You are explaining why a stored Google AI Overview cites the sources it cites for one question. Use only the stored overview and its sources; there are no new searches. Say what the overview and sources show; never say a page change caused or will cause a citation (timing, not proof).

Question: {{ prompt }}
Stage: {{ stage }}
Target page: {{ page }}
Checked: {{ checked_at }}

The AI Overview says:
{{ aio_text }}

Sources it cites, in order (class: own, competitor or other):
{{ aio_references }}

Write text (2 to 4 plain sentences: which sources the overview leans on and what each gives it, and where the business stands) and facts (2 to 5 short facts behind it, such as "simpletexting.com is cited first").
${TOPIC_RULES}
`

export const TOPIC_CITATION_DIAGNOSIS_TEMPLATE = `Template: topic_citation_diagnosis.md
You are explaining one stored Google AI Overview to the business that wants its page cited in it: who the overview cites for this buyer question, what each source gives it, and why the business's page is or is not among them.

Question: {{ prompt }}
Journey stage: {{ stage }}
{{ market_block }}
Checked: {{ checked_at }}
Where the business stands: {{ status }}
Target page: {{ page }}

The overview's text, in reading order. [n] after a passage names the sources Google showed for it:
{{ aio_text }}

Sources the overview cites, in order (n. domain · title · own site, direct or partial competitor, or other · url), with the snippet Google showed from each when it was stored:
{{ aio_references }}

The target page: its title, headings and the part that matches the question:
{{ page_text }}

${DATA_FENCE_RULE}

${CITATION_DIAGNOSIS_RULES}
- Ground every point in the overview: name a source by its number and domain, and the passage it backs. When the text has no [n] markers, match passages to sources by their titles and snippets and say "likely".
- Before you say the page lacks something, check the page text above. If the page says it, that is not the reason. When the page was not read, say so instead of guessing what it covers.
- When the business is cited, say what the overview takes from its page and what it takes from the others.
- When the overview shows no sources, say so plainly, leave citedInstead empty, and explain what kind of answer the overview gives (steps, a comparison table, a list of named tools) and what a page would need to be a source for it. "It shows no sources" is a fact, not a reason; each reason says what the answer needs that the page lacks or has.

Write:
- summary: two sentences. First, who the overview leans on and for what. Then where the business stands.
- reasons: 2 to 4, most likely first. text is one sentence about this question and these sources, not general SEO advice. evidence is a passage copied character for character from the overview or the page text, or null.
- citedInstead: up to 5 sources that are not the business's own site, most important first. source is the source's number in the list. whyItWins is one line naming what it gives the overview (the fact, list, step or comparison) that the target page does not.
- facts: 2 to 4 short statements of what the overview tells this buyer, each traceable to a passage, such as "Recommends a shared inbox so staff can see who replied".
${TOPIC_RULES}
`

export const TOPIC_FIX_DRAFT_TEMPLATE = `Template: topic_fix_draft.md
You are drafting the edit that gives one buyer question a better answer on the business's site, from a diagnosis of the stored Google AI Overview. Write for the buyer who asked it, in their situation.

Question: {{ prompt }}
Journey stage: {{ stage }}
{{ market_block }}
Target page: {{ page }}

What the overview shows and why the page is not its source:
{{ diagnosis }}

The target page now:
{{ page_text }}

${DATA_FENCE_RULE}

Write:
- where: "target" to change the target page; "new" when there is no target page or the page is about a different job than the question.
- steps: 3 to 6 edits in the order to make them. Each names the section exactly as it is written on the page (or says where the new block goes) and what it must answer, closing a gap the diagnosis names. Concrete: "Add an H2 'Text staff from Outlook without an app' under 'How it works' with the three set-up steps", not "improve the content".
- draft: the one block to paste first. Either an FAQ: the question on the first line, as this buyer would ask it, then the answer; or a section: its heading on the first line, then 60 to 120 words. Use facts the page states; never copy a competitor's claim as the business's own.
${FIX_DRAFT_RULES}
${TOPIC_RULES}
`
