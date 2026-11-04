import type { CompanySuggestion, FillSearchFound, ProductSuggestion } from '@shared/ipc'
import { progressStep } from '../assist/progress'
import { systemAddressLookup } from '../pipeline/fetch-guard'
import type { SiteProduct } from './assist'
import type { HomepageReader } from './company-domain-lookup'
import type { EngineHost } from './host'
import {
  askProductCompetitors,
  guardProductCompetitors,
  type DomainCheckCache,
  type ProductCompetitors
} from './product-competitors'

/** A product to search for; `id` keeps the id a screen already shows (setup step 3). */
export type SearchProduct = SiteProduct & { id?: string }

/** One product's search as a setup screen shows it (see `FillSearchFound`). */
export type ProductSearchEvent = Omit<FillSearchFound, 'kind'>

/** The product line's note when its search did not finish. */
export const SEARCH_FAILED_NOTE =
  'The web search did not finish, so no competitors are listed for this product. Try again.'

/**
 * Batch 2 row 5: one web-search question per product, in parallel (the Claude gate still
 * caps calls at once), then the per-product guard with one shared domain check. Used by
 * Fill from my website (every product on the site), its per-product Try again, and topic
 * seed discover (the topic's own product). A failed search leaves that product with no
 * competitors and a plain note; the other products are kept.
 *
 * Each product's domains are checked as soon as its own search returns, while the other
 * searches still run, and `onSearch` tells a screen each product's state as it changes:
 * waiting for its turn, searching, done with its checked competitors, or failed.
 */
export async function competitorsByProduct(
  host: EngineHost,
  input: {
    channel: string
    projectId: string | null
    domain: string
    summary: string | null
    products: readonly SearchProduct[]
    market: { country: string; language: string } | null
    comparedWith?: readonly string[]
    brandNames: readonly string[]
    /** Switch-from and integration names: never competitors. */
    notCompetitors: readonly string[]
    readHomepage?: HomepageReader
    onSearch?: (event: ProductSearchEvent) => void
  }
): Promise<{
  products: ProductSuggestion[]
  competitors: CompanySuggestion[]
  dropped: { name: string; why: string }[]
}> {
  const cache: DomainCheckCache = new Map()
  const dns = host.pageDns ?? systemAddressLookup()
  const tell = (event: ProductSearchEvent): void => {
    try {
      input.onSearch?.(event)
    } catch {
      // A screen that cannot be told never stops the search.
    }
  }
  const ids = input.products.map((product) => product.id ?? `prod-${host.createId()}`)
  for (const productId of ids) {
    tell({ productId, state: 'waiting', competitors: [], note: null })
  }
  const searched = await Promise.all(
    input.products.map(async (product, index) => {
      const id = ids[index] ?? `prod-${host.createId()}`
      let found: ProductCompetitors
      try {
        found = await askProductCompetitors(
          host,
          input.channel,
          input.projectId,
          {
            domain: input.domain,
            product,
            summary: input.summary,
            market: input.market,
            ...(input.comparedWith !== undefined ? { comparedWith: input.comparedWith } : {})
          },
          () => tell({ productId: id, state: 'running', competitors: [], note: null })
        )
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown'
        host.logger.warn('competitor search failed', { product: product.name, message })
        tell({ productId: id, state: 'failed', competitors: [], note: failedNote(message) })
        return { id, product, found: null, rows: [], left: [] }
      }
      const result = await guardProductCompetitors({
        found,
        productId: id,
        ownDomain: input.domain,
        brandNames: input.brandNames,
        notCompetitors: input.notCompetitors,
        dns,
        createId: () => host.createId(),
        cache,
        ...(input.readHomepage !== undefined ? { readHomepage: input.readHomepage } : {})
      })
      tell({ productId: id, state: 'done', competitors: result.competitors, note: null })
      return { id, product, found, rows: result.competitors, left: result.dropped }
    })
  )
  const products: ProductSuggestion[] = []
  const competitors: CompanySuggestion[] = []
  const dropped: { name: string; why: string }[] = []
  for (const { id, product, found, rows, left } of searched) {
    products.push({
      id,
      name: product.name,
      job: product.job,
      buyer: product.buyer,
      evidence: product.evidence,
      searchNote: found === null ? SEARCH_FAILED_NOTE : null
    })
    competitors.push(...rows)
    dropped.push(...left)
  }
  const verified = competitors.filter((row) => row.domain !== null).length
  progressStep({ kind: 'check', label: 'Checking competitor domains' }).done(
    `${competitors.length} ${competitors.length === 1 ? 'competitor' : 'competitors'} · ${verified} ${verified === 1 ? 'domain' : 'domains'} verified`
  )
  return { products, competitors, dropped }
}

/** Why one search did not finish, in plain words for its product line. */
function failedNote(message: string): string {
  return /timed out/iu.test(message)
    ? 'It took too long and was stopped.'
    : 'CiteFox AI did not finish this search.'
}
