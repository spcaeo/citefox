import {
  DEFAULT_SITEMAP_SYNC_RULES,
  isSitemapChangedPageRule,
  isSitemapKind,
  isSitemapNewPageRule,
  isSitemapReadState,
  isSitemapRemovedPageRule,
  isSitemapSource,
  isSitemapSyncFrequency,
  type SitemapKind,
  type SitemapReadState,
  type SitemapRecord,
  type SitemapSource,
  type SitemapSyncReport,
  type SitemapSyncRules
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, readJson, requireUtcTimestamp } from './values'

/**
 * `sitemaps`, `sitemap_settings`, `sitemap_entries`, and `sitemap_syncs` in the
 * project database (migration 18). Every write is parameterized; URLs are
 * validated by the caller (`normalizePageUrl`) before they reach here.
 */

/** Sync reports kept per project. Older ones are deleted. */
export const KEPT_SYNC_REPORTS = 20

/** Names that are usually low value (FR-19.1 mock-up: tag-sitemap.xml left out). */
const LOW_VALUE =
  /(?:^|[/_-])(tag|tags|author|authors|category|categories|archive|attachment)s?[-_]?sitemap|\/(tag|author)[^/]*\.xml/i

export function isLowValueSitemap(url: string): boolean {
  return LOW_VALUE.test(url)
}

export interface NewSitemap {
  id: string
  url: string
  parentId: string | null
  source: SitemapSource
  included: boolean
  createdAt: string
}

