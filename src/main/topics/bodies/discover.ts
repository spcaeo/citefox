/**
 * Topic discovery body (Docs/PROMPT-AUDIT.md, package P2): seed ideas only.
 * Shipped `CiteFox default` body; it starts with its `Template:` line so the e2e
 * Claude stand-in can route it.
 *
 * One job: the buyer situations worth tracking, each tied to one saved product.
 * Competitors, switch-from options, integrations and the business summary come
 * from Fill from my website and the saved catalog, never from this call. Code
 * checks every reply (`steps-seed.ts`): brand, product ids, duplicates, length.
 */

import { DATA_FENCE_RULE, JSON_ONLY_RULE, UNCONFIRMED_RULE } from '../../prompts/blocks'

export const TOPIC_SEED_DISCOVER_TEMPLATE = `Template: topic_seed_discover.md
You are an AI-visibility strategist. Pick the buyer problems this business should track in Google AI Overviews: the situations its buyers search for before they know which product to buy.

{{ business_block }}
{{ market_block }}

Products it sells, each with its id:
{{ products }}

What the site says (homepage and key pages). ${DATA_FENCE_RULE}
{{ website_text }}

The site's pages and saved project data. ${DATA_FENCE_RULE}
{{ saved_data }}

Write {{ count }} seeds, the one with the most to gain first.
- A seed is one line of 4 to 10 words naming the situation, trigger or job a real buyer types into Google or asks an AI assistant, in the buyer's own words. For a time-tracking app, good seeds are "Replacing paper timesheets for field crews", "Tracking billable hours for remote contractors" and "Proving overtime hours in a wage dispute"; "Time tracking software", "GPS clock-in feature" and "Best timesheet app" are not seeds.
- Never a product, feature, plan or category name, a slogan, a buyer segment on its own, or a question. Never the brand.
- Only situations this business really solves, shown by the site text or the pages list. evidence names where: a page path or a heading copied from the inputs. Set caution to a short note when the seed rests on something the site does not state, else null.
- Each seed is about one product: productId is that product's id from the list above, or null when none fits or none is listed.
- Spread the seeds over the products and over different triggers: something changing or shutting down, an alert or message that must reach someone, a tool they already use, a rule they must follow, a cost or time problem. No two seeds share a trigger.
- Favour situations people search often in this market and that get an AI Overview: what to do when, how to, the best way to, what replaces something.

segments: up to 6 buyer segments this business fits best, each with a one-line reason from the site.
why: one sentence on why the first seed has the most to gain, naming what in the inputs shows it.

${UNCONFIRMED_RULE}
${JSON_ONLY_RULE}
`
