import type { Migration } from './migrate'

/**
 * Project migration 044: what the stored Google search already holds, read out.
 *
 * - `serp_results.google_json`: the parts of the sample's Google search CiteFox
 *   used to throw away: the top-10 organic results (`organic`: position, URL and
 *   domain; null when the search held no organic list) and the "People also ask"
 *   questions (`questions`). Written at capture time. Null on rows from before this
 *   migration: they are read from `raw_search_json` the first time a screen needs
 *   them, so opening a large project does not parse every stored search at once.
 * - `snapshots.eligibility_json`: whether Google may show and quote the page, from
 *   the HTML and headers of a direct page read (meta robots and googlebot,
 *   X-Robots-Tag, `data-nosnippet`). Null when the read did not see the HTML
 *   (Jina Reader, a supplied file) or came before this migration.
 */
export const GOOGLE_EXTRAS_VERSION = 44

export const GOOGLE_EXTRAS_PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    version: GOOGLE_EXTRAS_VERSION,
    name: `${String(GOOGLE_EXTRAS_VERSION).padStart(3, '0')}_google_extras`,
    up(db) {
      db.exec(`
        ALTER TABLE serp_results ADD COLUMN google_json TEXT
          CHECK (google_json IS NULL OR json_valid(google_json));
        ALTER TABLE snapshots ADD COLUMN eligibility_json TEXT
          CHECK (eligibility_json IS NULL OR json_valid(eligibility_json));
      `)
    }
  }
]
