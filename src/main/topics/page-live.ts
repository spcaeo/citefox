import type { EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import { readPage, type PageRead } from './page-context'
import { readOne } from './site'

/**
 * The page behind a target, read live once when it was never read (no snapshot and
 * no site read), so the diagnosis, the fix brief and the page brief see its real
 * headings and text instead of "Not read yet". The read is saved as a site read.
 * A page that still cannot be read stays null, and the prompts say so.
 */
export async function readPageOrLive(
  host: EngineHost,
  db: SqliteDatabase,
  target: { pageId: string | null; url: string | null }
): Promise<PageRead | null> {
  const stored = readPage(db, target)
  if (stored !== null || target.url === null) return stored
  const read = await readOne(host, db, target.url, 'other', false)
  return read.ok ? readPage(db, target) : null
}
