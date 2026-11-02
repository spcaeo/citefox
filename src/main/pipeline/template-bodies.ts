/**
 * Shipped defaults for the owner's buyer-prompt method (SRS section 4.8):
 * 1. read the live page, 2. a concrete buyer profile, 3. long situational
 * prompts, 4. a coverage matrix, 5. one-by-one fixes and page-wide fixes.
 *
 * One job per step (Docs/PROMPT-AUDIT.md, package P1). Every body starts with
 * `Template: <kind>.md`, reads its context from blocks code builds
 * (`{{ business_block }}`, `{{ market_block }}` and the rest, see
 * `prompts/blocks.ts`) and fences the page as data. The per-call lists (the buyer
 * profile and market lines for prompts, the numbered prompts for the gap steps,
 * the measured lengths for the audit) are appended by the engine after the
 * rendered body. The answer-shape body lives beside its vocabulary.
 */

import {
  COVERAGE_RUBRIC,
  DATA_FENCE_RULE,
  FIX_DRAFT_RULES,
  JSON_ONLY_RULE
} from '../prompts/blocks'

export { ANSWER_SHAPE_TEMPLATE } from '../analytics/answer-shape/template-body'

/** The page as every page step reads it: head, outline, FAQs and body, fenced as data. */
const PAGE_DATA = `<page_text>
URL: {{ url }}
Last modified: {{ last_modified }}
Title: {{ title }}
Meta description: {{ meta_description }}
H1: {{ h1 }}

Outline:
{{ outline }}

FAQs on the page:
{{ faqs }}

Body:
{{ page_text }}
</page_text>
${DATA_FENCE_RULE}`

export const BUYER_PROFILE_TEMPLATE = `Template: buyer_profile.md
You are writing the buyer profile for one page: who reads it and would buy from it. Write six parts: who, environment, segments, triggers, values, and poor fit.

{{ business_block }}
{{ product_block }}
{{ market_block }}

The page:
${PAGE_DATA}

Be concrete. A profile that would fit any business is wrong. Every specific must come from this page: its examples, named products and tools, standards, deadlines, numbers and events.
- who: roles or job titles, company size, and region. Company size is the number of staff, never a plan's seat, user or licence limit. Region comes from the market unless the page names another. Say whether they are developers, and who the page is not for.
- environment: the named tools and systems they already use, spelled as the page spells them (the apps they work in all day, the software that already sends them messages or alarms, the hardware or services involved), and where they are when it matters (on site, on call, away from a desk).
- segments: the two to five strongest kinds of buyer, each with the reason this page fits them. A segment is a kind of team or business, never a product or brand name.
- triggers: named events that send them looking now: something that broke or is being shut down, a rule or registration they ran into, a deadline, a quote that came back too expensive, a costly miss. Use the page's own events, named as specifically as the page names them.
- values: what they value, including price. Name the price or plan only when the page states it.
- poor fit: who is a poor fit, each with the reason, such as a different job the page does not do or a buyer who needs features the page says are missing.
${JSON_ONLY_RULE}
`

export const BUYER_PROMPTS_TEMPLATE = `Template: buyer_prompts.md
You are writing buyer prompts: the questions real buyers type into Google or an AI assistant before they know which company sells the answer. CiteFox searches each prompt and checks whether this page is cited.

{{ business_block }}
{{ product_block }}
{{ market_block }}
{{ competitor_block }}

The page the prompts are tested against (facts only; never copy its wording):
${PAGE_DATA}

The buyer profile, the market lines and any canonical prompts follow this template. Write from the buyer profile: its roles, named tools, segments, trigger events, values, and poor fit.

Write exactly {{ prompt_count }} prompts, no more and no fewer.
- Each prompt is one buyer in one situation, in the first person: who is asking, the tool or system they use now (named), what just happened or what worries them, and what they want. For example: "We use [named tool] and [what happened]. How do I [outcome]?"
- Write what a buyer would ask before they have seen this page. Never reuse the page's own scenarios, examples, step names or FAQ questions: give a different buyer in a similar situation, in their own words.
- Full sentences, about 15 to 30 words and never more than 32 (Google reads at most 32). Never a short keyword search such as "best software for small business".
- Never write the brand names listed above, or an alias of them.
- Every prompt is a different situation. Do not rephrase the same question.

Give each prompt exactly one intent stage:
- problem: they describe the pain or the job in their own words, before they know what kind of tool solves it.
- solution: they ask how to do it, or what kind of tool or service does it.
- comparison: they weigh kinds of solutions, or name one or two direct or partial competitors from the list above. Never a switch-from option or a tool used with it, and never the brand.
- objection: a doubt they check before buying, such as price, setup time, compliance, reliability, or where replies go.
- trigger: a named trigger event from the buyer profile has just happened and sends them looking now.
With 5 or more prompts, write at least one comparison prompt; when the list above has direct competitors, at least one comparison prompt names one of them.
Switch-from options may appear only as what the buyer used before (for example in a trigger prompt). Tools used with it may appear only as the buyer's current tools.

Map each prompt to one source:
- title_meta_h1: the promise in the title, meta description, or H1.
- trigger_event: a named trigger event from the buyer profile.
- objection: a doubt the buyer checks before buying.
- detail_check: a specific detail the page should answer.
Use every one of these sources across the set: title_meta_h1, trigger_event, and objection.
label is a short name for the situation. mappedElement is the page element the prompt maps to, named as it appears on the page: the H1, an H2 or H3, an FAQ question, or a note.
${JSON_ONLY_RULE}
`

