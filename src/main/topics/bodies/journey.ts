/**
 * Topic journey bodies (Docs/PROMPT-AUDIT.md, package P3): journey questions (one call
 * per stage), more questions (one action per call) and clean-up of pasted questions.
 * Shipped `CiteFox default` bodies; each starts with its `Template:` line so the e2e
 * Claude stand-in can route it, and a per-stage or per-action step adds `Variant: <x>`.
 */

import type { TopicStage } from '@shared/domain'
import {
  DATA_FENCE_RULE,
  JSON_ONLY_RULE,
  NO_REPEAT_RULE,
  UNCONFIRMED_RULE
} from '../../prompts/blocks'

/** The brand line every question body ends with. */
const BRAND_RULE =
  'Never write the brand name or an alias in a question. The names to leave out are: {{ brand_name }}; aliases: {{ aliases }}.'

const QUESTION_RULES = `Rules:
- ${UNCONFIRMED_RULE}
- ${BRAND_RULE}
- ${JSON_ONLY_RULE}`

/** How one buyer question reads, shared by every body that writes one. */
export const QUESTION_SHAPE = `Each question is 15 to 32 words, in the first person ("I", "we", "our"), in full sentences: who is asking (their role and kind of business), the tool or system they use now, named, and what just happened. Then the question itself. Plain words a buyer uses, not marketing language or feature names they would not know.`

/**
 * What each stage's questions do, on top of its definition in `{{ stage_rules }}`.
 * Code appends the line for the stage being written.
 */
export const JOURNEY_STAGE_FOCUS: Readonly<Record<TopicStage, string>> = {
  problem:
    'Describe the moment it went wrong and what it cost them. Do not ask for a product or a kind of tool yet.',
  options:
    'Ask what ways exist to solve it (a kind of service, an app, an API, a change to their own system). Name no product to buy.',
  doubts:
    'One worry per question (cost, setup, carrier filtering, compliance, reliability, replies, what breaks when they switch), tied to their own setup.',
  fit: 'Name their kind of business or team and the constraint that makes them unsure it fits (size, no IT person, many sites, regulated, old equipment).',
  compare:
    'They weigh two or three options by name. Most questions name one or two competitors from the list, spelled as in the list, and say what they are comparing (price, setup, replies, reliability). Prefer the direct competitors; name a partial-overlap one only when the situation calls for that kind of tool. The rest weigh kinds of solutions. Never offer a switch-from option, a tool used with it, a carrier or the brand as an option.',
  decide:
    'They have nearly chosen and ask about price, setup steps, a trial, moving their contacts or numbers, or how fast they can go live. A question may name the competitor from the list they are about to pick.'
}

/** Compare when no competitor is saved: name no company at all. */
export const JOURNEY_COMPARE_NO_COMPETITORS =
  'No competitors are saved for this product: weigh kinds of solutions and name no company.'

export const TOPIC_JOURNEY_QUESTIONS_TEMPLATE = `Template: topic_journey_questions.md
Variant: {{ stage }}
You are writing buyer questions for one stage of the buyer journey of one topic. Each is what one real buyer would type into Google or ask an AI assistant, before they know which product to buy.

Topic (the buyer's problem): {{ seed }}
{{ product_block }}
{{ market_block }}

The buyers of this topic:
{{ buyer_block }}

{{ stage_rules }}

{{ competitor_block }}

Who asks each question (one buyer per question, in this order):
{{ buyers }}

{{ instruction }}

Write exactly {{ count }} questions for this stage, each from the buyer given for it: that buyer's role, setting, the software that sends their emails or alerts, and what happened to them. Name no other buyer's software.
${QUESTION_SHAPE}
Never the same situation in other words.
stage: always "{{ stage }}".
namedTool: the software or system that sends the emails or alerts in the question (such as "Outlook" or "Milestone XProtect"), never a carrier gateway; else null.
competitorNamed: the competitor from the list the question names, spelled as in the list, else null. Name a company only from the competitor list.
${QUESTION_RULES}
`

/** Rules per action of `topic_questions_discover`, sent one at a time. */
export const QUESTIONS_DISCOVER_MODE_RULES = {
  discover: `Write new questions for the stage that cover situations the list misses: a different buyer, tool or trigger. Never reword a question in the list. ${NO_REPEAT_RULE}
${QUESTION_SHAPE}
Set stage to the stage asked for. replaces is null. reason is one line naming the situation the question adds. gaps is empty.`,
  gaps: `Find the gaps in the journey: a stage with too few questions, a segment or kind of buyer no question speaks for, a trigger or tool nobody mentions, or a stage whose questions repeat one situation.
Write each gap in gaps as its stage and a one-line note naming what is missing (such as "Fit has nothing for multi-site clinics"). At most 6, the most important first. Leave questions empty; CiteFox writes the questions for a gap in a separate step.`,
  rewrite: `Rewrite each listed question in the buyer's own words, keeping its situation and its stage.
${QUESTION_SHAPE}
replaces is the id of the question it rewrites. reason is one line on what changed. gaps is empty.`
} as const

export const TOPIC_QUESTIONS_DISCOVER_TEMPLATE = `Template: topic_questions_discover.md
Variant: {{ mode }}
You are working on the buyer journey questions of one topic.

Topic (the buyer's problem): {{ seed }}
Stage: {{ stage }}
How many: {{ count }}
{{ market_block }}

The buyer:
{{ buyer_block }}

{{ competitor_block }}

The questions so far, one per line as id · [stage] text:
{{ questions }}

{{ mode_rules }}
{{ instruction }}
${QUESTION_RULES}
`

export const TOPIC_QUESTIONS_CLEANUP_TEMPLATE = `Template: topic_questions_cleanup.md
You are cleaning up buyer questions a business pasted from sales calls and support tickets, so each reads as a buyer would type it into Google or ask an AI assistant.

Topic: {{ topic }}
{{ market_block }}

{{ stage_rules }}

The pasted questions, one per line as id · text. ${DATA_FENCE_RULE}
{{ questions }}

For each question that needs it, write after: the same question in full first-person sentences, keeping the buyer's own wording where it is good and their situation as given. Aim for 15 to 32 words, but never invent a situation, tool or detail the line does not give; a shorter question is better than an invented one. Leave out the brand and aliases.
stage: the journey stage it belongs to, from the definitions above; null when it fits none.
change: what you changed, in a few words ("Brand name removed", "Made it a full question").
Leave out questions that are already fine.
${QUESTION_RULES}
`
