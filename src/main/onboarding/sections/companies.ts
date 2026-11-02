import type { SetupContext, SetupRow } from '@shared/ipc'
import { PRODUCT_COMPETITOR_RULES } from '../../engine/competitor-rules'
import { notCompetitorReason } from '../../engine/project-settings/competitors'
import {
  cell,
  clip,
  hostOf,
  isOwnHost,
  isOwnName,
  marketOf,
  productNamed,
  sameName,
  withDetail
} from './rows'
import { fold } from '../../engine/site-grounding'
import { isOwnProduct, siteNames } from './ground'
import type { ListSectionDef, SiteGround } from './types'

/**
 * Step 6: competitors (web search on), what buyers switch from, and what it is used
 * with. The competitor question and rules are the per-product ones
 * (`engine/product-competitors.ts`, `PRODUCT_COMPETITOR_RULES`); switch-from and
 * integrations use `SWITCHING_RULES`' words. The code guards follow
 * `guardProductCompetitors`: never the brand's own name or domain, never a name listed
 * as switch-from or integration, never a carrier, review or community site. A missing
 * domain never drops a row.
 *
 * Prompt bench report 2026-10-31: competitor names with ":" or a "Sources" line are
 * dropped and a bare parent company becomes its product; switch-from has two kinds
 * (retired products, and live products the site's own switch pages name, which must be
 * on the site); integrations start from the tools the pages name, never the business's
 * own products, and at most four the pages do not name.
 */

/** True when a company row is left out (the brand itself, a listed non-competitor, a review site…). */
function companyRejected(
  name: string,
  host: string | null,
  context: SetupContext,
  notThese: readonly string[],
  rival: boolean
): boolean {
  if (isOwnName(name, context) || isOwnHost(host, context.domain)) return true
  if (notThese.some((other) => sameName(other, name))) return true
  // Carriers and review sites are never competitors, but buyers may switch from a carrier.
  return rival && host !== null && notCompetitorReason(host, [], new Set()) !== null
}

function companyRow(
  values: Readonly<Record<string, string>>,
  context: SetupContext,
  notThese: readonly string[],
  rival = false
): SetupRow | null {
  const host = hostOf(cell(values, 'domain'))
  const said = cleanCompanyName(clip(cell(values, 'name') || host || '', 80))
  // "Trello Alternative: Teamwork.com", "Sources: …": not a company name.
  if (said.includes(':') || /^(?:sources?|references?|notes?)\b/iu.test(said)) return null
  const why = cell(values, 'why')
  const name = rival ? productOfParent(said, why) : said
  if (name.length < 2 || companyRejected(name, host, context, notThese, rival)) return null
  return { name, detail: clip(why, 400), url: host, tag: null }
}

/**
 * A name as the search result titled it: "Ramp alternative Mercury" and "Mercury (Ramp
 * alternative)" are "Mercury"; "Alternatives to X" is no name at all (left for the caller).
 */
export function cleanCompanyName(name: string): string {
  let out = name.trim()
  out = out.replace(/\s*\((?:an?\s+)?[^()]*\balternatives?\b[^()]*\)\s*$/iu, '')
  const after = /^\S.*?\s+(?:alternatives?|vs\.?|versus)\s+(\S.*)$/iu.exec(out)
  if (after?.[1] !== undefined) out = after[1]
  return out.trim()
}

/** Parent companies that sell many products: a bare one is named by its product. */
const PARENTS =
  /^(?:microsoft|google|amazon|aws|apple|meta|oracle|sap|intuit|adobe|ibm|cisco|salesforce\.com|alphabet)$/iu

/** "Microsoft" with a why that says "Microsoft Dynamics 365 …" becomes "Microsoft Dynamics 365". */
export function productOfParent(name: string, why: string): string {
  if (!PARENTS.test(name.trim())) return name
  const found = new RegExp(
    `\\b${name.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}((?:\\s+(?:[A-Z0-9][\\w.+-]*)){1,3})`,
    'u'
  ).exec(why)
  if (found === null) return name
  const words = (found[1] ?? '').trim().split(/\s+/u)
  // Stop at a word that starts a sentence part ("Microsoft Teams Is …" keeps "Teams").
  const kept: string[] = []
  for (const word of words) {
    if (/^(?:Is|Are|Has|Offers|Sells|Lets|And|For|With|The|A|An)$/u.test(word)) break
    kept.push(word.replace(/[.,;]+$/u, ''))
  }
  return kept.length === 0 ? name : `${name.trim()} ${kept.join(' ')}`
}

