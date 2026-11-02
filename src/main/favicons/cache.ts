import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'

/**
 * Site icons as data URIs, in their own small SQLite file (`favicons.sqlite`
 * beside `app.sqlite`). It is a disposable cache: no migrations, no project
 * data, and deleting the file only means icons are fetched again. A null
 * `data_uri` is a negative entry ("this site has no usable icon"), kept for a
 * shorter time so a site that adds one shows it later.
 */

/** A found icon is kept this long. */
export const FAVICON_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** "No icon" is kept this long. */
export const FAVICON_NEGATIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000

export interface CachedFavicon {
  dataUri: string | null
}

export interface FaviconCache {
  /** The fresh entry for `domain`, or null when there is none or it expired. */
  get(domain: string, now: number): CachedFavicon | null
  put(domain: string, dataUri: string | null, now: number): void
  close(): void
}

export function openFaviconCache(filename: string): FaviconCache {
  const db = openSqliteDatabase(filename)
  db.exec(`
    CREATE TABLE IF NOT EXISTS favicons (
      domain TEXT PRIMARY KEY,
      data_uri TEXT,
      fetched_at INTEGER NOT NULL,
      CHECK (length(domain) BETWEEN 1 AND 253),
      CHECK (data_uri IS NULL OR data_uri LIKE 'data:image/%')
    )
  `)
  return faviconCacheOn(db)
}

export function faviconCacheOn(db: SqliteDatabase): FaviconCache {
  const select = db.prepare<[string], { data_uri: string | null; fetched_at: number }>(
    'SELECT data_uri, fetched_at FROM favicons WHERE domain = ?'
  )
  const upsert = db.prepare<[string, string | null, number]>(
    `INSERT INTO favicons (domain, data_uri, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET data_uri = excluded.data_uri, fetched_at = excluded.fetched_at`
  )
  return {
    get(domain, now) {
      const row = select.get(domain)
      if (row === undefined) return null
      const ttl = row.data_uri === null ? FAVICON_NEGATIVE_TTL_MS : FAVICON_TTL_MS
      if (now - row.fetched_at > ttl || row.fetched_at > now + 60_000) return null
      return { dataUri: row.data_uri }
    },
    put(domain, dataUri, now) {
      upsert.run(domain, dataUri, now)
    },
    close() {
      closeDatabase(db)
    }
  }
}
