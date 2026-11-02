import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp } from './values'

/**
 * FR-20.5. Own URLs the user chose to Ignore in "Your pages cited but not
 * tracked" (`ignored_cited_urls`, project migration 019). Keyed by the
 * normalized URL so `?utm_…` variants of one page are one row.
 */
export function listIgnoredCitations(db: SqliteDatabase): Set<string> {
  return new Set(
    db
      .prepare<unknown[], { normalized_url: string }>(
        `SELECT normalized_url FROM ignored_cited_urls`
      )
      .all()
      .map((row) => row.normalized_url)
  )
}

export function setCitationIgnored(
  db: SqliteDatabase,
  input: { normalizedUrl: string; url: string; ignored: boolean; at: string }
): void {
  if (input.normalizedUrl.length === 0 || input.url.length === 0 || input.url.length > 2000) {
    throw new StorageError('Invalid URL')
  }
  if (!input.ignored) {
    db.prepare(`DELETE FROM ignored_cited_urls WHERE normalized_url = ?`).run(input.normalizedUrl)
    return
  }
  db.prepare(
    `INSERT INTO ignored_cited_urls (normalized_url, url, ignored_at) VALUES (?, ?, ?)
     ON CONFLICT (normalized_url) DO UPDATE SET url = excluded.url, ignored_at = excluded.ignored_at`
  ).run(input.normalizedUrl, input.url, requireUtcTimestamp(input.at))
}
