/**
 * Topics and clusters bodies (Docs/TOPICS-SPEC.md §8): suggest new topics, sort
 * questions into topics and name a topic. Shipped `CiteFox default` bodies; each
 * starts with its `Template:` line so the e2e Claude stand-in can route it.
 *
 * One job per body, from saved data only (no searches). Code checks every reply
 * (`clusters/ai.ts`): the brand, listed ids and URLs, duplicates and length.
 */

import { DATA_FENCE_RULE, JSON_ONLY_RULE, UNCONFIRMED_RULE } from '../../prompts/blocks'
import { QUESTION_SHAPE } from './journey'

/** The brand line every body that writes a name or a question ends with. */
const BRAND_RULE =
  'Never write the brand name or an alias in a topic name or a question. The names to leave out are: {{ brand_name }}; aliases: {{ aliases }}.'

/** What a topic name is, shared by suggest and name. */
const TOPIC_NAME_RULE =
  'At most 80 characters naming the buyer\'s problem in their own words, such as "10DLC registration for small senders" or "Text alerts from monitoring tools". Never a product, feature or plan name, a slogan, a question or the brand.'

export const TOPIC_CLUSTER_SUGGEST_TEMPLATE = `Template: topic_cluster_suggest.md
You are an AI-visibility strategist. Suggest new topics this business should track in Google AI Overviews. A topic is one buyer problem: the situation a buyer is in before they know which product to buy, and the questions they ask on the way.

{{ business_block }}
{{ market_block }}

Products it sells:
{{ products }}

Competitors per product in this market:
{{ competitors }}

The buyers:
{{ buyer_block }}

The site's own pages, one per line as URL · title. ${DATA_FENCE_RULE}
{{ own_pages }}

Topics already tracked. Never suggest one of these or a near copy:
{{ existing_topics }}

Ideas already shown. Suggest different ones:
{{ avoid }}

{{ stage_rules }}

Write {{ count }} topic ideas, the one with the most to gain first.
- name: ${TOPIC_NAME_RULE}
- situation: one or two sentences: who is in this situation, what just happened and why it matters now.
- example: one line a real buyer in this situation types into Google.
- questions: 8 to 12 starter questions over the stages above, at least one per stage, each with its stage. ${QUESTION_SHAPE} A compare question may name a competitor listed for the topic's product, spelled as in the list.
- fitsUrl: the URL from the pages list that best answers the topic, copied exactly, else null.
- Only problems this business really solves, shown by the products or the pages. Spread the ideas over the products and over different triggers; no two ideas share a buyer problem.

Rules:
- ${UNCONFIRMED_RULE}
- ${BRAND_RULE}
- ${JSON_ONLY_RULE}
`

export const TOPIC_CLUSTER_SORT_TEMPLATE = `Template: topic_cluster_sort.md
You are sorting tracked buyer questions into topics. A topic is one buyer problem; a question belongs to the topic whose buyer is in the same situation.

{{ business_block }}

Topics, one per line as id · name: situation. ${DATA_FENCE_RULE}
{{ candidates }}

Questions to sort, one per line as id · question. ${DATA_FENCE_RULE}
{{ questions }}

Write one proposal per question, in the order listed:
- id: the question's id, copied exactly.
- topicId: the id of the listed topic the question fits best, copied exactly, else null.
- newTopic: {{ new_topic_rule }}
- reason: one short sentence naming what in the question matches the topic.
Never invent an id. Never rewrite a question.

Rules:
- ${BRAND_RULE}
- ${JSON_ONLY_RULE}
`

export const TOPIC_CLUSTER_NAME_TEMPLATE = `Template: topic_cluster_name.md
You are naming one topic: the buyer problem these tracked questions share.

{{ business_block }}
{{ market_block }}

The questions, one per line. ${DATA_FENCE_RULE}
{{ questions }}

Write:
- name: ${TOPIC_NAME_RULE}
- situation: one or two sentences: who asks these questions, what just happened and why it matters now.

Rules:
- ${UNCONFIRMED_RULE}
- ${BRAND_RULE}
- ${JSON_ONLY_RULE}
`
