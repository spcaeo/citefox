import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import type { StartPageKind } from '@shared/ipc'
import { START_MIN_PAGES } from '@shared/site-start'
import { pathSegments } from '../structure/cluster-rules'
import { pageKind, pathOfUrl, type StartPageRow } from './candidates'

/**
 * The first-run page ranking (Docs/PROMPT-AUDIT.md P2 item 4). Code ranks what code
 * can rank: what a page is (from its address), whether it names a competitor of its
 * product or something buyers are leaving, and whether it is where the site describes
 * a product. Claude only explains the picks (`start/prompt.ts`).
 */

/** What the ranking reads from the project: the saved catalog and notes. */
export interface RankSignals {
  products: readonly ProjectProduct[]
  /** Catalog rows (PC); the flat list as whole-business rows when there are none. */
  competitors: readonly Pick<ProductCompetitor, 'name' | 'domain' | 'productId' | 'tier'>[]
  switchingFrom: readonly string[]
}

export interface RankedPage {
  page: StartPageRow
  kind: StartPageKind
  score: number
  /** The product the page is about, when code can tell. */
  productId: string | null
  /** Plain facts behind the score, for Claude to explain and for the fallback evidence. */
  facts: string[]
  /** The competitor or switch-from option the page is about, lower case, or null. */
  rival: string | null
}

const PRICING_SEGMENTS = new Set(['pricing', 'plans', 'price', 'prices'])

/**
 * What a page is, for the ranking. A post whose slug only mentions pricing
 * ("/blog/slicktext-pricing/") is a guide, not the site's own pricing page.
 */
export function rankKind(url: string): StartPageKind {
  const kind = pageKind(url)
  if (kind !== 'pricing') return kind
  const segments = pathSegments(url).map((segment) => segment.toLowerCase())
  return segments.length > 1 && !segments.some((segment) => PRICING_SEGMENTS.has(segment))
    ? 'guide'
    : kind
}

/** Pages the first run picks. */
export const START_PICK_COUNT = 5

/** Where each kind starts: what an AI Overview most often answers from, first. */
const KIND_SCORE: Readonly<Record<StartPageKind, number>> = {
  pricing: 50,
  alternatives: 44,
  compare: 42,
  use_case: 36,
  feature: 32,
  integration: 24,
  other: 14,
  guide: 12
}

/**
 * Most picks of one kind, so the first check covers different buyer searches. Comparison
 * and alternatives pages share {@link RIVAL_CAP}, one per rival.
 */
const KIND_CAP: Readonly<Record<StartPageKind, number>> = {
  pricing: 1,
  alternatives: 2,
  compare: 2,
  use_case: 2,
  feature: 2,
  integration: 1,
  other: 1,
  guide: 1
}

const RIVAL_CAP = 2

const KIND_FACT: Readonly<Record<StartPageKind, string>> = {
  pricing: 'Pricing page',
  alternatives: 'Alternatives page',
  compare: 'Comparison page',
  use_case: 'Use case page',
  feature: 'Feature page',
  integration: 'Integration page',
  other: 'Top-level page',
  guide: 'Guide'
}

/** Words in a switch-from name that say nothing about which service it is. */
const GENERIC = new Set([
  'email',
  'text',
  'texts',
  'sms',
  'mms',
  'to',
  'gateway',
  'gateways',
  'service',
  'services',
  'the',
  'and',
  'for',
  'app',
  'old',
  'legacy',
  'com',
  'net'
])

