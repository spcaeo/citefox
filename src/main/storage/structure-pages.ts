import type { IntervalDays, PageStatus, SampleCount } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { insertPage, MAX_PROMPT_COUNT, replacePageMarkets, setPageStatus } from './pages'
import { assertId, requireUtcTimestamp } from './values'

/**
 * Bulk page writes for sitemap sync and Import pages. Single-page writes stay
 * in `pages.ts`; these add many pages or change many statuses in one pass
 * without reading each page back (2,000+ pages per project, FR-20.1).
 */

/** A light page row for structure screens. No derived setup fields. */
export interface StructurePageRow {
  id: string
  url: string
  title: string | null
  status: PageStatus
  score: number | null
  defaultMarketId: string | null
}

const WORKING: ReadonlySet<PageStatus> = new Set(['tracked', 'setting_up', 'paused'])

export function isWorkingStatus(status: PageStatus): boolean {
  return WORKING.has(status)
}

/** Every page except removed ones, oldest first. One query. */
export function listStructurePages(
  db: SqliteDatabase,
  options: { includeRemoved?: boolean } = {}
): StructurePageRow[] {
  // Topics are pages with no URL (migration 027); site structure only lists site pages.
  const where =
    options.includeRemoved === true
      ? 'WHERE url IS NOT NULL'
      : `WHERE url IS NOT NULL AND status != 'removed'`
  return db
    .prepare<
      unknown[],
      {
        id: string
        url: string
        title: string | null
        status: PageStatus
        score: number | null
        default_market_id: string | null
      }
    >(
      `SELECT id, url, title, status, score, default_market_id FROM pages ${where} ORDER BY rowid ASC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      status: row.status,
      score: row.score,
      defaultMarketId: row.default_market_id
    }))
}

export interface UntrackedPageDefaults {
  intervalDays: IntervalDays
  samples: SampleCount
  promptCount: number
}

/** Adds a `not_tracked` page found in a sitemap. Validation is `insertPage`'s. */
export function insertUntrackedPage(
  db: SqliteDatabase,
  page: { id: string; projectId: string; url: string; folder: string | null },
  defaults: UntrackedPageDefaults
): void {
  insertPage(db, {
    id: page.id,
    projectId: page.projectId,
    url: page.url,
    title: null,
    label: null,
    folder: page.folder,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: defaults.intervalDays,
    samples: defaults.samples,
    promptCount: Math.min(MAX_PROMPT_COUNT, Math.max(1, defaults.promptCount)),
    defaultMarketId: null,
    pinned: false,
    score: null,
    promptSetVersion: null
  })
}

/**
 * Sets a status on many pages. `removed` goes through `setPageStatus` so pins
 * and fix follow-ups are cleared the same way as `pages:remove`.
 */
export function setPageStatuses(
  db: SqliteDatabase,
  projectId: string,
  pageIds: readonly string[],
  status: PageStatus
): void {
  if (status === 'removed') {
    for (const id of pageIds) setPageStatus(db, id, 'removed', projectId)
    return
  }
  const statement = db.prepare(`UPDATE pages SET status = ? WHERE id = ?`)
  for (const id of pageIds) statement.run(status, assertId(id))
}

export interface TrackSettings {
  marketIds: readonly string[]
  intervalDays: IntervalDays
  samples: SampleCount
  promptCount: number
  addedAt: string
  /** SCH-12 hold per page id. Missing ids are not held. */
  firstCheckNotBefore: ReadonlyMap<string, string>
}

/**
 * Starts tracking pages that are not tracked yet: status `setting_up`, the
 * chosen markets, interval, samples, and prompts, and an optional stagger hold
 * on each market's first check. Pages already working are skipped. Returns
 * the ids that changed. Run inside the caller's transaction.
 */
export function trackPages(
  db: SqliteDatabase,
  pageIds: readonly string[],
  settings: TrackSettings
): string[] {
  const first = settings.marketIds[0]
  if (first === undefined) throw new StorageError('Add a market or set the project default')
  if (!Number.isInteger(settings.promptCount) || settings.promptCount < 1) {
    throw new StorageError('Invalid prompt count')
  }
  const addedAt = requireUtcTimestamp(settings.addedAt)
  const status = db.prepare<unknown[], { status: PageStatus }>(
    `SELECT status FROM pages WHERE id = ?`
  )
  const update = db.prepare(
    `UPDATE pages SET status = 'setting_up', interval_days = ?, samples = ?, prompt_count = ?,
       default_market_id = ? WHERE id = ?`
  )
  const hold = db.prepare(
    `UPDATE page_markets SET first_check_not_before = ? WHERE page_id = ? AND last_checked_at IS NULL`
  )
  const changed: string[] = []
  for (const id of pageIds) {
    const row = status.get(assertId(id))
    if (row === undefined || WORKING.has(row.status)) continue
    update.run(
      settings.intervalDays,
      settings.samples,
      Math.min(MAX_PROMPT_COUNT, settings.promptCount),
      first,
      id
    )
    replacePageMarkets(db, id, settings.marketIds, addedAt)
    const notBefore = settings.firstCheckNotBefore.get(id)
    if (notBefore !== undefined) hold.run(requireUtcTimestamp(notBefore), id)
    changed.push(id)
  }
  return changed
}
