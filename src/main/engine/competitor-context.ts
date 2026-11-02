import { competitorDomainOf } from '@shared/domain'
import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'
import { listProductCompetitors, listProducts } from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'
import { resolvePageProduct } from './products'

/**
 * The one read every prompt uses for competitors (Docs/PROMPT-AUDIT.md section 2.3,
 * contract C1). The same business can sell several products with different
 * competitors, so a step asks for the competitors of its page, topic or product.
 *
 * - The scope resolves to a product: `productId` when given, else the page's or the
 *   topic's product (picked by the user, or inferred from its URL, title or seed).
 * - A product with saved competitors reads its own direct and partial rows, plus the
 *   rows saved for the whole business (`productId` null).
 * - A product with none, an unmapped page, or an empty scope reads the project-wide
 *   list: every saved competitor once, `direct` when it is direct for any product.
 * - Switch-from options and integrations are project-wide; they are never competitors.
 */

/** What to read competitors for. Empty reads the whole business. */
export interface CompetitorScope {
  pageId?: string
  topicId?: string
  productId?: string
}

/** A competitor as prompts name it. `domain` is null when it is not known. */
export interface NamedCompetitor {
  name: string
  domain: string | null
  /** Other domains of the same company, when saved. */
  aliases?: string[]
}

export interface CompetitorContext {
  /** The product the scope resolves to. Null treats the business as a whole. */
  product: ProjectProduct | null
  /** Same job for the same buyer. Prompts may name these as alternatives. */
  direct: NamedCompetitor[]
  /** An overlap only. Prompts may name these, marked as partial. */
  partial: NamedCompetitor[]
  /** Replaced or discontinued options buyers move from. Never offered as an option. */
  switchingFrom: string[]
  /** Tools buyers use with the product. Never offered as an alternative. */
  integrations: string[]
}

export function competitorContext(db: SqliteDatabase, scope: CompetitorScope): CompetitorContext {
  assertScope(scope)
  const profile = readProjectProfile(db)
  if (profile === null) {
    return { product: null, direct: [], partial: [], switchingFrom: [], integrations: [] }
  }
  const products = listProducts(db)
  const product = scopeProduct(db, products, scope)
  const rows = savedRows(listProductCompetitors(db), profile.competitors)
  const own = product === null ? [] : rows.filter((row) => row.productId === product.id)
  const lists =
    own.length > 0 ? tiers([...own, ...rows.filter((row) => row.productId === null)]) : tiers(rows)
  return {
    product,
    ...lists,
    switchingFrom: uniqueNames(profile.switchingFrom ?? []),
    integrations: uniqueNames(profile.integrations ?? [])
  }
}

/** The product a scope is about, or null for the whole business. */
function scopeProduct(
  db: SqliteDatabase,
  products: readonly ProjectProduct[],
  scope: CompetitorScope
): ProjectProduct | null {
  if (products.length === 0) return null
  if (scope.productId !== undefined) {
    return products.find((item) => item.id === scope.productId) ?? null
  }
  const pageId = scope.pageId ?? scope.topicId
  if (pageId === undefined) return null
  const resolved = resolvePageProduct(db, pageId, products)
  if (resolved === null || resolved.productId === null) return null
  return products.find((item) => item.id === resolved.productId) ?? null
}

/**
 * The saved rows. A file whose rows are missing (written by an older build after the
 * migration ran) reads the flat list as whole-business rows, as before.
 */
function savedRows(
  rows: readonly ProductCompetitor[],
  flat: readonly string[]
): readonly ProductCompetitor[] {
  if (rows.length > 0 || flat.length === 0) return rows
  return uniqueNames(flat).map((name) => ({
    name,
    domain: competitorDomainOf(name),
    productId: null,
    tier: 'direct',
    startingPrice: null,
    sources: []
  }))
}

/** Each company once (by name, else by domain); direct wins over partial. */
function tiers(rows: readonly ProductCompetitor[]): {
  direct: NamedCompetitor[]
  partial: NamedCompetitor[]
} {
  const order: string[] = []
  const found = new Map<string, { item: NamedCompetitor; direct: boolean }>()
  for (const row of rows) {
    const key = companyKey(row, found)
    const current = found.get(key)
    if (current === undefined) {
      order.push(key)
      found.set(key, {
        item: {
          name: row.name,
          domain: row.domain,
          ...(row.aliases && row.aliases.length > 0 ? { aliases: [...row.aliases] } : {})
        },
        direct: row.tier === 'direct'
      })
      continue
    }
    if (row.tier === 'direct') current.direct = true
    if (current.item.domain === null && row.domain !== null) current.item.domain = row.domain
    const extra = [...(row.aliases ?? []), ...(row.domain !== null ? [row.domain] : [])].filter(
      (host) => host !== current.item.domain && !(current.item.aliases ?? []).includes(host)
    )
    if (extra.length > 0) current.item.aliases = [...(current.item.aliases ?? []), ...extra]
  }
  const direct: NamedCompetitor[] = []
  const partial: NamedCompetitor[] = []
  for (const key of order) {
    const entry = found.get(key)
    if (entry === undefined) continue
    ;(entry.direct ? direct : partial).push(entry.item)
  }
  return { direct, partial }
}

function companyKey(
  row: Pick<ProductCompetitor, 'name' | 'domain'>,
  found: ReadonlyMap<string, { item: NamedCompetitor }>
): string {
  const name = row.name.trim().toLowerCase()
  if (found.has(name)) return name
  if (row.domain !== null) {
    for (const [key, entry] of found) {
      if (entry.item.domain === row.domain) return key
    }
  }
  return name
}

/** An id in the scope is a non-empty string; an empty one is a caller bug, not "everything". */
function assertScope(scope: CompetitorScope): void {
  for (const key of ['pageId', 'topicId', 'productId'] as const) {
    const value = scope[key]
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
      throw new TypeError(`competitorContext: ${key} must be a non-empty id.`)
    }
  }
}

/** A saved name with its domain when the name is a domain or a site address. */
export function namedCompetitor(entry: string): NamedCompetitor {
  const name = entry.trim()
  return { name, domain: domainOf(name) }
}

/**
 * `simpletexting.com`, `www.Twilio.com/sms` or `https://get-voip.com/` give their
 * host without `www.`, lower case. A plain name such as `SimpleTexting` gives null.
 */
export function domainOf(value: string): string | null {
  return competitorDomainOf(value)
}

/** Trimmed, blanks dropped, first spelling kept for names that differ only by case. */
function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const name = value.trim()
    const key = name.toLowerCase()
    if (name.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}