/**
 * The combined content-gap step, retired by the three kinds below (Docs/PROMPT-AUDIT.md
 * section 3, rule 6). Kept so its shipped row and old project versions stay readable;
 * it never runs.
 */
export const COVERAGE_TEMPLATE = `You are writing a coverage matrix for the buyer prompts against the live page, then the one-by-one fixes and the page-wide fixes.
Check the page text before you call anything a gap. If the page already answers it, it is not a gap.

Read the live page first. Last modified: {{ last_modified }}
Page URL: {{ url }}
Title: {{ title }}
Meta description: {{ meta_description }}
H1: {{ h1 }}
Brand name: {{ brand_name }}
Prompt count: {{ prompt_count }}

Outline:
{{ outline }}

FAQs on the page:
{{ faqs }}

Body:
{{ page_text }}

The buyer prompts follow this template, numbered from 1. Write one row per prompt, with position set to its number.

The matrix, for each prompt:
- coverage: strong, partial, weak, or none. Judge it as the buyer would, reading the page for this exact question.
  - strong: Strong only when the page answers this exact question explicitly, in a place a reader would find it (a heading, an FAQ, a step, or a table that addresses it), for this buyer's situation. A related section, a passing sentence, or an answer the reader has to piece together from several places is not strong.
  - partial: the page answers part of the question, or answers it for a different situation, or the answer is buried where this buyer would not look.
  - weak: the page only mentions the topic in passing, with no answer the buyer could act on.
  - none: the page does not touch it.
- whereCovered: every place on the page that covers it now, several when there are several (the H1, an H2 or H3, an FAQ question, a table, the intro, a call to action). Copy each place exactly as it is written on the page. Name a heading only when that heading appears on the page. Each entry is only a heading or sentence copied from the page, or a page part (the H1, Intro, FAQ section, a table, the call to action), never a description of what it says: what it says goes in currentContent. Leave the list empty only for none.
- mainGap: the main thing the page misses for this buyer's situation, verified against the page text.
- actions: update_existing (update an existing FAQ or section), new_faq, small_update, optional_faq, or none.
- priority: high, medium, or low. A trigger event the page barely covers is high.

One by one, for each prompt:
- currentContent is "What's there now": what the page says today, closely summarized. Put words in double quotes only when they are copied character for character from the page.
- whatToUpdate is "What to update": specific edits, naming the section, the sentence to add or change, and the words to use. It must not repeat a fact that a factual_claim finding says is wrong; use the corrected fact, or leave that number out.
- suggestedFaq is "New FAQ: yes/no". Every partial, weak, or none row has a suggestedFaq: the question as this buyer would ask it and a 40 to 70 word answer in the page's voice. A strong row has one only when actions include new_faq or optional_faq; otherwise it is null.
Do not invent a price, a date, or a fact the page does not confirm. A new FAQ answer is 40 to 70 words.

Then the page-wide fixes in findings, not tied to one prompt:
- title_length: the title is long enough to be cut in search results, especially when the cut hides the strongest differentiator.
- title_meta_mismatch: the title, meta description, and H1 promise different things.
- factual_claim: a factual error on the page, with the correct fact and a note to re-verify it at the source.
- missing_promised_section: a section the intro promises that the page does not deliver.
- typo: a typo, such as an FAQ question that ends in two question marks.
- other: anything else that affects the whole page.
Put text in double quotes only when it is copied exactly from the page.
Reply with JSON that matches the schema and no other text.
`

