import { isIntervalDays, isPageKind, isPageStatus, isSampleCount } from '@shared/domain'
import type {
  IntervalDays,
  PageKind,
  PageSetupStep,
  PageStatus,
  PageSummary,
  SampleCount
} from '@shared/domain'
import { containsSecret } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { deleteFixFollowUpsForPage } from './fix-follow-ups'
import { assertId, requireOptionalLabel, requireUtcTimestamp } from './values'

/**
 * `pages` and `page_markets` in the project database.
 * Status values are the shared `PageStatus` names.
 * `setupStep` and `promptSetVersion` are derived when a page is read back.
 * Removed pages stay in the table. Removal clears `pinned` and `pinned_at` (FR-20.9)
 * and deletes that page's fix follow-ups (SCH-10).
 * The file is already one project, so `project_id` is not a column.
 * Readers pass the project id and it is copied onto `PageSummary`.
 */
export const MAX_PROMPT_COUNT = 1000

/** A page row without `projectId`. That id comes from the project context. */
export type StoredPage = Omit<PageSummary, 'projectId'>

export interface PageMarketRecord {
  pageId: string
  marketId: string
  addedAt: string
  baselineRunId: string | null
}

/**
 * SCH-12. A page market whose first check is allowed as of a given instant.
 * `firstCheckNotBefore` null means the check is not held for stagger.
 */
export interface PageMarketFirstCheckDue {
  pageId: string
  marketId: string
  firstCheckNotBefore: string | null
}

export function insertPage(db: SqliteDatabase, page: PageSummary): void {
  const row = normalizePage(db, page)
  // A page row leaves `kind` to its default ('page'), so the same insert works on a
  // file from before migration 027 (tests open old schemas); a topic names it.
  const topic = row.kind === 'topic'
  try {
    db.prepare(
      `INSERT INTO pages (
         id, url, title, label, folder, status, interval_days, samples, prompt_count,
         default_market_id, pinned, score${topic ? ', kind' : ''}
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${topic ? ", 'topic'" : ''})`
    ).run(
      row.id,
      row.url,
      row.title,
      row.label,
      row.folder,
      row.status,
      row.intervalDays,
      row.samples,
      row.promptCount,
      row.defaultMarketId,
      row.pinned ? 1 : 0,
      row.score
    )
  } catch (error) {
    if (isSqliteError(error) && error.message.includes('pages.url')) {
      throw new StorageError('A page with this URL already exists')
    }
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save page')
  }
}

export function getStoredPage(db: SqliteDatabase, id: string): StoredPage | null {
  assertId(id)
  const row = db.prepare<unknown[], PageSql>(`${PAGE_SELECT} WHERE id = ?`).get(id)
  return row === undefined ? null : pageFromSql(row)
}

/** `projectId` is the project that owns this database. It is not read from a column. */
export function getPage(db: SqliteDatabase, id: string, projectId: string): PageSummary | null {
  const stored = getStoredPage(db, id)
  return stored === null ? null : withProject(stored, projectId)
}

/** Pages of one kind, oldest row first. Topics have `kind: 'topic'` and no URL. */
export function listPagesOfKind(
  db: SqliteDatabase,
  projectId: string,
  kind: PageKind
): PageSummary[] {
  const id = assertId(projectId)
  return db
    .prepare<unknown[], PageSql>(`${PAGE_SELECT} WHERE kind = ? ORDER BY rowid ASC`)
    .all(kind)
    .map((row) => withProject(pageFromSql(row), id))
}

/** The page for this exact URL, or null. URLs are unique in one project file. */
export function getPageByUrl(
  db: SqliteDatabase,
  url: string,
  projectId: string
): PageSummary | null {
  const row = db.prepare<unknown[], PageSql>(`${PAGE_SELECT} WHERE url = ?`).get(url)
  return row === undefined ? null : withProject(pageFromSql(row), projectId)
}

