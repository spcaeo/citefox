import {
  competitorDomainOf,
  entryMatchesCompetitor,
  inferProduct,
  MAX_PRODUCT_COMPETITORS,
  MAX_PRODUCT_NAME,
  MAX_PRODUCTS
} from '@shared/domain'
import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import type { FillFromWebsiteResult } from '@shared/ipc'
import type { SqliteDatabase } from '../storage/database'
import {
  listProducts,
  readPageProductRow,
  readProductCatalog,
  replaceProductCatalog,
  type ProductCatalog
} from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'

/**
 * Products and competitors by product (Docs/PROMPT-AUDIT.md PC): turning a Fill from my
 * website read into saved products, and the product a page or a topic is about.
 */

/** A page's or a topic's product as the pickers show it. */
export interface ResolvedPageProduct {
  pageId: string
  /** The product prompts use for it. Null: the whole business. */
  productId: string | null
  /** True when the user picked it; false when it is inferred. */
  pinned: boolean
  /** What automatic would pick, and why (shown as the "Automatic" option's hint). */
  suggestedId: string | null
  reason: string
}

/** Null when the page does not exist. */
export function resolvePageProduct(
  db: SqliteDatabase,
  pageId: string,
  products: readonly ProjectProduct[] = listProducts(db)
): ResolvedPageProduct | null {
  const row = readPageProductRow(db, pageId)
  if (row === null) return null
  const inferred = inferProduct(products, {
    url: row.url,
    title: row.title,
    text: row.seed
  })
  const pinnedKnown =
    row.pinned && (row.productId === null || products.some((item) => item.id === row.productId))
  return {
    pageId,
    productId: pinnedKnown ? row.productId : inferred.productId,
    pinned: pinnedKnown,
    suggestedId: inferred.productId,
    reason: inferred.reason
  }
}

/**
 * The catalog a Fill read leaves once the user has chosen which competitors to keep
 * (`kept`: the flat list as saved, domains or names):
 *
 * - every product Fill found (a product with the same name as a saved one keeps the
 *   saved id, so mapped pages stay mapped);
 * - each kept entry becomes one row per product Fill found it for, with its tier, price
 *   and sources; an entry Fill did not find (typed by the user) is a whole-business row;
 * - saved rows for products Fill did not find are kept.
 *
 * Names are clipped to fit, so a long name never blocks onboarding.
 */
export function catalogFromFill(
  fill: Pick<FillFromWebsiteResult, 'products' | 'competitors'>,
  kept: readonly string[],
  saved: ProductCatalog = { products: [], competitors: [] }
): ProductCatalog {
  const byName = new Map(saved.products.map((item) => [item.name.toLowerCase(), item.id]))
  const idFor = new Map<string, string>()
  const products: ProjectProduct[] = []
  // The read comes back from the renderer (the onboarding draft, New project), so each
  // field is checked before use; storage checks the rest.
  const found = (Array.isArray(fill.products) ? fill.products : []).filter(
    (item) => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
  )
  const suggestions = (Array.isArray(fill.competitors) ? fill.competitors : []).filter(
    (item) => isRecord(item) && typeof item.name === 'string'
  )
  for (const item of found) {
    if (products.length >= MAX_PRODUCTS) break
    const name = clipName(item.name)
    if (name.length === 0) continue
    const id = byName.get(name.toLowerCase()) ?? item.id
    if (products.some((entry) => entry.id === id)) continue
    idFor.set(item.id, id)
    products.push({
      id,
      name,
      job: textOf(item.job),
      buyer: textOf(item.buyer),
      evidencePath: isRecord(item.evidence) ? textOf(item.evidence.path) || null : null
    })
  }
  for (const old of saved.products) {
    if (products.length >= MAX_PRODUCTS) break
    if (!products.some((item) => item.id === old.id)) products.push(old)
  }
  const fresh = new Set(idFor.values())
  const competitors: ProductCompetitor[] = []
  for (const entry of kept) {
    const matches = suggestions.filter((item) =>
      entryMatchesCompetitor(entry, {
        name: item.name,
        domain: typeof item.domain === 'string' ? item.domain : null
      })
    )
    if (matches.length === 0) {
      const name = clipName(entry)
      if (name.length === 0) continue
      competitors.push({
        name,
        domain: competitorDomainOf(entry),
        productId: null,
        tier: 'direct',
        startingPrice: null,
        sources: []
      })
      continue
    }
    for (const item of matches) {
      const name = clipName(item.name)
      if (name.length === 0) continue
      competitors.push({
        name,
        domain: typeof item.domain === 'string' ? item.domain : null,
        productId: typeof item.product === 'string' ? (idFor.get(item.product) ?? null) : null,
        tier: item.tier === 'partial' ? 'partial' : 'direct',
        startingPrice: typeof item.startingPrice === 'string' ? item.startingPrice : null,
        sources: Array.isArray(item.sources) ? item.sources : []
      })
    }
  }
  // Rows of saved products that this read did not search stay as they were.
  for (const row of saved.competitors) {
    if (row.productId === null || fresh.has(row.productId)) continue
    if (!products.some((item) => item.id === row.productId)) continue
    if (!kept.some((entry) => entryMatchesCompetitor(entry, row))) continue
    competitors.push(row)
  }
  return { products, competitors: competitors.slice(0, MAX_PRODUCT_COMPETITORS) }
}

/**
 * Saves a Fill read's products and the kept competitors by product (onboarding Finish,
 * New project). `kept` defaults to the project's saved flat list.
 */
export function saveFillCatalog(
  db: SqliteDatabase,
  fill: Pick<FillFromWebsiteResult, 'products' | 'competitors'>,
  kept?: readonly string[]
): ProductCatalog {
  const entries = kept ?? readProjectProfile(db)?.competitors ?? []
  return replaceProductCatalog(db, catalogFromFill(fill, entries, readProductCatalog(db)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function clipName(value: string): string {
  const name = value.replace(/\s+/gu, ' ').trim()
  return name.length > MAX_PRODUCT_NAME ? name.slice(0, MAX_PRODUCT_NAME).trimEnd() : name
}