/** Every untracked page, best first, each with the facts behind its score. */
export function rankStartPages(pages: readonly StartPageRow[], signals: RankSignals): RankedPage[] {
  const productById = new Map(signals.products.map((product) => [product.id, product]))
  const contested = new Map<string, number>()
  for (const row of signals.competitors) {
    if (row.productId !== null)
      contested.set(row.productId, (contested.get(row.productId) ?? 0) + 1)
  }
  const hubs = signals.products
    .map((product) => ({ product, path: trimPath(product.evidencePath ?? '') }))
    .filter((hub) => hub.path.length > 1)
  const open = pages.filter((page) => !page.tracked)
  // A word in more than one page in twenty ("text" on a texting site) tells pages apart
  // no better than nothing, so it never counts (the same rule as inferProduct).
  const common = commonWords(open, Math.max(3, open.length / 20))
  const productWords = signals.products.map((product) => ({
    product,
    words: productTerms(`${product.name} ${product.job}`).filter((word) => !common.has(word))
  }))
  const leaving = signals.switchingFrom
    .map((name) => ({ name, tokens: distinctive(name) }))
    .filter((entry) => entry.tokens.length > 0)
  return open
    .map((page, index) => {
      const kind = rankKind(page.url)
      const path = trimPath(pathOfUrl(page.url))
      const tokens = pathTokens(path)
      const flat = path.replace(/[^a-z0-9]+/gu, '')
      const facts = [KIND_FACT[kind]]
      let score = KIND_SCORE[kind]
      let productId: string | null = null
      let rival: string | null = null
      const hub = hubs.find((entry) => entry.path === path)
      const under = hubs
        .filter((entry) => path.startsWith(`${entry.path}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]
      if (hub !== undefined) {
        score += 18
        productId = hub.product.id
        facts.push(`where the site describes ${hub.product.name}`)
      } else if (under !== undefined) {
        score += 4
        productId = under.product.id
        facts.push(`part of ${under.product.name}`)
      }
      if (kind === 'compare' || kind === 'alternatives') {
        const named = signals.competitors
          .filter((row) => namesCompany(row, tokens, flat))
          .sort((left, right) => rowWeight(right, productId) - rowWeight(left, productId))[0]
        if (named !== undefined) {
          score += rowWeight(named, productId)
          rival = named.name.toLowerCase()
          productId ??= named.productId
          const product = named.productId === null ? null : productById.get(named.productId)
          facts.push(
            `names ${named.name}, a ${named.tier} competitor${product ? ` of ${product.name}` : ''}`
          )
        }
        // The leading word names the service ("verizon", "att", "mobile").
        const left = leaving.find((entry) => tokens.has(entry.tokens[0] ?? ''))
        if (left !== undefined) {
          score += 16
          rival ??= left.name.toLowerCase()
          facts.push(`buyers leaving ${left.name} look for what replaces it`)
        }
      } else if (hub === undefined && under === undefined) {
        // A use case or feature in the words of a product's name and job.
        const best = productWords
          .map((entry) => ({ ...entry, hits: entry.words.filter((word) => tokens.has(word)) }))
          .sort((left, right) => right.hits.length - left.hits.length)[0]
        if (best !== undefined && best.hits.length > 0) {
          score += Math.min(best.hits.length, 3) * 3
          productId = best.product.id
          facts.push(`about ${best.product.name} (${best.hits.join(', ')})`)
        }
      }
      if (productId !== null && (contested.get(productId) ?? 0) > 0) {
        score += 4
        const count = contested.get(productId) ?? 0
        const name = productById.get(productId)?.name ?? 'its product'
        facts.push(
          `${count} saved ${count === 1 ? 'competitor sells' : 'competitors sell'} ${name} too`
        )
      }
      score -= Math.max(0, pathSegments(page.url).length - 2) * 3
      return { entry: { page, kind, score, productId, facts, rival }, index }
    })
    .sort((left, right) => right.entry.score - left.entry.score || left.index - right.index)
    .map(({ entry }) => entry)
}

/**
 * The picks: best first, at most {@link KIND_CAP} of a kind, two comparison or
 * alternatives pages (one per rival) and, for a site with several products, two per
 * product; then the next best regardless
 * until there are at least {@link START_MIN_PAGES}.
 */
export function pickStartPages(
  ranked: readonly RankedPage[],
  max: number = START_PICK_COUNT
): RankedPage[] {
  const picked: RankedPage[] = []
  const kinds = new Map<StartPageKind, number>()
  const products = new Map<string, number>()
  const rivals = new Set<string>()
  let rivalPages = 0
  // Two per product only spreads the picks when the site sells more than one.
  const productCap =
    new Set(ranked.map((entry) => entry.productId).filter((id) => id !== null)).size > 1
      ? 2
      : Number.POSITIVE_INFINITY
  for (const entry of ranked) {
    if (picked.length >= max) break
    if ((kinds.get(entry.kind) ?? 0) >= KIND_CAP[entry.kind]) continue
    const aboutRival = entry.kind === 'compare' || entry.kind === 'alternatives'
    if (aboutRival && rivalPages >= RIVAL_CAP) continue
    if (entry.rival !== null && rivals.has(entry.rival)) continue
    if (entry.productId !== null && (products.get(entry.productId) ?? 0) >= productCap) continue
    picked.push(entry)
    kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1)
    if (aboutRival) rivalPages += 1
    if (entry.rival !== null) rivals.add(entry.rival)
    if (entry.productId !== null) {
      products.set(entry.productId, (products.get(entry.productId) ?? 0) + 1)
    }
  }
  for (const entry of ranked) {
    if (picked.length >= Math.min(max, START_MIN_PAGES)) break
    if (!picked.includes(entry)) picked.push(entry)
  }
  return picked
}

/** Direct competitors of the page's own product weigh most; partial overlap least. */
function rowWeight(
  row: Pick<ProductCompetitor, 'productId' | 'tier'>,
  productId: string | null
): number {
  const own = productId !== null && row.productId === productId
  if (row.tier === 'direct') return own ? 14 : 10
  return own ? 8 : 6
}

/** True when the path names the company: its domain's first label or its squashed name. */
function namesCompany(
  row: Pick<ProductCompetitor, 'name' | 'domain'>,
  tokens: ReadonlySet<string>,
  flat: string
): boolean {
  const stems = [
    row.domain?.toLowerCase().split('.')[0] ?? '',
    row.name.toLowerCase().replace(/[^a-z0-9]+/gu, '')
  ].filter((stem) => stem.length >= 3)
  return stems.some((stem) => (stem.length >= 5 ? flat.includes(stem) : tokens.has(stem)))
}

/** "AT&T email-to-text gateway" gives ["att"]; "Verizon vtext.com" gives ["verizon", "vtext"]. */
function distinctive(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/gu, '')
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 3 && !GENERIC.has(word))
    .slice(0, 2)
}

/** A product's name and job as path words: "Email to SMS gateway" gives email, sms, gateway. */
function productTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 3 && !PRODUCT_STOP.has(word))
    .map(stem)
  return [...new Set(words)]
}

const PRODUCT_STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'your',
  'that',
  'their',
  'into',
  'send',
  'get',
  'any',
  'all',
  'small',
  'teams',
  'team',
  'business',
  'businesses'
])

/** The words of a path, singular. */
function pathTokens(path: string): Set<string> {
  return new Set(
    path
      .split(/[^a-z0-9]+/u)
      .filter(Boolean)
      .map(stem)
  )
}

/** Words found in more than `limit` of the pages' paths. */
function commonWords(pages: readonly StartPageRow[], limit: number): Set<string> {
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const word of pathTokens(trimPath(pathOfUrl(page.url)))) {
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return new Set([...counts].filter(([, count]) => count > limit).map(([word]) => word))
}

/** Plural and singular match: "alerts" and "alert". */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

function trimPath(path: string): string {
  const value = path.trim().toLowerCase()
  if (value.length === 0) return ''
  return value.replace(/\/+$/u, '') || '/'
}
