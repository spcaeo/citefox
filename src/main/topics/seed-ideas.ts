import { inferProduct, type ProjectProduct } from '@shared/domain'
import type { StartPageKind, TopicCallInfo } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { businessBlock, fence } from '../prompts/blocks'
import { pageKind, pathOfUrl, type StartPageRow } from '../start/candidates'
import { listStartPages } from '../start/store'
import { listPagesOfKind } from '../storage/pages'
import { listProductCompetitors, listProducts } from '../storage/products'
import { bullets, runTopicTemplate } from './claude'
import type { OpenedProject } from './env'
import type { SiteRead } from './records'
import { siteText } from './site'
import { askOnce } from './topic-context'
import { marketBlockFor } from './step-blocks'
import { namesBrand } from './text'

/**
 * Seed ideas (Docs/PROMPT-AUDIT.md P2 item 1): the one `topic_seed_discover` call,
 * shared by Discover (six seeds), the suggested start (one) and the first run (the
 * topics with the most to gain). One job: buyer situations, each tied to a saved
 * product. Code checks the reply, ties each seed to a listed product and ranks
 * what it can rank (pages on the site that could win, competitors in play).
 */

export interface SeedIdea {
  text: string
  /** A saved product's id, or null for the whole business. */
  productId: string | null
  /** A page path or heading from the inputs that shows the business solves it. */
  evidence: string | null
  caution: string | null
}

export interface SeedIdeas {
  seeds: SeedIdea[]
  segments: { name: string; reason: string }[]
  why: string | null
  products: ProjectProduct[]
  info: TopicCallInfo
}

interface SeedReply {
  seeds: {
    text: string
    productId: string | null
    evidence: string | null
    caution: string | null
  }[]
  segments: { name: string; reason: string }[]
  why: string | null
}

/** Seeds Discover asks for. */
export const DISCOVER_SEED_COUNT = 6

/** Shortest and longest seed, in words. */
const MIN_SEED_WORDS = 3
const MAX_SEED_WORDS = 14

export async function seedIdeas(
  host: EngineHost,
  opened: OpenedProject,
  input: {
    channel: string
    domain: string
    /** "About the business" as the user wrote it; null builds it from the products. */
    about: string | null
    brandNames: readonly string[]
    marketId: string | null
    reads: readonly SiteRead[]
    count: number
  }
): Promise<SeedIdeas> {
  const products = listProducts(opened.db)
  const reply = await runTopicTemplate<SeedReply>({
    host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: null,
    kind: 'topic_seed_discover',
    channel: input.channel,
    context: {
      business_block: businessBlock({
        domain: input.domain,
        summary: input.about ?? productsAbout(input.domain, products),
        brandNames: input.brandNames
      }),
      market_block: marketBlockFor(opened.db, input.marketId),
      products: productsText(products),
      website_text: fence('page_text', siteText(input.reads)),
      saved_data: fence('saved_data', savedDataText(opened)),
      count: input.count
    },
    check: askOnce((value) => seedProblem(value, input.count, input.brandNames, products))
  })
  return {
    seeds: cleanSeeds(reply.value.seeds, products, input.brandNames).slice(0, input.count),
    segments: reply.value.segments,
    why: reply.value.why,
    products,
    info: reply.info
  }
}

/** "- <id>: <name>. Job: … Buyer: …" per saved product, or how to answer with none. */
export function productsText(products: readonly ProjectProduct[]): string {
  if (products.length === 0) return 'None saved. Use null for every productId.'
  return products
    .map(
      (product) =>
        `- ${product.id}: ${product.name}.${product.job ? ` Job: ${product.job}.` : ''}${product.buyer ? ` Buyer: ${product.buyer}.` : ''}`
    )
    .join('\n')
}

/** "textbolt.com sells A (job) and B (job)." from the saved products, or null. */
export function productsAbout(domain: string, products: readonly ProjectProduct[]): string | null {
  const parts = products
    .slice(0, 4)
    .map((product) => (product.job ? `${product.name} (${product.job})` : product.name))
  if (parts.length === 0) return null
  const last = parts.pop()
  return `${domain} sells ${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}.`
}

