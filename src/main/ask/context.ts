import type { ProjectProduct } from '@shared/domain'
import { competitorContext, type NamedCompetitor } from '../engine/competitor-context'
import { resolvePageProduct } from '../engine/products'
import type { SqliteDatabase } from '../storage/database'
import { listProductCompetitors, listProducts } from '../storage/products'
import type { AskPromptCompetitor, AskPromptPage } from './prompt'
import type { AskScope } from './query'

/**
 * What the Ask CiteFox prompt knows about the business besides its results: the
 * product each page is about, and every product's competitors with their domains
 * (Docs/PROMPT-AUDIT.md P8), all read through `competitorContext()`. "Who beats us
 * on email to SMS" can then map a name to a domain and a product to its pages.
 */

/** Most competitors listed. The catalog holds at most 120 rows. */
const MAX_COMPETITORS = 60

/** The scope's pages with the product each one is about. */
export function askPages(db: SqliteDatabase, scope: AskScope): AskPromptPage[] {
  const products = listProducts(db)
  const names = new Map(products.map((product) => [product.id, product.name]))
  return scope.pages.map((page) => {
    const productId =
      products.length === 0 ? null : (resolvePageProduct(db, page.id, products)?.productId ?? null)
    return { ...page, product: productId === null ? null : (names.get(productId) ?? null) }
  })
}

/**
 * Every saved competitor once, with the products it competes in and its tier there.
 * A product with no rows of its own reads the project-wide fallback, so it adds no
 * label: a competitor is never pinned to a product it was not saved for.
 */
export function askCompetitors(db: SqliteDatabase): AskPromptCompetitor[] {
  const whole = competitorContext(db, {})
  const rows = listProductCompetitors(db)
  const owners = new Set(rows.map((row) => row.productId))
  // A row saved for the whole business shows up in every product's list; it stays
  // "whole business" unless it was also saved for a product.
  const perProduct = new Set(rows.filter((row) => row.productId !== null).map(keyOf))
  const labels = new Map<string, string[]>()
  for (const product of listProducts(db)) {
    if (!owners.has(product.id)) continue
    const own = competitorContext(db, { productId: product.id })
    const mine = (items: readonly NamedCompetitor[]): NamedCompetitor[] =>
      items.filter((item) => perProduct.has(keyOf(item)))
    addLabels(labels, mine(own.direct), product, 'direct')
    addLabels(labels, mine(own.partial), product, 'partial')
  }
  return [...whole.direct, ...whole.partial].slice(0, MAX_COMPETITORS).map((item) => ({
    name: item.name,
    domain: item.domain,
    products: labels.get(keyOf(item)) ?? []
  }))
}

function addLabels(
  labels: Map<string, string[]>,
  items: readonly NamedCompetitor[],
  product: ProjectProduct,
  tier: 'direct' | 'partial'
): void {
  for (const item of items) {
    const key = keyOf(item)
    const list = labels.get(key) ?? []
    const label = `${product.name} (${tier})`
    if (!list.includes(label)) list.push(label)
    labels.set(key, list)
  }
}

/** One company: its domain when known, else its name. */
function keyOf(item: Pick<NamedCompetitor, 'name' | 'domain'>): string {
  return (item.domain ?? item.name).trim().toLowerCase()
}
