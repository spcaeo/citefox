import type { CompanySource, CompanySuggestion, CompetitorTier } from '@shared/ipc'
import type { AddressLookup } from '../pipeline/fetch-guard'
import { isRecord } from '../providers/json-schema'
import { completeAssist } from './assist'
import { PRODUCT_COMPETITORS_SHAPE } from './assist-shapes'
import { lookupCompanyDomain, validHostname, type HomepageReader } from './company-domain-lookup'
import { bareDomain } from './competitor-domains'
import { nameKey, plainReason } from './competitor-guard'
import { PRODUCT_COMPETITOR_RULES } from './competitor-rules'
import type { EngineHost } from './host'
import { notCompetitorReason } from './project-settings/competitors'

/**
 * Docs/FEEDBACK.md batch 2 row 5: competitors are found per product with one direct
 * question and web search on ("What are the competitors of textbolt.com's email-to-SMS
 * gateway that do exactly what it does, for buyers in the United States?"). The site's
 * own pages only name the rivals the site chose to mention, so they are not used here.
 *
 * The reply is untrusted: it is parsed strictly, reasons lose notes about the search,
 * sources keep only http(s) URLs, the business's own brand and domain, carriers,
 * marketplaces and review sites are dropped, and every domain is verified (it resolves
 * and its name or homepage names the brand) before it is shown. An unverified domain
 * becomes "Domain unknown" and the user can type it.
 */

export const PRODUCT_COMPETITORS_ASSIST_ID = 'project.productCompetitors'

/** Most competitors kept per tier and product (the rules ask for 8 direct, 12 partial). */
export const MAX_PER_TIER = 12
/** Most sources kept per competitor. */
export const MAX_SOURCES = 3

export interface WebCompetitor {
  name: string
  domain: string | null
  why: string
  startingPrice: string | null
  sources: CompanySource[]
}

export interface ProductCompetitors {
  direct: WebCompetitor[]
  partial: WebCompetitor[]
}

/** The product a competitor question is about. */
export interface CompetitorQuestion {
  domain: string
  product: { name: string; job: string; buyer: string }
  /** What the business sells, from its pages (2–3 sentences), or null. */
  summary: string | null
  market: { country: string; language: string } | null
  /** Live products the business's pages compare it with: placed, not trusted. */
  comparedWith?: readonly string[]
}

/** Strict: both lists, each item with a name and a reason; bad sources are dropped. */
export function parseProductCompetitors(value: unknown): ProductCompetitors | null {
  if (!isRecord(value)) return null
  const direct = parseList(value.direct)
  const partial = parseList(value.partial)
  if (direct === null || partial === null) return null
  return { direct, partial }
}

function parseList(value: unknown): WebCompetitor[] | null {
  if (!Array.isArray(value)) return null
  const items: WebCompetitor[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const name = line(entry.name, 120)
    const why = line(entry.why ?? entry.reason, 600)
    if (name === null || why === null) return null
    if (entry.domain !== null && entry.domain !== undefined && typeof entry.domain !== 'string') {
      return null
    }
    const domain = typeof entry.domain === 'string' ? line(entry.domain, 253) : null
    const price = typeof entry.startingPrice === 'string' ? priceText(entry.startingPrice) : null
    items.push({ name, domain, why, startingPrice: price, sources: parseSources(entry.sources) })
  }
  return items
}

function parseSources(value: unknown): CompanySource[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sources: CompanySource[] = []
  for (const entry of value) {
    const raw = typeof entry === 'string' ? entry : isRecord(entry) ? entry.url : null
    const url = typeof raw === 'string' ? httpUrl(raw) : null
    if (url === null || seen.has(url)) continue
    seen.add(url)
    sources.push({ url, biased: isRecord(entry) && entry.biased === true })
    if (sources.length >= MAX_SOURCES) break
  }
  return sources
}

/** An absolute http(s) URL without credentials, else null. */
export function httpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username !== '' || url.password !== '') return null
    return url.toString()
  } catch {
    return null
  }
}

const NO_PRICE = /^(?:unknown|n\/?a|none|null|not (?:public|published|listed|available|known))\b/iu

