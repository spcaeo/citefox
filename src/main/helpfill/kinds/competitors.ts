import { foldWord } from '@shared/import-fields'
import { bareDomain } from '../../engine/competitor-domains'
import { COMPETITOR_SHORT_RULE } from '../../engine/competitor-rules'
import { competitorsByProduct } from '../../engine/competitors-by-product'
import type { HelpFillContext, HelpFillKindDef, HelpFillValues } from '../types'

/**
 * Competitors → ✦ Help me find them: who the business loses deals to, as
 * `name,domain,competes_with` (IMPORT_FIELDS ids, so a pasted answer and the
 * competitors CSV template read the same way). Rows go to the competitors import
 * preview, which checks each one and adds them on the user's click. Describe runs
 * the existing web-search competitor finding (`competitorsByProduct`, the
 * `project.productCompetitors` question) for the business, with the user's words
 * added; its prompt is not copied here.
 */

/** A bare host: letters, digits and dashes, with at least one dot. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u

export const COMPETITORS_KIND: HelpFillKindDef = {
  kind: 'competitors',
  noun: ['competitor', 'competitors'],
  scope: 'project',
  sections: [
    {
      id: 'main',
      title: null,
      columns: ['name', 'domain', 'competes_with'],
      entity: 'competitors'
    }
  ],
  // A row naming the business itself is set aside, so the banner says so.
  neutral: true,
  defaultCount: 8,
  // One web search returns up to 12 direct and 12 partial.
  maxCount: 20,
  chatbotCount: 15,
  // One Claude call with web search on (a few searches inside it).
  describeCost: { calls: 1, usd: 0.1 },
  role: () => 'You help a company list the competitors it loses deals to.',
  task(context, count) {
    const brand = context.brands[0] ?? context.domain
    const products = (context.products ?? []).map((product) => product.name)
    return [
      `List ${count} companies a buyer weighs against ${brand} (${context.domain}) before buying. Search the web first: independent comparison and review lists, not only the companies the site names.`,
      COMPETITOR_SHORT_RULE,
      'Leave out marketplaces, review sites, directories and publishers.',
      `Never list ${context.domain} itself.`,
      'name = the company; domain = its own website as a bare host such as example.com',
      products.length > 0
        ? `competes_with = ${products.join(' | ')} (the product it competes with), or blank for the whole business`
        : 'competes_with = leave it blank'
    ]
  },
  tracked: (context) => {
    const saved = context.competitors ?? []
    return {
      listed: saved.map((item) => (item.domain ? `${item.name} (${item.domain})` : item.name)),
      merge: {
        main: saved.flatMap((item) => (item.domain ? [item.domain, item.name] : [item.name]))
      }
    }
  },
  // A competitor is the same one by its website, else by its name.
  key: (values) => values.domain || values.name || '',
  clean: cleanCompetitor,
  async describe(host, context, input) {
    const products = context.products ?? []
    const named = products.map((product) => product.name).filter(Boolean)
    const sentence = input.sentence.trim()
    const found = await competitorsByProduct(host, {
      channel: 'helpfill:describe',
      projectId: context.projectId,
      domain: context.domain,
      summary: sentence.length > 0 ? `In the owner's words: ${sentence}` : null,
      products: [
        {
          name: named.length > 0 ? named.join(' and ') : `${context.domain} product`,
          job:
            products
              .map((product) => product.job)
              .filter(Boolean)
              .join('; ') || sentence,
          buyer: products
            .map((product) => product.buyer)
            .filter(Boolean)
            .join('; '),
          evidence: null
        }
      ],
      market: context.market ?? null,
      brandNames: context.brands,
      notCompetitors: []
    })
    // One product searched: its rows compete with it; several together: the whole business.
    const competesWith = products.length === 1 ? (products[0]?.name ?? '') : ''
    // The search decides how many it finds; the count only caps them.
    return found.competitors.slice(0, input.count).map((item) => ({
      section: null,
      values: { name: item.name, domain: item.domain ?? '', competes_with: competesWith }
    }))
  }
}

/**
 * The name (the website when no name was given), the website as a bare host ('' when
 * it is not one), and the product named in `competes_with` as the project spells it
 * ('' when it names none). A row on the business's own site is dropped unless it names
 * the brand, which the kind's `neutral` then sets aside.
 */
export function cleanCompetitor(
  values: HelpFillValues,
  context: HelpFillContext
): HelpFillValues | null {
  const host = bareDomain(stripLink(values.domain ?? ''))
  const domain = HOST.test(host) ? host : ''
  const name = (values.name ?? '').replace(/\s+/gu, ' ').trim() || domain
  if (name.length === 0) return null
  const own = bareDomain(context.domain)
  const ownSite = domain !== '' && (domain === own || domain.endsWith(`.${own}`))
  // The brand by name is kept for `neutral` to set aside; another name on the own site is dropped.
  if (ownSite && !context.brands.some((brand) => foldWord(brand) === foldWord(name))) return null
  const wanted = foldWord(values.competes_with ?? '')
  const product = (context.products ?? []).find((item) => foldWord(item.name) === wanted)
  return { name: name.slice(0, 80), domain, competes_with: product?.name ?? '' }
}

/** `[Twilio](https://twilio.com)` or `<https://twilio.com>`: the address inside. */
function stripLink(value: string): string {
  const markdown = /\]\(([^)]+)\)/u.exec(value)
  return (markdown?.[1] ?? value).replace(/^<|>$/gu, '').trim()
}