export function insertSitemap(db: SqliteDatabase, sitemap: NewSitemap): void {
  try {
    db.prepare(
      `INSERT INTO sitemaps (id, url, parent_id, source, included, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      assertId(sitemap.id),
      requireUrl(sitemap.url),
      sitemap.parentId === null ? null : assertId(sitemap.parentId),
      sitemap.source,
      sitemap.included ? 1 : 0,
      requireUtcTimestamp(sitemap.createdAt)
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save the sitemap')
  }
}

export function listSitemaps(db: SqliteDatabase): SitemapRecord[] {
  return db
    .prepare<unknown[], SitemapSql>(`${SITEMAP_SELECT} ORDER BY created_at ASC, rowid ASC`)
    .all()
    .map(sitemapFromSql)
}

export function getSitemap(db: SqliteDatabase, id: string): SitemapRecord | null {
  const row = db.prepare<unknown[], SitemapSql>(`${SITEMAP_SELECT} WHERE id = ?`).get(assertId(id))
  return row === undefined ? null : sitemapFromSql(row)
}

export function getSitemapByUrl(db: SqliteDatabase, url: string): SitemapRecord | null {
  const row = db.prepare<unknown[], SitemapSql>(`${SITEMAP_SELECT} WHERE url = ?`).get(url)
  return row === undefined ? null : sitemapFromSql(row)
}

export function setSitemapIncluded(db: SqliteDatabase, id: string, included: boolean): void {
  const result = db
    .prepare(`UPDATE sitemaps SET included = ? WHERE id = ?`)
    .run(included ? 1 : 0, assertId(id))
  if (result.changes !== 1) throw new StorageError('That sitemap was not found')
}

export interface SitemapReadOutcome {
  kind: SitemapKind
  state: SitemapReadState
  lastReadAt: string | null
  lastChangedAt: string | null
  pageCount: number
  error: string | null
}

export function recordSitemapRead(
  db: SqliteDatabase,
  id: string,
  outcome: SitemapReadOutcome
): void {
  const result = db
    .prepare(
      `UPDATE sitemaps SET kind = ?, state = ?, last_read = COALESCE(?, last_read),
         last_changed = COALESCE(?, last_changed), page_count = ?, error = ?
       WHERE id = ?`
    )
    .run(
      outcome.kind,
      outcome.state,
      outcome.lastReadAt === null ? null : requireUtcTimestamp(outcome.lastReadAt),
      outcome.lastChangedAt === null ? null : outcome.lastChangedAt.slice(0, 40),
      Math.max(0, Math.trunc(outcome.pageCount)),
      outcome.error === null ? null : outcome.error.slice(0, 300),
      assertId(id)
    )
  if (result.changes !== 1) throw new StorageError('That sitemap was not found')
}

/** Removes a sitemap and the child sitemaps it listed. Their entries are kept until the next sync. */
export function deleteSitemap(db: SqliteDatabase, id: string): void {
  const target = assertId(id)
  db.transaction(() => {
    db.prepare(`DELETE FROM sitemaps WHERE parent_id = ?`).run(target)
    db.prepare(`DELETE FROM sitemaps WHERE id = ?`).run(target)
  })()
}

// ---------- settings ----------

export interface SitemapSettings {
  rules: SitemapSyncRules
  lastSyncAt: string | null
}

export function readSitemapSettings(db: SqliteDatabase): SitemapSettings {
  const row = db
    .prepare<unknown[], SettingsSql>(
      `SELECT frequency, on_new, on_removed, on_changed, last_sync_at FROM sitemap_settings WHERE id = 1`
    )
    .get()
  if (row === undefined) return { rules: { ...DEFAULT_SITEMAP_SYNC_RULES }, lastSyncAt: null }
  if (
    !isSitemapSyncFrequency(row.frequency) ||
    !isSitemapNewPageRule(row.on_new) ||
    !isSitemapRemovedPageRule(row.on_removed) ||
    !isSitemapChangedPageRule(row.on_changed)
  ) {
    throw new StorageError('Invalid sitemap settings')
  }
  return {
    rules: {
      frequency: row.frequency,
      onNew: row.on_new,
      onRemoved: row.on_removed,
      onChanged: row.on_changed
    },
    lastSyncAt: row.last_sync_at
  }
}

export function writeSitemapRules(db: SqliteDatabase, rules: SitemapSyncRules): void {
  const current = readSitemapSettings(db)
  db.prepare(
    `INSERT INTO sitemap_settings (id, frequency, on_new, on_removed, on_changed, last_sync_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET frequency = excluded.frequency, on_new = excluded.on_new,
       on_removed = excluded.on_removed, on_changed = excluded.on_changed`
  ).run(rules.frequency, rules.onNew, rules.onRemoved, rules.onChanged, current.lastSyncAt)
}

export function writeLastSyncAt(db: SqliteDatabase, at: string): void {
  const current = readSitemapSettings(db)
  const rules = current.rules
  db.prepare(
    `INSERT INTO sitemap_settings (id, frequency, on_new, on_removed, on_changed, last_sync_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_sync_at = excluded.last_sync_at`
  ).run(rules.frequency, rules.onNew, rules.onRemoved, rules.onChanged, requireUtcTimestamp(at))
}

// ---------- entries ----------

export interface SitemapEntry {
  url: string
  sitemapId: string
  pageId: string | null
  lastmod: string | null
  firstSeenAt: string
  lastSeenAt: string
  removedAt: string | null
}

export function listSitemapEntries(db: SqliteDatabase): SitemapEntry[] {
  return db
    .prepare<unknown[], EntrySql>(
      `SELECT url, sitemap_id, page_id, lastmod, first_seen_at, last_seen_at, removed_at
       FROM sitemap_entries`
    )
    .all()
    .map(entryFromSql)
}

/** Insert or replace entries in one statement each. Run inside the caller's transaction. */
export function upsertSitemapEntries(db: SqliteDatabase, entries: readonly SitemapEntry[]): void {
  const statement = db.prepare(
    `INSERT INTO sitemap_entries (url, sitemap_id, page_id, lastmod, first_seen_at, last_seen_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET sitemap_id = excluded.sitemap_id, page_id = excluded.page_id,
       lastmod = excluded.lastmod, last_seen_at = excluded.last_seen_at, removed_at = excluded.removed_at`
  )
  for (const entry of entries) {
    statement.run(
      requireUrl(entry.url),
      entry.sitemapId,
      entry.pageId,
      entry.lastmod === null ? null : entry.lastmod.slice(0, 40),
      entry.firstSeenAt,
      entry.lastSeenAt,
      entry.removedAt
    )
  }
}

/** `lastmod` and first-seen time per page id, for memberships and the import preview. */
export function sitemapFactsByPage(
  db: SqliteDatabase
): Map<string, { lastmod: string | null; firstSeenAt: string; sitemapId: string }> {
  const rows = db
    .prepare<
      unknown[],
      { page_id: string; lastmod: string | null; first_seen_at: string; sitemap_id: string }
    >(
      `SELECT page_id, lastmod, first_seen_at, sitemap_id FROM sitemap_entries
       WHERE page_id IS NOT NULL AND removed_at IS NULL`
    )
    .all()
  return new Map(
    rows.map((row) => [
      row.page_id,
      { lastmod: row.lastmod, firstSeenAt: row.first_seen_at, sitemapId: row.sitemap_id }
    ])
  )
}

// ---------- sync reports ----------

export function insertSyncReport(db: SqliteDatabase, report: SitemapSyncReport): void {
  db.prepare(
    `INSERT INTO sitemap_syncs (id, trigger, started_at, finished_at, status, new_count,
       removed_count, changed_count, report_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assertId(report.id),
    report.trigger,
    requireUtcTimestamp(report.startedAt),
    requireUtcTimestamp(report.finishedAt),
    report.status,
    report.newCount,
    report.removedCount,
    report.changedCount,
    JSON.stringify(report)
  )
  db.prepare(
    `DELETE FROM sitemap_syncs WHERE id NOT IN (
       SELECT id FROM sitemap_syncs ORDER BY started_at DESC, rowid DESC LIMIT ?
     )`
  ).run(KEPT_SYNC_REPORTS)
}

export function latestSyncReport(db: SqliteDatabase): SitemapSyncReport | null {
  const row = db
    .prepare<unknown[], { report_json: string }>(
      `SELECT report_json FROM sitemap_syncs ORDER BY started_at DESC, rowid DESC LIMIT 1`
    )
    .get()
  if (row === undefined) return null
  const parsed = readJson(row.report_json, 'sync report')
  if (!isReport(parsed)) throw new StorageError('Invalid sync report')
  return parsed
}

function isReport(value: unknown): value is SitemapSyncReport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.startedAt === 'string' &&
    Array.isArray(record.newPages) &&
    Array.isArray(record.removedPages) &&
    Array.isArray(record.changedPages)
  )
}

// ---------- SQL rows ----------

const SITEMAP_SELECT = `SELECT id, url, parent_id, kind, source, included, state, last_read,
  last_changed, page_count, error FROM sitemaps`

interface SitemapSql {
  id: string
  url: string
  parent_id: string | null
  kind: string
  source: string
  included: number
  state: string
  last_read: string | null
  last_changed: string | null
  page_count: number
  error: string | null
}

interface SettingsSql {
  frequency: string
  on_new: string
  on_removed: string
  on_changed: string
  last_sync_at: string | null
}

interface EntrySql {
  url: string
  sitemap_id: string
  page_id: string | null
  lastmod: string | null
  first_seen_at: string
  last_seen_at: string
  removed_at: string | null
}

function sitemapFromSql(row: SitemapSql): SitemapRecord {
  if (!isSitemapKind(row.kind) || !isSitemapSource(row.source) || !isSitemapReadState(row.state)) {
    throw new StorageError('Invalid sitemap row')
  }
  return {
    id: row.id,
    url: row.url,
    parentId: row.parent_id,
    kind: row.kind,
    source: row.source,
    included: row.included === 1,
    state: row.state,
    lastReadAt: row.last_read,
    lastChangedAt: row.last_changed,
    pageCount: row.page_count,
    error: row.error,
    lowValue: isLowValueSitemap(row.url)
  }
}

function entryFromSql(row: EntrySql): SitemapEntry {
  return {
    url: row.url,
    sitemapId: row.sitemap_id,
    pageId: row.page_id,
    lastmod: row.lastmod,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    removedAt: row.removed_at
  }
}

function requireUrl(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new StorageError('Invalid sitemap URL')
  }
  if (!value.startsWith('https://') && !value.startsWith('http://')) {
    throw new StorageError('Invalid sitemap URL')
  }
  return value
}