/** The kinds of site page that show buyer situations, with how many titles each sends. */
const PAGE_KINDS_SENT: readonly { kind: StartPageKind; label: string; max: number }[] = [
  { kind: 'use_case', label: 'Use case pages', max: 14 },
  { kind: 'integration', label: 'Integration pages', max: 10 },
  { kind: 'alternatives', label: 'Alternatives pages', max: 8 },
  { kind: 'compare', label: 'Comparison pages', max: 6 },
  { kind: 'feature', label: 'Feature pages', max: 8 },
  { kind: 'guide', label: 'Guides', max: 8 }
]

/**
 * Saved project data for the seed prompt: the site's pages by kind (from Site
 * structure; their titles show the situations it already writes about), tracked
 * pages and the domains overviews cite most.
 */
export function savedDataText(opened: OpenedProject): string {
  const sitePages = sitePagesText(listStartPages(opened.db))
  const tracked = listPagesOfKind(opened.db, opened.project.id, 'page')
    .filter((page) => page.status === 'tracked' || page.status === 'paused')
    .slice(0, 30)
    .map(
      (page) =>
        `${page.title ?? page.label ?? page.url ?? page.id}${page.url ? ` (${page.url})` : ''}`
    )
  const domains = opened.db
    .prepare<unknown[], { domain: string; n: number }>(
      `SELECT domain, COUNT(*) AS n FROM aio_references WHERE classification != 'own'
         AND classification != 'target' GROUP BY domain ORDER BY n DESC LIMIT 10`
    )
    .all()
    .map((row) => `${row.domain} (${row.n})`)
  return [
    sitePages,
    `Tracked pages:\n${bullets(tracked)}`,
    `Domains overviews cite most:\n${bullets(domains)}`
  ].join('\n')
}

/** Page titles by kind, shallow pages first; "none" when the sitemap is not read yet. */
export function sitePagesText(pages: readonly StartPageRow[]): string {
  const groups = PAGE_KINDS_SENT.map(({ kind, label, max }) => {
    const titles = pages
      .filter((page) => pageKind(page.url) === kind)
      .sort((left, right) => pathOfUrl(left.url).length - pathOfUrl(right.url).length)
      .slice(0, max)
      .map((page) => `${pathOfUrl(page.url)}${page.title ? ` ${page.title}` : ''}`)
    return titles.length === 0 ? null : `${label}:\n${bullets(titles)}`
  }).filter((group): group is string => group !== null)
  return groups.length === 0 ? 'Site pages: not read yet.' : groups.join('\n')
}

/** What is wrong with a reply, in one line Claude can act on, or null. */
export function seedProblem(
  value: SeedReply,
  count: number,
  brandNames: readonly string[],
  products: readonly ProjectProduct[]
): string | null {
  const problems: string[] = []
  const usable = cleanSeeds(value.seeds, products, brandNames)
  if (usable.length < Math.min(count, 2)) {
    problems.push(`Write ${count} different seeds.`)
  }
  const branded = value.seeds.filter((seed) => namesBrand(seed.text, brandNames))
  if (branded.length > 0) {
    problems.push(`Leave the brand out of: ${branded.map((seed) => `"${seed.text}"`).join(', ')}.`)
  }
  const labels = value.seeds.filter((seed) => looksLikeLabel(seed.text, products))
  if (labels.length > 0) {
    problems.push(
      `These read like product or feature names, not a buyer's situation: ${labels.map((seed) => `"${seed.text}"`).join(', ')}. Rewrite each as the trigger or job the buyer searches for.`
    )
  }
  const long = value.seeds.filter((seed) => words(seed.text).length > MAX_SEED_WORDS)
  if (long.length > 0) {
    problems.push(`Shorten to 4 to 10 words: ${long.map((seed) => `"${seed.text}"`).join(', ')}.`)
  }
  const ids = new Set(products.map((product) => product.id))
  const unknown = value.seeds.filter((seed) => seed.productId !== null && !ids.has(seed.productId))
  if (unknown.length > 0 && products.length > 0) {
    problems.push('Use only product ids from the list, or null.')
  }
  return problems.length === 0 ? null : problems.join(' ')
}

/**
 * The seeds kept: trimmed, brand-free, not a label, each once (case and punctuation
 * ignored), each with a listed product id (an unknown one is inferred from the
 * seed's words, as the topic's Automatic product would be).
 */