export function listPages(db: SqliteDatabase, projectId: string): PageSummary[] {
  const id = assertId(projectId)
  return db
    .prepare<unknown[], PageSql>(`${PAGE_SELECT} ORDER BY rowid ASC`)
    .all()
    .map((row) => withProject(pageFromSql(row), id))
}

/** Pinned pages still on the list. A removed page is hidden here. Oldest row first. */
export function listPinnedPages(db: SqliteDatabase, projectId: string): PageSummary[] {
  const id = assertId(projectId)
  return db
    .prepare<unknown[], PageSql>(
      `${PAGE_SELECT} WHERE pinned = 1 AND status != 'removed' AND kind = 'page'
        ORDER BY pinned_at ASC, rowid ASC`
    )
    .all()
    .map((row) => withProject(pageFromSql(row), id))
}

export function setPagePinned(
  db: SqliteDatabase,
  id: string,
  pinned: boolean,
  projectId: string,
  pinnedAt?: string
): PageSummary {
  const existing = requirePage(db, id, projectId)
  const at = pinned ? (existing.pinned ? currentPinnedAt(db, id) : requirePinTime(pinnedAt)) : null
  const result = db
    .prepare(`UPDATE pages SET pinned = ?, pinned_at = ? WHERE id = ?`)
    .run(pinned ? 1 : 0, at, id)
  if (result.changes !== 1) throw new StorageError('Could not save page')
  return { ...existing, pinned }
}

export function setPageStatus(
  db: SqliteDatabase,
  id: string,
  status: PageStatus,
  projectId: string
): PageSummary {
  const existing = requirePage(db, id, projectId)
  const next = requireStatus(status)
  if (next === 'removed') {
    const write = db.transaction(() => {
      deleteFixFollowUpsForPage(db, id)
      const result = db
        .prepare(`UPDATE pages SET status = ?, pinned = 0, pinned_at = NULL WHERE id = ?`)
        .run(next, id)
      if (result.changes !== 1) throw new StorageError('Could not save page')
    })
    try {
      write()
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('Could not save page')
    }
    return { ...existing, status: next, pinned: false }
  }
  const result = db.prepare(`UPDATE pages SET status = ? WHERE id = ?`).run(next, id)
  if (result.changes !== 1) throw new StorageError('Could not save page')
  return { ...existing, status: next }
}

/** Fills a title the page did not have yet. A title the caller already stored is left as it is. */
export function setPageTitleIfEmpty(
  db: SqliteDatabase,
  id: string,
  title: string | null,
  projectId: string
): PageSummary {
  const existing = requirePage(db, id, projectId)
  if (existing.title !== null || title === null) return existing
  const stored = requireOptionalLabel(title, 'page title', 300)
  const result = db
    .prepare(`UPDATE pages SET title = ? WHERE id = ? AND title IS NULL`)
    .run(stored, id)
  if (result.changes !== 1) return getPage(db, id, projectId) ?? existing
  return { ...existing, title: stored }
}

export interface PageFieldPatch {
  url?: string | null
  title?: string | null
  label?: string | null
  folder?: string | null
  intervalDays?: IntervalDays
  samples?: SampleCount
  promptCount?: number
  defaultMarketId?: string | null
  status?: PageStatus
}

/** Replaces the editable page columns. Title, folder, pin, and score stay. */
export function updateStoredPage(
  db: SqliteDatabase,
  id: string,
  projectId: string,
  patch: PageFieldPatch
): PageSummary {
  const existing = requirePage(db, id, projectId)
  const next = normalizePage(db, {
    ...existing,
    ...patch,
    id,
    projectId
  })
  try {
    const result = db
      .prepare(
        `UPDATE pages SET
           url = ?, title = ?, label = ?, folder = ?, interval_days = ?, samples = ?,
           prompt_count = ?, default_market_id = ?, status = ?
         WHERE id = ?`
      )
      .run(
        next.url,
        next.title,
        next.label,
        next.folder,
        next.intervalDays,
        next.samples,
        next.promptCount,
        next.defaultMarketId,
        next.status,
        next.id
      )
    if (result.changes !== 1) throw new StorageError('Could not save page')
  } catch (error) {
    if (isSqliteError(error) && error.message.includes('pages.url')) {
      throw new StorageError('A page with this URL already exists')
    }
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save page')
  }
  return getPage(db, id, projectId) ?? next
}

