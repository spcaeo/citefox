import type { Migration } from './migrate'

/**
 * Project migration 040: `product_competitors.aliases_json`, a competitor's other
 * domains (`app.simpletexting.com`, a country site, a brand bought up). The matcher
 * counts a cited host as the competitor when it is the main domain, one of these, or a
 * subdomain of either. A JSON array of bare hosts, empty by default.
 */
export const COMPETITOR_ALIASES_VERSION = 40

export const COMPETITOR_ALIASES_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: COMPETITOR_ALIASES_VERSION,
    name: `${String(COMPETITOR_ALIASES_VERSION).padStart(3, '0')}_competitor_aliases`,
    up(db) {
      db.exec(`ALTER TABLE product_competitors ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';`)
    }
  }
]
