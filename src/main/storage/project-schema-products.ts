import { competitorDomainOf } from '@shared/domain'
import type { Migration } from './migrate'

/**
 * Project migration 034: products and competitors by product (Docs/PROMPT-AUDIT.md
 * section 2.3, package PC). The same business can sell several products, and one
 * company can be a direct competitor of one product and only a partial one, or none,
 * of another.
 *
 * - `products`: what the business sells (Fill from my website, or typed in Settings).
 * - `product_competitors`: one row per competitor per product; `product_id` NULL is a
 *   competitor of the whole business. The flat `project_settings.competitors` list
 *   stays as the union, for the readers that have not moved yet.
 * - `pages.product_id` and `pages.product_pinned`: the product a page or a topic (a
 *   topic is a `pages` row) is about. While `product_pinned` is 0 the product is
 *   inferred when read (URL rules, Fill evidence paths, the topic's seed), so a later
 *   Fill or a new product re-maps it; once the user picks one (or "whole business")
 *   it is pinned.
 *
 * The existing flat list is copied into `product_competitors` with no product, so a
 * project from before this migration reads the same competitors as it did.
 */
export const PRODUCTS_VERSION = 34

export const PRODUCTS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: PRODUCTS_VERSION,
    name: `${String(PRODUCTS_VERSION).padStart(3, '0')}_products`,
    up(db) {
      db.exec(`
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          job TEXT NOT NULL DEFAULT '',
          buyer TEXT NOT NULL DEFAULT '',
          evidence_path TEXT,
          position INTEGER NOT NULL,
          CHECK (length(id) > 0 AND length(id) <= 80),
          CHECK (length(name) > 0 AND length(name) <= 80),
          CHECK (length(job) <= 300),
          CHECK (length(buyer) <= 300),
          CHECK (evidence_path IS NULL OR (length(evidence_path) > 0 AND length(evidence_path) <= 300)),
          CHECK (position >= 0)
        );
        CREATE TABLE product_competitors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id TEXT REFERENCES products (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          domain TEXT,
          tier TEXT NOT NULL DEFAULT 'direct',
          starting_price TEXT,
          sources_json TEXT NOT NULL DEFAULT '[]',
          position INTEGER NOT NULL,
          CHECK (length(name) > 0 AND length(name) <= 80),
          CHECK (domain IS NULL OR (length(domain) > 0 AND length(domain) <= 253)),
          CHECK (tier IN ('direct', 'partial')),
          CHECK (starting_price IS NULL OR length(starting_price) <= 60),
          CHECK (position >= 0)
        );
        CREATE UNIQUE INDEX idx_product_competitors_name
          ON product_competitors (ifnull(product_id, ''), lower(name));
        CREATE INDEX idx_product_competitors_product
          ON product_competitors (product_id, position);
        ALTER TABLE pages ADD COLUMN product_id TEXT REFERENCES products (id) ON DELETE SET NULL;
        ALTER TABLE pages ADD COLUMN product_pinned INTEGER NOT NULL DEFAULT 0
          CHECK (product_pinned IN (0, 1));
      `)
      copyFlatCompetitors(db)
    }
  }
]

/** The flat list as whole-business rows, in order, each name once (ignoring case). */
function copyFlatCompetitors(db: Parameters<Migration['up']>[0]): void {
  const row = db
    .prepare<unknown[], { competitors: string }>(
      `SELECT competitors FROM project_settings WHERE id = 1`
    )
    .get()
  if (row === undefined) return
  let names: unknown
  try {
    names = JSON.parse(row.competitors) as unknown
  } catch {
    return
  }
  if (!Array.isArray(names)) return
  const insert = db.prepare(
    `INSERT INTO product_competitors (product_id, name, domain, tier, position)
     VALUES (NULL, ?, ?, 'direct', ?)`
  )
  const seen = new Set<string>()
  let position = 0
  for (const value of names) {
    if (typeof value !== 'string') continue
    const name = value.trim().slice(0, 80)
    const key = name.toLowerCase()
    if (name.length === 0 || seen.has(key)) continue
    seen.add(key)
    insert.run(name, competitorDomainOf(name), position)
    position += 1
  }
}
