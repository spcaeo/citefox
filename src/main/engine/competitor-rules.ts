/**
 * What counts as a competitor, in one place (Docs/FEEDBACK.md row 3). Every
 * Claude step that suggests competitors uses these words: "Fill from my
 * website", the topic wizard's seed discover, and (as a short line) the steps
 * that write comparison questions or prompts. `competitor-guard.ts` applies the
 * same rules in code after the reply.
 *
 * The live textbolt.com run listed AT&T, Verizon and T-Mobile (their email-to-text
 * gateways shut down, and TextBolt gains those users) and WIN-911 (alarm software
 * that sends through TextBolt) as competitors. They are what buyers switch from,
 * and an integration.
 */

export const COMPETITOR_DEFINITION =
  'A competitor is another company selling a product the same buyer could choose instead of this business, for the same job, today.'

/** The short line for steps that only use competitors (comparison questions, keywords, prompts). */
export const COMPETITOR_SHORT_RULE = `${COMPETITOR_DEFINITION} Services that were shut down or discontinued and that this business replaces are what buyers switch from, not alternatives. Carriers, platforms the product runs on, and integrations or tools users send from are not competitors either.`

/** The full rules for steps that suggest competitors from the site's pages. */
export const COMPETITOR_RULES = `What counts as a competitor:
- ${COMPETITOR_DEFINITION}
- Not competitors:
  - services that were shut down or discontinued and that this business replaces. A page called an "alternative", "migration", "replacement" or "shutdown" page about such a service means buyers switch from it: put it in switchingFrom.
  - carriers, infrastructure and platforms the product runs on.
  - integrations, partners and tools that users connect it to or work from: put them in integrations.
  - marketplaces, review sites, directories, "best of" lists, publishers and media, and the business's own brands. A site that ranks in search results or is cited next to this business is not a competitor for that reason alone.
- Fewer is better than weak evidence: leave out a company the pages do not clearly show selling the same thing.
- Strong evidence of a competitor: an "X vs us", compare or "alternatives to X" page where X is a live product, or a pricing comparison.
- Every item cites evidence from the pages read: evidence.path is the page path (such as /compare) and evidence.quote is a short quote copied from that page. Leave out anything the pages do not show.
- domain: only when the pages link to or name that exact domain. Otherwise null (domain unknown). Never guess a domain, and never put a note or [brackets] in it.
- reason: for a competitor, why a buyer would choose them instead; for switchingFrom, what changed for the people who used it; for integrations, how it is used with this product. Write one or two plain sentences a buyer could read, using what the pages show. Never write about the pages, the reading or what is missing (no "the pages read do not show…"): leave out what you cannot say. An unconfirmed fact may go in [brackets], never a note or an instruction to the reader (no "Confirm … before publishing").`

/**
 * Batch 2 row 5: the web-search question asked once per product. Short on purpose: the
 * definition, the two tiers, and what to leave out. The domain, price and source rules
 * live in the reply shape (`assist-shapes.ts`).
 */
export const PRODUCT_COMPETITOR_RULES = `${COMPETITOR_DEFINITION}
- direct: a buyer looking for this exact product would shortlist it: it markets the same capability by name (a page or plan for it) to the same kind of buyer, even when it also sells other things or differs in details such as price or how replies work. Usually 6 to 10, closest first; fewer when independent sources show fewer.
- partial: products that can do the job but are built and marketed around another job (such as a broad suite where this is one feature among many), developer APIs that need code (at most 3, the best known), and on-premise or self-hosted options. Up to 12.
- Leave out what is not a competitor: services that shut down or are being replaced (buyers switch from them), carriers and platforms the product runs on, tools used together with it (apps it connects to), parent companies named without a product, marketplaces, review sites, directories, "best of" lists and publishers. A site that only ranks for these searches is not a competitor.
- Fewer is better than weak evidence: never pad the list with a company you could not confirm sells this.`

/** Batch 2 row 5: what buyers switch from and integrations, from the site's own pages only. */
export const SWITCHING_RULES = `These are not competitors. ${COMPETITOR_DEFINITION}
- switchingFrom: services that were shut down, discontinued or are being retired, that buyers move to this business from (such as a product its maker retired). An "alternative", "migration", "replacement" or "shutdown" page about such a service means buyers switch from it.
- integrations: tools used together with it: apps and services it connects to, imports from or runs on, as the pages name them. Never the business's own products.
- Leave out live competitors, marketplaces, review sites and the business's own brands.
- Every item cites evidence.path (the page path, such as /pricing) and evidence.quote (a short quote copied from that page). Leave out anything the pages do not show.
- domain: only when the pages link to or name that exact domain, else null.
- reason: one or two plain sentences: for switchingFrom, what changed for the people who used it; for integrations, how it is used with this product. Never write about the pages or what they do not show.`
