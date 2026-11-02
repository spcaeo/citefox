import { cleanHost } from '@shared/competitor-hosts'
import { isSortableSiteKind, type SortableSiteKind } from '@shared/report/site-kinds'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp, runWrite } from './record-values'

/**
 * `site_kinds` in the project database (project migration 037): the kind Claude gave
 * each cited domain, asked once per domain. A row with an unknown kind is left out on
 * read. A project file written before the table reads as empty.
 */

/** Domains per `IN (...)` query, well under SQLite's bound-parameter limit. */
const CHUNK = 500

interface SiteKindSql {
  domain: string
  kind: string
}

/** Saves the kinds of these domains, replacing earlier ones. */
export function saveSiteKinds(
  db: SqliteDatabase,
  sorted: readonly { domain: string; kind: SortableSiteKind }[],
  sortedAt: string
): void {
  const at = requireUtcTimestamp(sortedAt)
  const rows = sorted.map((item) => {
    const domain = cleanHost(item.domain)
    if (domain.length === 0 || domain.length > 253) throw new StorageError('Invalid domain')
    if (!isSortableSiteKind(item.kind)) throw new StorageError('Invalid site kind')
    return { domain, kind: item.kind }
  })
  if (rows.length === 0) return
  runWrite(
    () =>
      db.transaction(() => {
        const insert = db.prepare(
          'INSERT OR REPLACE INTO site_kinds (domain, kind, sorted_at) VALUES (?, ?, ?)'
        )
        for (const row of rows) insert.run(row.domain, row.kind, at)
      })(),
    'Could not save the site kinds'
  )
}

/** Stored kinds for these domains (or every stored one when `domains` is omitted). */
export function readSiteKinds(
  db: SqliteDatabase,
  domains?: readonly string[]
): Map<string, SortableSiteKind> {
  const found = new Map<string, SortableSiteKind>()
  try {
    const add = (rows: readonly SiteKindSql[]): void => {
      for (const row of rows) if (isSortableSiteKind(row.kind)) found.set(row.domain, row.kind)
    }
    if (domains === undefined) {
      add(db.prepare<unknown[], SiteKindSql>('SELECT domain, kind FROM site_kinds').all())
      return found
    }
    const unique = [...new Set(domains.map(cleanHost).filter((domain) => domain.length > 0))]
    for (let start = 0; start < unique.length; start += CHUNK) {
      const chunk = unique.slice(start, start + CHUNK)
      add(
        db
          .prepare<unknown[], SiteKindSql>(
            `SELECT domain, kind FROM site_kinds WHERE domain IN (${chunk.map(() => '?').join(', ')})`
          )
          .all(...chunk)
      )
    }
  } catch {
    // A project file written before migration 037: nothing is sorted yet.
  }
  return found
}
