import {
  competitorDomainOf,
  entryMatchesCompetitor,
  MAX_COMPETITOR_ALIASES,
  MAX_PRODUCT_COMPETITORS,
  MAX_PRODUCT_NAME,
  MAX_PRODUCTS
} from '@shared/domain'
import type { PageKind, ProductCompetitor, ProjectProduct } from '@shared/domain'
import { containsSecret } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'

/**
 * Products and competitors by product (migration 034, Docs/PROMPT-AUDIT.md PC).
 * `product_competitors.product_id` NULL is a competitor of the whole business.
 * The flat `project_settings.competitors` list is kept as the union (each row's
 * domain, else its name) for readers that have not moved yet: a catalog save rewrites
 * it, and a write of the flat list ({@link syncFlatCompetitors}) keeps the rows in step.
 */

export interface ProductCatalog {
  products: ProjectProduct[]
  competitors: ProductCompetitor[]
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MAX_TEXT = 300
const MAX_SOURCES = 8

export function readProductCatalog(db: SqliteDatabase): ProductCatalog {
  return { products: listProducts(db), competitors: listProductCompetitors(db) }
}

export function listProducts(db: SqliteDatabase): ProjectProduct[] {
  return db
    .prepare<unknown[], ProductSql>(
      `SELECT id, name, job, buyer, evidence_path FROM products ORDER BY position ASC, rowid ASC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      job: row.job,
      buyer: row.buyer,
      evidencePath: row.evidence_path
    }))
}

/** Every row, the products' rows in product order, then the whole-business rows. */
export function listProductCompetitors(db: SqliteDatabase): ProductCompetitor[] {
  return db
    .prepare<unknown[], CompetitorSql>(
      `SELECT c.product_id, c.name, c.domain, c.tier, c.starting_price, c.sources_json,
              c.aliases_json
       FROM product_competitors c LEFT JOIN products p ON p.id = c.product_id
       ORDER BY p.position IS NULL ASC, p.position ASC, c.position ASC, c.id ASC`
    )
    .all()
    .map((row) => ({
      name: row.name,
      domain: row.domain,
      productId: row.product_id,
      tier: row.tier === 'partial' ? 'partial' : 'direct',
      startingPrice: row.starting_price,
      sources: parseSources(row.sources_json),
      ...withAliases(parseAliases(row.aliases_json, row.domain))
    }))
}

/**
 * Replaces the products and every competitor row, and rewrites the flat list as their
 * union. Products are matched by id, so pages mapped to a kept product stay mapped; a
 * page pinned to a removed product goes back to automatic. Throws {@link StorageError}
 * on a bad catalog (see {@link normalizeCatalog}).
 */
export function replaceProductCatalog(db: SqliteDatabase, input: ProductCatalog): ProductCatalog {
  const catalog = normalizeCatalog(input)
  const write = db.transaction(() => {
    const keep = new Set(catalog.products.map((product) => product.id))
    const removed = listProducts(db)
      .map((product) => product.id)
      .filter((id) => !keep.has(id))
    const unpin = db.prepare(
      `UPDATE pages SET product_id = NULL, product_pinned = 0 WHERE product_id = ?`
    )
    const drop = db.prepare(`DELETE FROM products WHERE id = ?`)
    for (const id of removed) {
      unpin.run(id)
      drop.run(id)
    }
    const upsert = db.prepare(
      `INSERT INTO products (id, name, job, buyer, evidence_path, position)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, job = excluded.job,
         buyer = excluded.buyer, evidence_path = excluded.evidence_path,
         position = excluded.position`
    )
    catalog.products.forEach((product, position) =>
      upsert.run(
        product.id,
        product.name,
        product.job,
        product.buyer,
        product.evidencePath ?? null,
        position
      )
    )
    db.prepare(`DELETE FROM product_competitors`).run()
    const insert = db.prepare(
      `INSERT INTO product_competitors
         (product_id, name, domain, tier, starting_price, sources_json, position, aliases_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    catalog.competitors.forEach((row, position) =>
      insert.run(
        row.productId,
        row.name,
        row.domain,
        row.tier,
        row.startingPrice,
        JSON.stringify(row.sources),
        position,
        JSON.stringify(row.aliases ?? [])
      )
    )
    db.prepare(`UPDATE project_settings SET competitors = ? WHERE id = 1`).run(
      JSON.stringify(flatList(catalog.competitors))
    )
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save products')
  }
  return readProductCatalog(db)
}

/**
 * Keeps the rows in step with a write of the flat list (Settings › General, onboarding
 * profile): a row no entry names any more is deleted (from every product), and an entry
 * no row matches is added for the whole business. Call inside the writer's transaction.
 */
export function syncFlatCompetitors(db: SqliteDatabase, entries: readonly string[]): void {
  const rows = db
    .prepare<unknown[], { id: number; name: string; domain: string | null }>(
      `SELECT id, name, domain FROM product_competitors`
    )
    .all()
  const drop = db.prepare(`DELETE FROM product_competitors WHERE id = ?`)
  const kept = rows.filter((row) => {
    if (entries.some((entry) => entryMatchesCompetitor(entry, row))) return true
    drop.run(row.id)
    return false
  })
  const top = db
    .prepare<unknown[], { top: number | null }>(
      `SELECT MAX(position) AS top FROM product_competitors`
    )
    .get()
  let position = (top?.top ?? -1) + 1
  const insert = db.prepare(
    `INSERT OR IGNORE INTO product_competitors (product_id, name, domain, tier, position)
     VALUES (NULL, ?, ?, 'direct', ?)`
  )
  for (const entry of entries) {
    const name = entry.trim()
    if (name.length === 0 || name.length > MAX_PRODUCT_NAME) continue
    if (kept.some((row) => entryMatchesCompetitor(name, row))) continue
    const domain = competitorDomainOf(name)
    insert.run(name, domain, position)
    kept.push({ id: -1, name, domain })
    position += 1
  }
}

/** What a page's product is read from. `seed` is set for a topic. */
export interface PageProductRow {
  pageId: string
  kind: PageKind
  url: string | null
  title: string | null
  seed: string | null
  productId: string | null
  /** True once the user picked a product, or "whole business" (`productId` null). */
  pinned: boolean
}

export function readPageProductRow(db: SqliteDatabase, pageId: string): PageProductRow | null {
  const row = db
    .prepare<unknown[], PageProductSql>(
      `SELECT p.id, p.kind, p.url, p.title, p.label, p.product_id, p.product_pinned, t.seed
       FROM pages p LEFT JOIN topics t ON t.page_id = p.id WHERE p.id = ?`
    )
    .get(pageId)
  if (row === undefined) return null
  return {
    pageId: row.id,
    kind: row.kind === 'topic' ? 'topic' : 'page',
    url: row.url,
    title: row.title ?? row.label,
    seed: row.seed,
    productId: row.product_id,
    pinned: row.product_pinned === 1
  }
}

export function productExists(db: SqliteDatabase, productId: string): boolean {
  return db.prepare(`SELECT 1 FROM products WHERE id = ?`).get(productId) !== undefined
}

/**
 * Pins a page's product (`productId` null pins "whole business"), or with `pinned`
 * false returns it to automatic. Throws when the page or the product is unknown.
 */
export function setPageProduct(
  db: SqliteDatabase,
  pageId: string,
  productId: string | null,
  pinned: boolean
): void {
  if (!ID.test(pageId)) throw new StorageError('Invalid page id')
  if (productId !== null) {
    if (!ID.test(productId)) throw new StorageError('Invalid product id')
    if (!productExists(db, productId)) throw new StorageError('That product was not found')
  }
  const result = db
    .prepare(`UPDATE pages SET product_id = ?, product_pinned = ? WHERE id = ?`)
    .run(pinned ? productId : null, pinned ? 1 : 0, pageId)
  if (result.changes === 0) throw new StorageError('That page was not found')
}

/**
 * Checks and tidies a catalog from the renderer or from Fill: ids are safe and unique;
 * names are trimmed, 1–80 characters, never a secret; job, buyer and prices are
 * clipped; a competitor points at a listed product or none; a domain is a bare host
 * or null; sources are http(s) only; a name is kept once per product.
 */
export function normalizeCatalog(input: ProductCatalog): ProductCatalog {
  if (!Array.isArray(input.products) || !Array.isArray(input.competitors)) {
    throw new StorageError('Invalid products')
  }
  if (input.products.length > MAX_PRODUCTS) throw new StorageError('Too many products')
  if (input.competitors.length > MAX_PRODUCT_COMPETITORS) {
    throw new StorageError('Too many competitors')
  }
  const ids = new Set<string>()
  const products = input.products.map((product): ProjectProduct => {
    if (typeof product.id !== 'string' || !ID.test(product.id) || ids.has(product.id)) {
      throw new StorageError('Invalid product id')
    }
    ids.add(product.id)
    return {
      id: product.id,
      name: requireName(product.name, 'product name'),
      job: clip(product.job, MAX_TEXT) ?? '',
      buyer: clip(product.buyer, MAX_TEXT) ?? '',
      evidencePath: evidencePathOf(product.evidencePath)
    }
  })
  const seen = new Set<string>()
  const competitors: ProductCompetitor[] = []
  for (const row of input.competitors) {
    const productId = row.productId ?? null
    if (productId !== null && (typeof productId !== 'string' || !ids.has(productId))) {
      throw new StorageError('Invalid competitor product')
    }
    if (row.tier !== 'direct' && row.tier !== 'partial') {
      throw new StorageError('Invalid competitor tier')
    }
    const name = requireName(row.name, 'competitor name')
    const key = `${productId ?? ''}\u0000${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const domain = typeof row.domain === 'string' ? competitorDomainOf(row.domain) : null
    competitors.push({
      name,
      domain,
      productId,
      tier: row.tier,
      startingPrice: clip(row.startingPrice, 60),
      sources: sourcesOf(row.sources),
      ...withAliases(aliasesOf(row.aliases, domain))
    })
  }
  return { products, competitors }
}

/** The flat list: each row's domain (else its name), first spelling kept. */
export function flatList(rows: readonly Pick<ProductCompetitor, 'name' | 'domain'>[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const entry =
      row.domain !== null && row.domain.length <= MAX_PRODUCT_NAME ? row.domain : row.name
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

function requireName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new StorageError(`Invalid ${label}`)
  const name = value.replace(/\s+/gu, ' ').trim()
  if (name.length === 0 || name.length > MAX_PRODUCT_NAME || hasControl(name)) {
    throw new StorageError(`Invalid ${label}`)
  }
  if (containsSecret(name)) throw new StorageError(`${label} cannot contain a secret`)
  return name
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text.length === 0 || containsSecret(text)) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function evidencePathOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path.length > MAX_TEXT || hasControl(path)) return null
  return path
}

function sourcesOf(value: unknown): { url: string; biased: boolean }[] {
  if (!Array.isArray(value)) return []
  const out: { url: string; biased: boolean }[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { url?: unknown; biased?: unknown }
    if (typeof record.url !== 'string' || record.url.length > 500) continue
    if (!/^https?:\/\/[^\s]+$/iu.test(record.url) || containsSecret(record.url)) continue
    out.push({ url: record.url, biased: record.biased === true })
    if (out.length === MAX_SOURCES) break
  }
  return out
}

/** Bare hosts, each once, never the main domain, at most {@link MAX_COMPETITOR_ALIASES}. */
export function aliasesOf(value: unknown, domain: string | null): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') continue
    const host = competitorDomainOf(item)
    if (host === null || host.length > 253 || host === domain || out.includes(host)) continue
    out.push(host)
    if (out.length === MAX_COMPETITOR_ALIASES) break
  }
  return out
}

/** `{ aliases }` only when there are any, so rows without them read as before. */
function withAliases(aliases: string[]): { aliases?: string[] } {
  return aliases.length > 0 ? { aliases } : {}
}

function parseAliases(json: string | null | undefined, domain: string | null): string[] {
  if (typeof json !== 'string') return []
  try {
    return aliasesOf(JSON.parse(json) as unknown, domain)
  } catch {
    return []
  }
}

function parseSources(json: string): { url: string; biased: boolean }[] {
  try {
    return sourcesOf(JSON.parse(json) as unknown)
  } catch {
    return []
  }
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

interface ProductSql {
  id: string
  name: string
  job: string
  buyer: string
  evidence_path: string | null
}

interface CompetitorSql {
  product_id: string | null
  name: string
  domain: string | null
  tier: string
  starting_price: string | null
  sources_json: string
  aliases_json: string | null
}

interface PageProductSql {
  id: string
  kind: string
  url: string | null
  title: string | null
  label: string | null
  product_id: string | null
  product_pinned: number
  seed: string | null
}