/** Switch-from names that are not also listed competitors (a live rival can be both). */
function switchOnly(context: SetupContext): string[] {
  return context.switchingFrom.filter(
    (name) => !context.competitors.some((row) => sameName(row.name, name))
  )
}

/** A company is the same one by its website, else by its name. */
const companyKeys = (row: SetupRow): readonly string[] =>
  row.url === null ? [row.name] : [row.url, row.name]

export const COMPETITORS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'competitors',
  noun: ['competitor', 'competitors'],
  context: ['website', 'market', 'summary', 'brands', 'products', 'switchingFrom', 'integrations'],
  webSearch: true,
  usd: 0.1,
  columns: ['name', 'domain', 'product', 'tier', 'why'],
  entity: 'competitors',
  fields: { product: 'competes_with' },
  count: 10,
  maxRows: 24,
  neutral: false,
  role: () => 'You help a company list the competitors it loses deals to.',
  task(context, count) {
    const market = marketOf(context)
    const where = market === null ? '' : `, for buyers in ${market}`
    const products = context.products.map((product) => product.name)
    const product = products[0] ?? 'product'
    const notThese = [...switchOnly(context), ...context.integrations]
    return [
      `What are the competitors of ${context.domain} that do exactly what it does${where}? Search the web first with several searches (such as "best ${product}", "${context.domain} alternatives" and independent comparison or review lists), then answer with up to ${count} companies that come up most often across independent sources, not only the ones ${context.domain} names.`,
      '',
      PRODUCT_COMPETITOR_RULES,
      ...(market === null
        ? []
        : [
            `- Only companies that sell this to buyers in ${market} today. Leave out providers built mainly for other countries.`
          ]),
      `- Never list ${context.domain} itself or any product made by the same company${context.brands.length > 0 ? ` (its own brands: ${context.brands.slice(0, 12).join(', ')})` : ''}, even one the pages do not name.`,
      ...(notThese.length === 0
        ? []
        : [
            `- Not competitors (buyers switch from them, or use them with it): ${notThese.join(', ')}.`
          ]),
      '',
      'name = the product as buyers know it (such as "Microsoft Bookings", not "Microsoft")',
      'domain = its own website as a bare host such as example.com, or blank when unsure',
      products.length > 0
        ? `product = the product it competes with: ${products.join(' | ')} (or blank for the whole business)`
        : 'product = leave it blank',
      'tier = direct | partial',
      'why = one plain sentence for a buyer about what it does and why it matches; never mention your search or your sources',
      'Nothing after the CSV: no sources, no notes.'
    ]
  },
  toRow(values, context, ground) {
    const notThese = [...switchOnly(context), ...context.integrations]
    const row = companyRow(values, context, notThese, true)
    // Its own products (the read's brands, "Acme Pay" for Acme) are never competitors.
    if (row === null || isOwnProduct(row.name, context, ground)) return null
    const tier = cell(values, 'tier').toLowerCase().startsWith('partial') ? 'partial' : 'direct'
    return { ...row, tag: productNamed(cell(values, 'product'), context), tier }
  },
  keys: companyKeys,
  line: (row) => withDetail(row.name, row.url)
}

/** The two kinds of switch-from row, in the `kind` column and the row's tag. */
export const SWITCH_KINDS = ['retired', 'migration'] as const

