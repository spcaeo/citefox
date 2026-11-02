/**
 * Products and their competitors (Docs/PROMPT-AUDIT.md section 2.3, contract C1).
 * The same business can sell several products, and each product has its own
 * competitors. Main stores them in the project database (`products` and
 * `product_competitors`, migration 034) and every prompt reads them through
 * `competitorContext()`. Pages and topics carry a product: picked by the user, or
 * inferred from the page's URL and title (or the topic's seed) by {@link inferProduct}.
 */

/** One product the business sells, as Fill from my website or the user names it. */
export interface ProjectProduct {
  id: string
  name: string
  /** The job a buyer hires it for, in a few words ("email to SMS alerts"). */
  job: string
  /** Who buys it ("small IT and facilities teams without a developer"). */
  buyer: string
  /**
   * The site path Fill found the product on ("/email-to-sms/"), used to map pages to
   * the product. Null or absent when not known.
   */
  evidencePath?: string | null
}

/**
 * A competitor of one product, or of the whole business when `productId` is null.
 * `tier` is `direct` (the same job for the same buyer) or `partial` (an overlap); it
 * is the same union as batch 2's `CompetitorTier` in `@shared/ipc`.
 */
export interface ProductCompetitor {
  name: string
  domain: string | null
  /** Null applies to the whole business. */
  productId: string | null
  tier: 'direct' | 'partial'
  startingPrice: string | null
  sources: readonly { url: string; biased: boolean }[]
  /**
   * Other domains of the same company (`app.simpletexting.com`). Absent or empty: only
   * `domain`. A cited host on any of them, or a subdomain, counts as this competitor.
   */
  aliases?: readonly string[]
}

/** Most other domains kept per competitor row. */
export const MAX_COMPETITOR_ALIASES = 10

/** Most products kept per project. */
export const MAX_PRODUCTS = 12
/** Most competitor rows kept per project (every product together). */
export const MAX_PRODUCT_COMPETITORS = 120
/** Longest product or competitor name. The flat `competitors` list caps names at 80. */
export const MAX_PRODUCT_NAME = 80

/**
 * `simpletexting.com`, `www.Twilio.com/sms` or `https://get-voip.com/` give their
 * host without `www.`, lower case. A plain name such as `SimpleTexting` gives null.
 */
export function competitorDomainOf(value: string): string | null {
  const match =
    /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63})(?::\d+)?(?:[/?#]\S*)?$/iu.exec(
      value.trim()
    )
  return match?.[1]?.toLowerCase() ?? null
}

/**
 * True when a saved competitor entry (a name or a domain, as the flat list holds it)
 * is this competitor row: the same name ignoring case, or the same domain.
 */
export function entryMatchesCompetitor(
  entry: string,
  row: Pick<ProductCompetitor, 'name' | 'domain'>
): boolean {
  const value = entry.trim().toLowerCase()
  if (value.length === 0) return false
  if (row.name.trim().toLowerCase() === value) return true
  const domain = competitorDomainOf(entry)
  return domain !== null && row.domain !== null && row.domain.toLowerCase() === domain
}

/** What {@link inferProduct} reads about a page or a topic. Every field is optional. */
export interface ProductSignals {
  /** The page URL or path. Topics have none. */
  url?: string | null
  title?: string | null
  /** More words about it: a topic's seed, a page's H1. */
  text?: string | null
}

export interface InferredProduct {
  productId: string | null
  /** One plain line for the picker's hint. */
  reason: string
}

/**
 * The default product for a page or a topic (Docs/PROMPT-AUDIT.md PC item 5):
 *
 * 1. the page's path is the page Fill found a product on, or sits under it (the
 *    longest such path wins);
 * 2. else the product whose name and job share the most distinctive words with the
 *    URL path, the title and the text (name words count double; a word every product
 *    has counts for nothing). A tie picks none;
 * 3. else, when the business sells one product, that product;
 * 4. else none: the page is about the business as a whole.
 */