function priceText(value: string): string | null {
  const price = line(value, 60)
  return price === null || NO_PRICE.test(price) ? null : price
}

function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/gu, ' ').trim()
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed
}

/** "United States (English)", or the codes when the names are unknown. */
export function marketWords(market: { country: string; language: string }): string {
  const name = (type: 'region' | 'language', code: string): string => {
    try {
      return new Intl.DisplayNames(['en'], { type }).of(code) ?? code
    } catch {
      return code
    }
  }
  return `${name('region', market.country.toUpperCase())} (${name('language', market.language)})`
}

/** The owner's question (batch 2 row 5), for one product. */
export function productCompetitorPrompt(question: CompetitorQuestion): string {
  const { domain, product, market } = question
  const where = market === null ? '' : `, for buyers in ${marketWords(market)}`
  const inMarket = market === null ? '' : ` ${marketWords(market).replace(/ \(.*\)$/u, '')}`
  const marketRule =
    market === null
      ? ''
      : `\n- Only companies that sell this to buyers in ${marketWords(market)} today (they take customers and send there). Leave out providers built mainly for other countries.`
  const about = question.summary === null ? '' : `\nAbout ${domain}: ${question.summary}`
  const named = (question.comparedWith ?? []).slice(0, 20)
  const compared =
    named.length === 0
      ? ''
      : `\nIts own pages compare it with: ${named.join(', ')}. Include every live one in direct or partial (buyers compare them, so they are search competitors even when built around another job), and still find the competitors these pages leave out: they do not take the place of independent results.`
  return `Assist: ${PRODUCT_COMPETITORS_ASSIST_ID}
What are the competitors of ${domain}'s ${product.name} that do exactly what it does${where}? Search the web first with several searches (such as "best ${product.name}${inMarket}", "${product.name} providers", "${domain} alternatives" and independent comparison or review lists), then answer with the companies that come up most often across independent sources, not only the ones ${domain} names.

What it does: ${product.job}
Who buys it: ${product.buyer}${about}${compared}

${PRODUCT_COMPETITOR_RULES}${marketRule}
- Never list ${domain} itself.`
}

/**
 * One web-search call for one product. Throws when the call fails or the reply is unusable.
 * `onStart` runs when the call gets its turn at the Claude gate and starts searching.
 */
export async function askProductCompetitors(
  host: EngineHost,
  channel: string,
  projectId: string | null,
  question: CompetitorQuestion,
  onStart?: () => void
): Promise<ProductCompetitors> {
  const json = await completeAssist(
    host,
    channel,
    productCompetitorPrompt(question),
    (value) => parseProductCompetitors(value) !== null,
    PRODUCT_COMPETITORS_SHAPE,
    { assistId: PRODUCT_COMPETITORS_ASSIST_ID, projectId },
    {
      webSearch: true,
      maxTokens: 8000,
      progress: {
        label: `Searching the web for competitors · ${question.product.name}`,
        detail:
          question.market === null
            ? 'Web search on for this step only'
            : `For buyers in ${marketWords(question.market)} · web search on for this step only`
      },
      ...(onStart !== undefined ? { onStart } : {})
    }
  )
  const parsed = parseProductCompetitors(json)
  if (parsed === null) throw new Error('The competitor reply did not match the shape.')
  return parsed
}

/** Shared by every product of one read, so a domain is checked once. */
export type DomainCheckCache = Map<string, Promise<string | null>>

export interface GuardProductInput {
  found: ProductCompetitors
  productId: string
  ownDomain: string
  brandNames: readonly string[]
  /** Names already listed as switch-from or integrations: never competitors. */
  notCompetitors: readonly string[]
  dns: AddressLookup
  readHomepage?: HomepageReader
  createId: () => string
  cache: DomainCheckCache
}