export const SWITCHING_FROM_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'switchingFrom',
  noun: ['option buyers switch from', 'options buyers switch from'],
  context: ['website', 'summary', 'products', 'competitors', 'integrations'],
  site: ['compared', 'switching', 'paths'],
  webSearch: false,
  usd: 0.01,
  columns: ['name', 'domain', 'kind', 'why'],
  entity: null,
  count: 6,
  maxRows: 12,
  neutral: false,
  role: (context) => `You help set up AI-search tracking for ${context.domain}.`,
  task: (context, count) => [
    `List up to ${count} products buyers move to ${context.domain} from, of two kinds. Give both kinds when you know them:`,
    `- retired: a product for the same job that was shut down, discontinued, or is being retired by its maker. Use what you know, not only the pages (such as Google App Maker for an app builder). Always check for these, but list only ones you are sure of: never a product that was only renamed or merged into a live product, and never a failed bank or a different kind of product.`,
    `- migration: a live product the site's own pages help buyers switch from or compare with by name (a "switch from", "migrate from", "import from", "alternative" or "vs" page, or a quote above). Only names the pages show. It may also be a competitor or a tool listed above: still list it.`,
    'Leave out marketplaces, review sites and the business’s own brands. Reply with the header only when you know none of either kind.',
    'name = the product; domain = its bare host such as example.com, or blank',
    `kind = ${SWITCH_KINDS.join(' | ')}`,
    'why = one plain sentence: what changed for its users, or what the site offers people who switch'
  ],
  toRow(values, context, ground) {
    const kind = cell(values, 'kind').toLowerCase().startsWith('migr') ? 'migration' : 'retired'
    // A live product the site helps buyers leave may also be a competitor or a tool it
    // imports from (round 2: Retool imports Lovable apps); it must be on the site.
    const row = companyRow(values, context, [])
    if (row === null) return null
    if (kind === 'migration') {
      return onSiteAsSwitch(row.name, ground) ? { ...row, tag: kind } : null
    }
    // A retired product is never a live competitor or tool by the same name; "Zendesk
    // Sell" (retired) is not "Zendesk" (live), so only the same name counts.
    const live = [...context.competitors.map((item) => item.name), ...context.integrations]
    if (live.some((name) => fold(name) === fold(row.name))) return null
    return { ...row, tag: kind }
  },
  // By name: "Jira Server" (retired) and "Jira" (live) share atlassian.com but are two rows.
  keys: (row) => [row.name],
  line: (row) => withDetail(row.name, row.tag)
}

/**
 * A live switch-from product: the read's compared or switch-from lists, or the page text,
 * name it. A short name must match with its case ("ReadMe" is not the file "README").
 */
function onSiteAsSwitch(name: string, ground: SiteGround): boolean {
  const listed = [
    ...(ground.facts?.comparedWith ?? []),
    ...(ground.facts?.switchingFrom ?? []).map((item) => item.name)
  ]
  if (listed.some((other) => sameName(other, name))) return true
  if (ground.check === null || ground.check.text.length === 0 || !siteNames(name, ground)) {
    return false
  }
  if (fold(name).length > 6) return true
  const exact = name.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${exact}(?![\\p{L}\\p{N}])`, 'u').test(ground.check.text)
}

/** Unchecked tools kept at most (after every tool the pages name). */
const UNNAMED_TOOLS_MAX = 4

export const INTEGRATIONS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'integrations',
  noun: ['tool it is used with', 'tools it is used with'],
  context: ['website', 'summary', 'products', 'competitors', 'switchingFrom'],
  site: ['integrations', 'brands', 'paths'],
  webSearch: false,
  usd: 0.01,
  columns: ['name', 'domain', 'source', 'why'],
  entity: null,
  count: 8,
  maxRows: 12,
  neutral: false,
  role: (context) => `You help set up AI-search tracking for ${context.domain}.`,
  task: (context, count) => [
    `List up to ${count} tools used together with ${context.domain}: apps and services it connects to, imports from or runs on.`,
    'Start with the tools the pages name (listed above). Add a well-known tool the pages do not name only when you are sure it works with it.',
    'Never the business’s own products or brands (listed above), never a competitor, marketplace or review site.',
    'name = the tool; domain = its bare host such as example.com, or blank',
    'source = the site path that names it, or "known" when the pages do not',
    'why = one plain sentence: how it is used with this product'
  ],
  toRow(values, context, ground) {
    const row = companyRow(values, context, [
      ...context.competitors.map((item) => item.name),
      ...context.switchingFrom
    ])
    if (row === null || isOwnProduct(row.name, context, ground)) return null
    return row
  },
  finish(rows, _context, ground) {
    const named = rows.filter((row) => siteNames(row.name, ground))
    const unnamed = rows.filter((row) => !siteNames(row.name, ground))
    const kept = unnamed.slice(0, UNNAMED_TOOLS_MAX)
    const warnings: string[] = []
    if (kept.length > 0) {
      warnings.push(
        `Not named on the pages read, check ${kept.length === 1 ? 'it' : 'them'}: ${kept.map((row) => row.name).join(', ')}.`
      )
    }
    if (unnamed.length > kept.length) {
      warnings.push(`Left out ${unnamed.length - kept.length} more the pages do not name.`)
    }
    return { rows: [...named, ...kept], warnings }
  },
  keys: companyKeys,
  line: (row) => row.name
}