export function inferProduct(
  products: readonly ProjectProduct[],
  signals: ProductSignals
): InferredProduct {
  if (products.length === 0) return { productId: null, reason: 'No products saved yet.' }
  const path = pathOf(signals.url ?? null)
  if (path !== null) {
    let best: { product: ProjectProduct; length: number } | null = null
    for (const product of products) {
      const evidence = normalizePath(product.evidencePath ?? null)
      if (evidence === null || evidence === '/') continue
      if (path === evidence || path.startsWith(`${evidence}/`)) {
        if (best === null || evidence.length > best.length) {
          best = { product, length: evidence.length }
        }
      }
    }
    if (best !== null) {
      return {
        productId: best.product.id,
        reason: `Its URL is where the site describes ${best.product.name}.`
      }
    }
  }
  const words = new Set([
    ...wordsOf(path ?? ''),
    ...wordsOf(signals.title ?? ''),
    ...wordsOf(signals.text ?? '')
  ])
  if (words.size > 0 && products.length > 1) {
    const scored = scoreProducts(products, words)
    const [first, second] = scored
    if (
      first !== undefined &&
      first.score > 0 &&
      (second === undefined || first.score > second.score)
    ) {
      return {
        productId: first.product.id,
        reason: `It mentions ${first.matched.slice(0, 3).join(', ')}, like ${first.product.name}.`
      }
    }
  }
  const only = products.length === 1 ? products[0] : undefined
  if (only !== undefined) {
    return { productId: only.id, reason: `The business sells one product: ${only.name}.` }
  }
  return { productId: null, reason: 'No product clearly matches, so it covers the whole business.' }
}

function scoreProducts(
  products: readonly ProjectProduct[],
  words: ReadonlySet<string>
): { product: ProjectProduct; score: number; matched: string[] }[] {
  const vocab = products.map((product) => ({
    product,
    name: new Set(wordsOf(product.name)),
    other: new Set([
      ...wordsOf(product.job),
      ...wordsOf(normalizePath(product.evidencePath ?? null) ?? '')
    ])
  }))
  // A word in every product's vocabulary tells them apart no better than none.
  const spread = new Map<string, number>()
  for (const entry of vocab) {
    for (const word of new Set([...entry.name, ...entry.other])) {
      spread.set(word, (spread.get(word) ?? 0) + 1)
    }
  }
  return vocab
    .map(({ product, name, other }) => {
      let score = 0
      const matched: string[] = []
      for (const word of words) {
        const count = spread.get(word) ?? 0
        if (count === 0 || count === products.length) continue
        const weight = 1 / count
        if (name.has(word)) score += 2 * weight
        else if (other.has(word)) score += weight
        else continue
        matched.push(word)
      }
      return { product, score, matched }
    })
    .sort((a, b) => b.score - a.score)
}

const STOP_WORDS = new Set(
  (
    'a an and are as at be best by can com do does for from get how i in is it its me my ' +
    'no not of on or our so than that the their them then this to up us use used using via ' +
    'vs was we what when where which who why will with without you your www html htm php ' +
    'page pages blog post posts guide guides article articles help www2 en us'
  ).split(' ')
)

/** Lower-case words of 2+ letters, stop words dropped, a plural `s` trimmed. */
export function wordsOf(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || /^\d+$/u.test(raw) || STOP_WORDS.has(raw)) continue
    out.push(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw)
  }
  return out
}

/** The path of a URL or a bare path, lower case, no trailing slash ("/" for the root). */
function pathOf(url: string | null): string | null {
  if (url === null || url.trim().length === 0) return null
  const value = url.trim()
  if (value.startsWith('/')) return normalizePath(value)
  try {
    return normalizePath(
      new URL(/^https?:\/\//iu.test(value) ? value : `https://${value}`).pathname
    )
  } catch {
    return null
  }
}

function normalizePath(path: string | null): string | null {
  if (path === null) return null
  const clean = path.trim().split(/[?#]/u)[0] ?? ''
  if (!clean.startsWith('/')) return null
  const trimmed = clean.toLowerCase().replace(/\/+$/u, '')
  return trimmed.length === 0 ? '/' : trimmed
}