export function cleanSeeds(
  seeds: SeedReply['seeds'],
  products: readonly ProjectProduct[],
  brandNames: readonly string[]
): SeedIdea[] {
  const ids = new Set(products.map((product) => product.id))
  const seen = new Set<string>()
  const out: SeedIdea[] = []
  for (const seed of seeds) {
    const text = seed.text
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/[.?!]+$/u, '')
    const key = words(text).join(' ')
    if (key.length === 0 || seen.has(key)) continue
    if (namesBrand(text, brandNames) || looksLikeLabel(text, products)) continue
    if (words(text).length > MAX_SEED_WORDS + 4) continue
    seen.add(key)
    const productId =
      seed.productId !== null && ids.has(seed.productId)
        ? seed.productId
        : inferProduct(products, { text }).productId
    out.push({
      text,
      productId,
      evidence: blankToNull(seed.evidence),
      caution: blankToNull(seed.caution)
    })
  }
  return out
}

/**
 * True when a seed is a name, not a situation: too short to say what is going on,
 * or the same words as a product's name or job.
 */
function looksLikeLabel(text: string, products: readonly ProjectProduct[]): boolean {
  const own = words(text)
  if (own.length < MIN_SEED_WORDS) return true
  const key = own.join(' ')
  return products.some(
    (product) => words(product.name).join(' ') === key || words(product.job).join(' ') === key
  )
}

/**
 * Seeds ranked by what they have to gain (P2 item 4; code ranks, Claude explains):
 * pages on the site that could be cited for them (up to 5 count), whether their
 * product has saved competitors (an overview where rivals are cited is the one to
 * win), then Claude's own order (search demand, which code cannot see).
 */
export function rankSeeds(
  seeds: readonly SeedIdea[],
  pages: readonly StartPageRow[],
  contested: ReadonlySet<string>
): (SeedIdea & { pages: number })[] {
  return seeds
    .map((seed, index) => {
      const matched = matchingPages(seed.text, pages)
      const score =
        Math.min(matched, 5) +
        (seed.productId !== null && contested.has(seed.productId) ? 2 : 0) +
        (seeds.length - index) * 1.5
      return { seed: { ...seed, pages: matched }, score, index }
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.seed)
}

/** Product ids with at least one saved competitor of their own. */
export function contestedProducts(opened: OpenedProject): Set<string> {
  return new Set(
    listProductCompetitors(opened.db)
      .map((row) => row.productId)
      .filter((id): id is string => id !== null)
  )
}

/**
 * Site pages whose path or title share the seed's distinctive words: one for a short seed,
 * two for most, three for a long one (filler words would otherwise match half a blog).
 */
export function matchingPages(seed: string, pages: readonly StartPageRow[]): number {
  const wanted = seedWords(seed)
  if (wanted.size === 0) return 0
  const need = wanted.size < 3 ? 1 : wanted.size >= 6 ? 3 : 2
  return pages.filter((page) => pageHits(wanted, page) >= need).length
}

/** How many of the seed's distinctive words (stemmed) the page's path and title hold. */
export function seedPageHits(seed: string, page: Pick<StartPageRow, 'url' | 'title'>): number {
  return pageHits(seedWords(seed), page)
}

function seedWords(seed: string): Set<string> {
  return new Set(
    words(seed)
      .filter((word) => word.length > 3 && !STOP.has(word))
      .map(stem)
  )
}

function pageHits(wanted: ReadonlySet<string>, page: Pick<StartPageRow, 'url' | 'title'>): number {
  const own = new Set(words(`${pathOfUrl(page.url)} ${page.title ?? ''}`).map(stem))
  let hits = 0
  for (const word of wanted) if (own.has(word)) hits += 1
  return hits
}

const STOP = new Set([
  'that',
  'with',
  'from',
  'your',
  'their',
  'they',
  'without',
  'when',
  'what',
  'into',
  'have',
  'need',
  'every',
  'after',
  'before',
  'about',
  'still',
  'never',
  'nobody',
  'teams',
  'business',
  // Verbs and words nearly every page of a texting site shares.
  'getting',
  'sending',
  'using',
  'keeping',
  'moving',
  'stopped',
  'working',
  'down',
  'phone',
  'phones',
  'texted'
])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0)
}

function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word
}

function blankToNull(value: string | null): string | null {
  const text = value?.trim() ?? ''
  return text.length === 0 ? null : text
}