/** Replaces the markets linked to a page. Market rows themselves stay. */
export function replacePageMarkets(
  db: SqliteDatabase,
  pageId: string,
  marketIds: readonly string[],
  addedAt: string
): void {
  const id = assertId(pageId)
  if (getStoredPage(db, id) === null) throw new StorageError('Could not save page market')
  const unique: string[] = []
  const seen = new Set<string>()
  for (const marketId of marketIds) {
    const next = assertId(marketId)
    if (seen.has(next)) continue
    seen.add(next)
    const market = db.prepare(`SELECT id FROM markets WHERE id = ?`).get(next)
    if (market === undefined) throw new StorageError('Could not save page market')
    unique.push(next)
  }
  const existing = listPageMarkets(db, id)
  const write = db.transaction(() => {
    for (const link of existing) {
      if (!seen.has(link.marketId)) {
        db.prepare(`DELETE FROM page_markets WHERE page_id = ? AND market_id = ?`).run(
          id,
          link.marketId
        )
      }
    }
    for (const marketId of unique) {
      if (existing.some((link) => link.marketId === marketId)) continue
      addPageMarket(db, { pageId: id, marketId, addedAt, baselineRunId: null })
    }
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save page market')
  }
}

/** Unlinks one market from a page. The market row and the page's past runs stay. */
export function deletePageMarket(db: SqliteDatabase, pageId: string, marketId: string): void {
  const result = db
    .prepare(`DELETE FROM page_markets WHERE page_id = ? AND market_id = ?`)
    .run(assertId(pageId), assertId(marketId))
  if (result.changes !== 1) throw new StorageError('Unknown page market')
}

export function addPageMarket(db: SqliteDatabase, record: PageMarketRecord): void {
  const pageId = assertId(record.pageId)
  const marketId = assertId(record.marketId)
  if (getStoredPage(db, pageId) === null) throw new StorageError('Could not save page market')
  const market = db.prepare(`SELECT id FROM markets WHERE id = ?`).get(marketId)
  if (market === undefined) throw new StorageError('Could not save page market')
  const addedAt = requireUtcTimestamp(record.addedAt)
  const baseline = record.baselineRunId === null ? null : assertId(record.baselineRunId)
  try {
    db.prepare(
      `INSERT INTO page_markets (page_id, market_id, added_at, baseline_run_id)
       VALUES (?, ?, ?, ?)`
    ).run(pageId, marketId, addedAt, baseline)
  } catch (error) {
    if (isSqliteError(error) && error.message.includes('PRIMARY KEY')) {
      throw new StorageError('This page already tracks that market')
    }
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save page market')
  }
}

/**
 * FR-9.4. Null until the first check in this market. The row must already exist.
 * Stored as ISO-8601 UTC (NFR-15).
 */
export function getPageMarketLastCheckedAt(
  db: SqliteDatabase,
  pageId: string,
  marketId: string
): string | null {
  const page = assertId(pageId)
  const market = assertId(marketId)
  const row = db
    .prepare<unknown[], { last_checked_at: string | null }>(
      `SELECT last_checked_at FROM page_markets WHERE page_id = ? AND market_id = ?`
    )
    .get(page, market)
  if (row === undefined) throw new StorageError('Unknown page market')
  return row.last_checked_at
}

export function setPageMarketLastCheckedAt(
  db: SqliteDatabase,
  pageId: string,
  marketId: string,
  checkedAt: string
): void {
  const page = assertId(pageId)
  const market = assertId(marketId)
  const at = requireUtcTimestamp(checkedAt)
  const result = db
    .prepare(`UPDATE page_markets SET last_checked_at = ? WHERE page_id = ? AND market_id = ?`)
    .run(at, page, market)
  if (result.changes !== 1) throw new StorageError('Unknown page market')
}

/** Section 8. The latest baseline run for this page market. */
export function setPageMarketBaselineRunId(
  db: SqliteDatabase,
  pageId: string,
  marketId: string,
  runId: string
): void {
  const page = assertId(pageId)
  const market = assertId(marketId)
  const run = assertId(runId)
  const result = db
    .prepare(`UPDATE page_markets SET baseline_run_id = ? WHERE page_id = ? AND market_id = ?`)
    .run(run, page, market)
  if (result.changes !== 1) throw new StorageError('Unknown page market')
}

/** Default-market visibility score. Null clears a score. `pages:update` does not write this. */
export function setPageScore(db: SqliteDatabase, pageId: string, score: number | null): void {
  const id = assertId(pageId)
  if (score !== null && !Number.isFinite(score)) throw new StorageError('Invalid score')
  const result = db.prepare(`UPDATE pages SET score = ? WHERE id = ?`).run(score, id)
  if (result.changes !== 1) throw new StorageError('Could not save page')
}

/**
 * SCH-12. Null until an import staggers this market's first check.
 * The row must already exist. Stored as ISO-8601 UTC (NFR-15).
 */
export function getPageMarketFirstCheckNotBefore(
  db: SqliteDatabase,
  pageId: string,
  marketId: string
): string | null {
  const page = assertId(pageId)
  const market = assertId(marketId)
  const row = db
    .prepare<unknown[], { first_check_not_before: string | null }>(
      `SELECT first_check_not_before FROM page_markets WHERE page_id = ? AND market_id = ?`
    )
    .get(page, market)
  if (row === undefined) throw new StorageError('Unknown page market')
  if (row.first_check_not_before !== null) requireUtcTimestamp(row.first_check_not_before)
  return row.first_check_not_before
}

/** Pass null to clear a stagger hold. The page market must already exist. */
export function setPageMarketFirstCheckNotBefore(
  db: SqliteDatabase,
  pageId: string,
  marketId: string,
  notBefore: string | null
): void {
  const page = assertId(pageId)
  const market = assertId(marketId)
  const at = notBefore === null ? null : requireUtcTimestamp(notBefore)
  const result = db
    .prepare(
      `UPDATE page_markets SET first_check_not_before = ? WHERE page_id = ? AND market_id = ?`
    )
    .run(at, page, market)
  if (result.changes !== 1) throw new StorageError('Unknown page market')
}

/**
 * SCH-12. Page markets that have not been checked, whose stagger hold is
 * absent or at or before `asOf`. Quiet hours and the daily check time are
 * not applied here. `asOf` is ISO-8601 UTC.
 */
export function listPageMarketsFirstCheckDue(
  db: SqliteDatabase,
  asOf: string
): PageMarketFirstCheckDue[] {
  const at = Date.parse(requireUtcTimestamp(asOf))
  const rows = db
    .prepare<unknown[], FirstCheckSql>(
      `SELECT page_id, market_id, first_check_not_before
       FROM page_markets
       WHERE last_checked_at IS NULL`
    )
    .all()
  const due: PageMarketFirstCheckDue[] = []
  for (const row of rows) {
    const notBefore = row.first_check_not_before
    if (notBefore !== null) {
      requireUtcTimestamp(notBefore)
      if (Date.parse(notBefore) > at) continue
    }
    due.push({
      pageId: row.page_id,
      marketId: row.market_id,
      firstCheckNotBefore: notBefore
    })
  }
  due.sort(compareFirstCheckDue)
  return due
}

/** One page's market with the two scheduling columns. */
export interface PageMarketSchedule {
  marketId: string
  lastCheckedAt: string | null
  firstCheckNotBefore: string | null
}

/**
 * Every page's markets and their scheduling columns in one query, grouped by
 * page id in the `listPageMarkets` order. The scheduler reads this instead of
 * one market list and two lookups per page.
 */
export function listPageMarketSchedules(db: SqliteDatabase): Map<string, PageMarketSchedule[]> {
  const rows = db
    .prepare<
      unknown[],
      {
        page_id: string
        market_id: string
        last_checked_at: string | null
        first_check_not_before: string | null
      }
    >(
      `SELECT page_id, market_id, last_checked_at, first_check_not_before
       FROM page_markets ORDER BY page_id ASC, added_at ASC, rowid ASC`
    )
    .all()
  const byPage = new Map<string, PageMarketSchedule[]>()
  for (const row of rows) {
    const list = byPage.get(row.page_id) ?? []
    list.push({
      marketId: row.market_id,
      lastCheckedAt: row.last_checked_at,
      firstCheckNotBefore: row.first_check_not_before
    })
    byPage.set(row.page_id, list)
  }
  return byPage
}

export function listPageMarkets(db: SqliteDatabase, pageId: string): PageMarketRecord[] {
  assertId(pageId)
  return db
    .prepare<unknown[], PageMarketSql>(
      `SELECT page_id, market_id, added_at, baseline_run_id
       FROM page_markets WHERE page_id = ? ORDER BY added_at ASC, rowid ASC`
    )
    .all(pageId)
    .map((row) => ({
      pageId: row.page_id,
      marketId: row.market_id,
      addedAt: row.added_at,
      baselineRunId: row.baseline_run_id
    }))
}

/**
 * Setup step and active prompt-set version come back in the same statement, so a
 * list of 2,000+ pages is one query rather than three more per page (NFR-12).
 */
const PAGE_SELECT = `SELECT id, url, title, label, folder, status, interval_days, samples,
  prompt_count, default_market_id, pinned, score, kind,
  EXISTS (SELECT 1 FROM snapshots WHERE snapshots.page_id = pages.id) AS has_snapshot,
  EXISTS (SELECT 1 FROM buyer_profiles WHERE buyer_profiles.page_id = pages.id) AS has_profile,
  (SELECT version FROM prompt_sets
    WHERE prompt_sets.page_id = pages.id AND prompt_sets.is_active = 1) AS active_version
  FROM pages`

interface PageSql {
  id: string
  url: string | null
  kind: string
  title: string | null
  label: string | null
  folder: string | null
  status: string
  interval_days: number
  samples: number
  prompt_count: number
  default_market_id: string | null
  pinned: number
  score: number | null
  has_snapshot: number
  has_profile: number
  active_version: number | null
}

interface PageMarketSql {
  page_id: string
  market_id: string
  added_at: string
  baseline_run_id: string | null
}

interface FirstCheckSql {
  page_id: string
  market_id: string
  first_check_not_before: string | null
}

function compareFirstCheckDue(
  left: PageMarketFirstCheckDue,
  right: PageMarketFirstCheckDue
): number {
  const leftAt =
    left.firstCheckNotBefore === null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(left.firstCheckNotBefore)
  const rightAt =
    right.firstCheckNotBefore === null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(right.firstCheckNotBefore)
  if (leftAt !== rightAt) return leftAt - rightAt
  if (left.pageId !== right.pageId) return left.pageId < right.pageId ? -1 : 1
  if (left.marketId !== right.marketId) return left.marketId < right.marketId ? -1 : 1
  return 0
}

function currentPinnedAt(db: SqliteDatabase, id: string): string | null {
  const row = db
    .prepare<unknown[], { pinned_at: string | null }>(`SELECT pinned_at FROM pages WHERE id = ?`)
    .get(id)
  return row?.pinned_at ?? null
}

function requirePinTime(value: string | undefined): string {
  const at = value ?? new Date().toISOString()
  if (Number.isNaN(Date.parse(at))) throw new StorageError('Could not save page')
  return at
}

function requirePage(db: SqliteDatabase, id: string, projectId: string): PageSummary {
  const existing = getPage(db, id, projectId)
  if (existing === null) throw new StorageError('Could not save page')
  return existing
}

function normalizePage(db: SqliteDatabase, page: PageSummary): PageSummary {
  const defaultMarketId = page.defaultMarketId === null ? null : assertId(page.defaultMarketId)
  if (defaultMarketId !== null) {
    const market = db.prepare(`SELECT id FROM markets WHERE id = ?`).get(defaultMarketId)
    if (market === undefined) throw new StorageError('Invalid default market')
  }
  const kind = page.kind ?? 'page'
  if (!isPageKind(kind)) throw new StorageError('Invalid page kind')
  const title = requireOptionalLabel(page.title, 'page title', 300)
  if (kind === 'topic' && (title === null || title.trim().length === 0)) {
    throw new StorageError('A topic needs a name')
  }
  return {
    ...page,
    id: assertId(page.id),
    projectId: assertId(page.projectId),
    kind,
    url: kind === 'topic' ? requireNoTopicUrl(page.url) : requirePageUrl(page.url),
    title,
    label: requireOptionalLabel(page.label, 'page label', 80),
    folder: requireOptionalLabel(page.folder, 'page folder', 200),
    status: requireStatus(page.status),
    intervalDays: requireInterval(page.intervalDays),
    samples: requireSamples(page.samples),
    promptCount: requirePromptCount(page.promptCount),
    defaultMarketId,
    pinned: page.pinned,
    score: requireScore(page.score)
  }
}

function withProject(page: StoredPage, projectId: string): PageSummary {
  return { ...page, projectId: assertId(projectId) }
}

function pageFromSql(row: PageSql): StoredPage {
  const derived = derivedFields(row)
  if (!isPageKind(row.kind)) throw new StorageError('Invalid page kind')
  return {
    id: row.id,
    url: row.url,
    kind: row.kind,
    title: row.title,
    label: row.label,
    folder: row.folder,
    status: requireStatus(row.status),
    setupStep: derived.setupStep,
    intervalDays: requireInterval(row.interval_days),
    samples: requireSamples(row.samples),
    promptCount: row.prompt_count,
    defaultMarketId: row.default_market_id,
    pinned: row.pinned === 1,
    score: row.score,
    promptSetVersion: derived.promptSetVersion
  }
}

function derivedFields(row: PageSql): {
  setupStep: PageSetupStep | null
  promptSetVersion: number | null
} {
  const promptSetVersion = row.active_version ?? null
  if (row.has_snapshot !== 1) return { setupStep: 'read', promptSetVersion }
  if (row.has_profile !== 1) return { setupStep: 'profile', promptSetVersion }
  if (promptSetVersion === null) return { setupStep: 'prompts', promptSetVersion }
  return { setupStep: 'check', promptSetVersion }
}

function requireStatus(value: string): PageStatus {
  if (!isPageStatus(value)) throw new StorageError('Invalid page status')
  return value
}

function requireInterval(value: number): IntervalDays {
  if (!isIntervalDays(value)) throw new StorageError('Invalid interval')
  return value
}

function requireSamples(value: number): SampleCount {
  if (!isSampleCount(value)) throw new StorageError('Invalid samples')
  return value
}

function requirePromptCount(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new StorageError('Invalid prompt count')
  if (value > MAX_PROMPT_COUNT) {
    throw new StorageError(`The maximum prompt count is ${MAX_PROMPT_COUNT}.`)
  }
  return value
}

function requireScore(value: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new StorageError('Invalid score')
  return value
}

function requireNoTopicUrl(value: string | null): null {
  if (value !== null) throw new StorageError('A topic has no URL')
  return null
}

function requirePageUrl(value: string | null): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new StorageError('Invalid page URL')
  }
  if (value.trim() !== value || value.includes('\0')) throw new StorageError('Invalid page URL')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new StorageError('Invalid page URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new StorageError('Invalid page URL')
  }
  if (url.username !== '' || url.password !== '') throw new StorageError('Invalid page URL')
  if (containsSecret(value)) throw new StorageError('page URL cannot contain a secret')
  return value
}