export const COVERAGE_MATRIX_TEMPLATE = `Template: coverage_matrix.md
You are rating how well one page answers each buyer prompt listed after the page. Rate only: do not write fixes, FAQs or page-wide findings.

The page:
${PAGE_DATA}

${COVERAGE_RUBRIC}

The prompts follow this template, each with its number, its intent stage and its source. Write one row per prompt, with position set to its number.
- coverage: strong, partial, weak, or none, judged as this buyer, reading the page for this exact question.
- whereCovered: every place on the page that covers it now, several when there are several. Each entry is only a heading, an FAQ question or a short sentence copied exactly from the page, or a page part (the H1, Intro, FAQ section, a table, the call to action). Never a description of what it says. Empty only for none.
- mainGap: one or two sentences on what this buyer still cannot find on the page, named specifically: the missing step, number, comparison, tool or situation. For a strong row, the one small change that would make the answer more direct, or exactly "Answered directly." when there is none. Never start with "None" or "Answered directly." before a change.
- priority: high when the buyer is close to acting (a trigger, an objection or a comparison) and the page is weak or none; medium when the page answers part of it; low when it is strong or the prompt is a side detail.
- actions: update_existing (improve an existing section or FAQ), new_faq, small_update, optional_faq, or none. A strong row uses small_update or none.
Put words in double quotes only when they are copied character for character from the page.
${JSON_ONLY_RULE}
`

export const PAGE_AUDIT_TEMPLATE = `Template: page_audit.md
You are proofreading one page for page-wide problems that a buyer or a search engine would notice. You are not rating it against buyer questions.

{{ market_block }}

The page:
${PAGE_DATA}

CiteFox measures the title and meta description lengths and reports cut-offs itself; the measured lengths follow this template as facts. Do not report length.

Find, most important first, at most 8:
- title_meta_mismatch: the title, meta description and H1 promise different things (a different buyer, product, outcome or number).
- factual_claim: a statement of fact that is wrong or out of date: a technical standard, a law or rule, a provider's or platform's policy, or a number that contradicts another part of the page. Give the correct fact in correction only when you are sure of it, else null. Say in verify where to re-check it (the standard, the regulator, the vendor's page), else null.
- missing_promised_section: the intro, a heading or a list of contents promises something the page never delivers.
- typo: a spelling mistake, doubled punctuation, a broken sentence or a wrong word.
- other: anything else on the whole page a buyer would trip over, such as two parts of the page that contradict each other.
For each finding:
- quote: the exact words from the page, copied character for character, short (one phrase or sentence).
- text: one sentence a page owner can act on, under 200 characters.
- correction and verify: as above; null when they do not apply.
Report only real problems. An empty list is the right answer for a clean page; do not pad it.
${JSON_ONLY_RULE}
`

export const COVERAGE_FIXES_TEMPLATE = `Template: coverage_fixes.md
You are writing fixes for buyer prompts this page answers only partly or not at all. For each prompt listed after this template: what the page says now, what to update, and a new FAQ.

{{ business_block }}
{{ market_block }}

The page's headings, in order:
<page_text>
H1: {{ h1 }}
{{ outline }}
</page_text>
${DATA_FENCE_RULE}

Each prompt follows with its rating, where the page covers it, its main gap and the page sections that matter, fenced as data. Corrections from the page audit follow too: use the corrected fact and never repeat the wrong one.
- position: the prompt's number.
- currentContent: what the page says today for this buyer, closely summarized from the sections given, in one to three sentences. When the page says nothing, say so and name the closest section.
- whatToUpdate: one to three specific edits, most valuable first, each naming the section exactly as it is written on the page (or where a new block goes), the sentence to add or change, and the words to use. Answer this buyer's situation: their named tool, event or worry.
- suggestedFaq: the question as this buyer would ask it, in their words, and the answer.
${FIX_DRAFT_RULES}
${JSON_ONLY_RULE}
`
