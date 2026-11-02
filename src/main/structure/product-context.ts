import { inferProduct } from '@shared/domain'
import type { ProjectProduct } from '@shared/domain'
import { competitorContext } from '../engine/competitor-context'
import { resolvePageProduct } from '../engine/products'
import type { SqliteDatabase } from '../storage/database'
import { listProducts } from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'
import type { StructurePromptContext } from './claude-prompts'

/**
 * The business and its product catalog (migration 034) for the structure prompts,
 * and the product each page is about. A tracked page uses its product as the pickers
 * show it (picked or inferred); a page found in a sitemap is inferred from its URL
 * and title, the same rule pages use (`inferProduct`).
 */
export interface StructureProducts {
  context: StructurePromptContext
  /** The product's name for a page, or null when it covers the whole business. */
  productOf(page: { id: string | null; url: string; title: string | null }): string | null
}

export function structureProducts(db: SqliteDatabase, domain: string): StructureProducts {
  const products = listProducts(db)
  const byId = new Map(products.map((product) => [product.id, product]))
  const productOf = (page: {
    id: string | null
    url: string
    title: string | null
  }): string | null => productIdOf(db, products, page)
  return {
    context: {
      domain,
      brandNames: readProjectProfile(db)?.brandNames ?? [],
      products: products.map((product) => ({
        name: product.name,
        job: product.job,
        competitors: competitorNames(db, product.id)
      }))
    },
    productOf: (page) => {
      const id = productOf(page)
      return id === null ? null : (byId.get(id)?.name ?? null)
    }
  }
}

/** The context with each product's count of tracked pages, for Claude's pick. */
export function withTrackedCounts(
  context: StructurePromptContext,
  trackedProducts: readonly (string | null)[]
): StructurePromptContext {
  return {
    ...context,
    products: context.products.map((product) => ({
      ...product,
      trackedPages: trackedProducts.filter((name) => name === product.name).length
    }))
  }
}

/** Competitors named per product in Claude's pick. */
const MAX_PRODUCT_COMPETITORS = 6

/** The product's direct competitors, then partial ones, as `competitorContext` reads them. */
function competitorNames(db: SqliteDatabase, productId: string): string[] {
  const context = competitorContext(db, { productId })
  return [...context.direct, ...context.partial]
    .map((item) => item.name)
    .slice(0, MAX_PRODUCT_COMPETITORS)
}

function productIdOf(
  db: SqliteDatabase,
  products: readonly ProjectProduct[],
  page: { id: string | null; url: string; title: string | null }
): string | null {
  if (products.length === 0) return null
  if (page.id !== null) {
    const resolved = resolvePageProduct(db, page.id, products)
    if (resolved !== null) return resolved.productId
  }
  return inferProduct(products, { url: page.url, title: page.title }).productId
}