/** The code side of the per-product rules; returns rows tagged with product and tier. */
export async function guardProductCompetitors(input: GuardProductInput): Promise<{
  competitors: CompanySuggestion[]
  dropped: { name: string; why: string }[]
}> {
  const own = bareDomain(input.ownDomain)
  const ownKeys = new Set(
    [...input.brandNames, own, own.split('.')[0] ?? ''].map(nameKey).filter(Boolean)
  )
  const excluded = input.notCompetitors.map(nameKey).filter((key) => key.length > 0)
  const dropped: { name: string; why: string }[] = []
  const usedNames = new Set<string>()
  const usedDomains = new Set<string>()
  const kept: { item: WebCompetitor; tier: CompetitorTier; host: string | null }[] = []
  for (const tier of ['direct', 'partial'] as const) {
    let count = 0
    for (const item of input.found[tier]) {
      const key = nameKey(item.name)
      if (key.length === 0) continue
      const host = item.domain === null ? null : validHostname(item.domain)
      const why = rejectReason(key, host, { own, ownKeys, excluded })
      if (why !== null) {
        dropped.push({ name: item.name, why })
        continue
      }
      if (usedNames.has(key) || (host !== null && usedDomains.has(host))) continue
      if (count >= MAX_PER_TIER) continue
      usedNames.add(key)
      if (host !== null) usedDomains.add(host)
      kept.push({ item, tier, host })
      count += 1
    }
  }
  const verified = await Promise.all(
    kept.map(({ item, host }) => (host === null ? null : verifyDomain(item.name, host, input)))
  )
  const rivals = new Set(verified.filter((host): host is string => host !== null))
  const competitors = kept.map(({ item, tier, host }, index): CompanySuggestion => {
    const domain = verified[index] ?? null
    return {
      id: `comp-${input.createId()}`,
      name: item.name,
      domain,
      domainSource: domain === null ? null : 'search',
      reason: reasonText(item.why, tier),
      evidence: null,
      checkDomain: host !== null && domain === null,
      product: input.productId,
      tier,
      startingPrice: item.startingPrice,
      sources: item.sources.map((source) => {
        // Its own page is the primary source for its own facts (price, features); a page
        // by the business or by another rival is marketing about it.
        const self = domain !== null && writtenBy(source.url, [domain])
        const others = [own, ...[...rivals].filter((rival) => rival !== domain)]
        return {
          url: source.url,
          biased: (source.biased && !self) || writtenBy(source.url, others)
        }
      })
    }
  })
  return { competitors, dropped }
}

function rejectReason(
  key: string,
  host: string | null,
  context: { own: string; ownKeys: Set<string>; excluded: readonly string[] }
): string | null {
  if (context.ownKeys.has(key)) return 'the business’s own brand'
  if (host !== null && (host === context.own || host.endsWith(`.${context.own}`))) {
    return 'the business’s own domain'
  }
  const sameAs = (other: string): boolean =>
    other === key ||
    (Math.min(other.length, key.length) >= 5 && (other.startsWith(key) || key.startsWith(other)))
  if (context.excluded.some(sameAs)) return 'listed as switch-from or integration'
  if (host !== null) {
    const notRival = notCompetitorReason(host, [], new Set())
    if (notRival !== null) return notRival
  }
  return null
}

function verifyDomain(
  name: string,
  host: string,
  input: GuardProductInput
): Promise<string | null> {
  const cacheKey = `${nameKey(name)} ${host}`
  const cached = input.cache.get(cacheKey)
  if (cached !== undefined) return cached
  const check = lookupCompanyDomain({
    name,
    candidates: [host],
    ownDomain: input.ownDomain,
    dns: input.dns,
    ...(input.readHomepage !== undefined ? { readHomepage: input.readHomepage } : {})
  }).catch(() => null)
  input.cache.set(cacheKey, check)
  return check
}

/** The page sits on the business's own site or a rival's: marketing, not a review. */
function writtenBy(url: string, domains: readonly string[]): boolean {
  let host: string
  try {
    host = bareDomain(new URL(url).hostname)
  } catch {
    return false
  }
  return domains.some(
    (domain) => domain.length > 0 && (host === domain || host.endsWith(`.${domain}`))
  )
}

function reasonText(why: string, tier: CompetitorTier): string {
  const reason = plainReason(why)
  if (reason.length > 0) return reason
  return tier === 'direct'
    ? 'Does the same job for the same buyer.'
    : 'Overlaps with this product for some buyers.'
}
