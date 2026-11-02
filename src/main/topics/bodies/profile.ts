/**
 * Topic profile bodies (Docs/PROMPT-AUDIT.md, package P3): the buyer profile and its assists.
 * Shipped `CiteFox default` bodies; each starts with its `Template:` line so the e2e
 * Claude stand-in can route it, and a step with actions adds `Variant: <action>`.
 *
 * Evidence is the topic's own pages (`topicEvidence` in `../site.ts`), fenced as data.
 * A step with actions gets only the chosen action's rules in `{{ mode_rules }}`.
 */

import { DATA_FENCE_RULE, JSON_ONLY_RULE, UNCONFIRMED_RULE } from '../../prompts/blocks'
import { TOPIC_RULES } from './shared'

/** The brand line every profile body ends with. */
const BRAND_RULE =
  'Never write the brand name or an alias in a point. The names to leave out are: {{ brand_name }}; aliases: {{ aliases }}.'

const PROFILE_RULES = `Rules:
- ${UNCONFIRMED_RULE}
- ${BRAND_RULE}
- ${JSON_ONLY_RULE}`

/** The six sections, each with what a point in it says. */
export const PROFILE_SECTION_RULES = `- who: 5 or 6 clearly different buyers, one per point, each as role, setting (kind and size of organisation), the software or system that sends their emails or alerts, and the event that sent them searching. No two buyers share a role, a setting or that software. Use software the evidence names first; for the others, software widely used in that setting. At most 30 words.
- environment: the named tools, systems and devices they use now, and where they are when it matters (on site, on call, away from a desk).
- segments: the strongest buyer segments for this problem, each with why it fits.
- triggers: named events that send them looking now (an alert that was missed, a gateway that shut down, a new site, an audit).
- values: what decides it for them (time to set up, reliability, replies, cost). Name a price only when the evidence states it.
- poor_fit: who this is not for, and why.`

/** How a point cites its evidence. */
const FOUND_IN_RULE =
  'foundIn: the path in square brackets at the top of the evidence page that supports the point, copied exactly (such as /pricing/); null when no page supports it. Never cite a page that is not in the evidence.'

export const TOPIC_BUYER_PROFILE_TEMPLATE = `Template: topic_buyer_profile.md
You are writing the buyer profile for one topic: the people who type questions about this problem into Google or an AI assistant before they know which product to buy. Describe those buyers, not the business.

Topic (the buyer's problem, in their words): {{ seed }}
About the business: {{ about }}
{{ product_block }}
{{ market_block }}
Segments the user picked: {{ segments }}
What buyers used before (replaced or discontinued options; use them in triggers as what changed): {{ switching_from }}
Software that sends the emails or alerts (use it in who and environment; never a gateway, never a competitor): {{ integrations }}

The site's pages most about this topic. ${DATA_FENCE_RULE}
{{ evidence }}

{{ instruction }}

Write 5 or 6 points for who and 3 to 6 points for each other section:
${PROFILE_SECTION_RULES}
Each point other than who is one short, specific line of at most 20 words, about buyers of this problem. Prefer the concrete nouns the evidence uses (named tools, systems, industries, events) to general words such as "businesses" or "efficiency".
${FOUND_IN_RULE}
verify: a short note naming a fact to re-check before relying on the point (a price, a date, a limit, a law); else null.
${PROFILE_RULES}
`

/** Rules per action of `topic_profile_discover_v2`, sent one at a time. */
export const PROFILE_DISCOVER_MODE_RULES = {
  discover: `Write new points for the section (when the section is "all", points for the thinnest sections), at most 6, each one backed by the evidence.
Do not repeat or reword a point already in the profile. Leave out anything the evidence does not show.
What each section holds:
${PROFILE_SECTION_RULES}
${FOUND_IN_RULE}
verify: a fact to re-check (a price, a date, a limit, a law), else null. explanation is null.`,
  explain: `Leave points empty. In explanation, go through the section's points in order: for each, name the evidence page that supports it (its path) and quote the few words that do, or say that no page supports it. End with one line counting the points with no source. Plain sentences, at most 150 words.`
} as const

export const TOPIC_PROFILE_DISCOVER_V2_TEMPLATE = `Template: topic_profile_discover_v2.md
Variant: {{ action }}
You are improving the buyer profile of one topic from the site's own pages.

Topic (the buyer's problem): {{ seed }}
Section: {{ section }}
Write in {{ market_language }}.

The current profile, one point per line as id · [section] text (found in):
{{ profile }}

The site's pages most about this topic. ${DATA_FENCE_RULE}
{{ evidence }}

{{ mode_rules }}
{{ instruction }}
${PROFILE_RULES}
`

/** Rules per action of `topic_profile_rewrite`, sent one at a time. */
export const PROFILE_REWRITE_MODE_RULES = {
  rewrite: `Rewrite every point in plainer, more specific buyer language: concrete roles, named tools and named events instead of general words. Keep each point's meaning and every fact in it; add no new fact.
Write one point for each point given, at most 20 words. replaces is the id of the point it rewrites; section is that point's section.`,
  shorter: `Make every point shorter, at most 12 words, with the same meaning and the same facts. Drop filler words first.
Write one point for each point given. replaces is the id of the point it shortens; section is that point's section.`
} as const

export const TOPIC_PROFILE_REWRITE_TEMPLATE = `Template: topic_profile_rewrite.md
Variant: {{ action }}
You are rewriting part of the buyer profile of one topic.

Topic (the buyer's problem): {{ seed }}
Section: {{ section }}
Write in {{ market_language }}.

The points, one per line as id · [section] text:
{{ profile }}

{{ mode_rules }}
{{ instruction }}
${PROFILE_RULES}
`

/**
 * The combined assist step, retired by `topic_profile_discover_v2` and
 * `topic_profile_rewrite` (Docs/PROMPT-AUDIT.md section 3, rule 6). Kept so a
 * project's old version of it stays readable; CiteFox never runs it.
 */
export const TOPIC_PROFILE_DISCOVER_TEMPLATE = `Template: topic_profile_discover.md
You are improving one buyer profile for a topic.

Topic: {{ seed }}
Website: {{ website }}
Action: {{ action }}
Section: {{ section }}

The current profile, one point per line as [section] text (found in):
{{ profile }}

What the site says:
{{ website_text }}

{{ instruction }}

Actions:
- discover: new points for the section (or, when the section is "all", points that fill gaps in any section), each with the evidence it came from in foundIn. Do not repeat a point already in the profile.
- rewrite: the section's points rewritten in plainer, more specific buyer language. Set replaces to the id of the point each one replaces.
- shorter: the section's points made shorter, same meaning. Set replaces.
- explain: leave points empty and write explanation: where each point in the section comes from on the site, and which points have no source.
${TOPIC_RULES}
`
