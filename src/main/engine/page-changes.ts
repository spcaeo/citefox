import type {
  PageChange,
  PageChangeList,
  PageDiffResult,
  PageReadDates,
  PageVersion,
  PageVersionList,
  PageVersionStamp
} from '@shared/ipc'
import { diffBlocks, diffSentence, fixTextFor } from '@shared/page-diff'
import { snapshotBlocks } from '../pipeline/page-history'
import type { StoredSnapshot } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import {
  getPageChange,
  latestPageReads,
  listFixLiveDates,
  listPageChanges,
  listPageVersions,
  type FixLiveRow,
  type PageChangeRow
} from '../storage/page-history'
import { getStoredPage } from '../storage/pages'
import { getStoredSnapshot } from '../storage/snapshot-records'

/**
 * `pageChanges:*`: the changes CiteFox saw on a project's pages, each page's
 * versions, and a block diff of two versions. Built from stored reads only.
 */

/** A fix this close to a change (either side) is taken to be that change. */
export const LINK_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

interface PageInfo {
  url: string
  label: string | null
}

/** The project's changes, newest first, with every page's latest stated dates. */
export function listProjectPageChanges(
  db: SqliteDatabase,
  projectId: string,
  builtAt: string
): PageChangeList {
  const fixes = listFixLiveDates(db)
  const pages = pageLookup(db)
  const changes = listPageChanges(db, null).flatMap((row) => {
    const page = pages(row.pageId)
    return page === null ? [] : [toPageChange(row, page, fixes)]
  })
  const dates: PageReadDates[] = latestPageReads(db).map((read) => ({
    pageId: read.pageId,
    publishedAt: read.publishedAt,
    modifiedAt: read.modifiedAt,
    readAt: read.readAt
  }))
  return { projectId, builtAt, changes, dates }
}

/** Each page's latest stated dates and its count of changes nobody logged, for the Pages grid. */
export function pageHistoryByPage(
  db: SqliteDatabase
): Map<
  string,
  { publishedAt: string | null; modifiedAt: string | null; readAt: string | null; unlogged: number }
> {
  const out = new Map<
    string,
    {
      publishedAt: string | null
      modifiedAt: string | null
      readAt: string | null
      unlogged: number
    }
  >()
  for (const read of latestPageReads(db)) {
    out.set(read.pageId, {
      publishedAt: read.publishedAt,
      modifiedAt: read.modifiedAt,
      readAt: read.readAt,
      unlogged: 0
    })
  }
  const fixes = listFixLiveDates(db)
  const pages = pageLookup(db)
  for (const row of listPageChanges(db, null)) {
    const pageUrl = pages(row.pageId)?.url ?? null
    if (row.dismissedAt !== null || linkedFix(row, fixes, pageUrl) !== null) continue
    const entry = out.get(row.pageId) ?? {
      publishedAt: null,
      modifiedAt: null,
      readAt: null,
      unlogged: 0
    }
    entry.unlogged += 1
    out.set(row.pageId, entry)
  }
  return out
}

/** One change, as the list shows it. Null when it or its page is gone. */
export function readPageChange(db: SqliteDatabase, changeId: string): PageChange | null {
  const row = getPageChange(db, changeId)
  if (row === null) return null
  const page = pageLookup(db)(row.pageId)
  return page === null ? null : toPageChange(row, page, listFixLiveDates(db))
}

/** The page's versions, newest first, each with what changed since the one before. */
export function listVersions(db: SqliteDatabase, pageId: string): PageVersionList {
  const page = pageLookup(db)(pageId)
  const rows = listPageVersions(db, pageId)
  const fixes = listFixLiveDates(db)
  const changes = new Map(listPageChanges(db, pageId).map((row) => [row.toSnapshotId, row]))
  const snapshots = new Map<string, StoredSnapshot | null>()
  const snapshotOf = (id: string): StoredSnapshot | null => {
    if (!snapshots.has(id)) snapshots.set(id, getStoredSnapshot(db, id))
    return snapshots.get(id) ?? null
  }
  const versions = rows.flatMap((row, index): PageVersion[] => {
    const snapshot = snapshotOf(row.snapshotId)
    if (snapshot === null) return []
    const older = rows[index + 1]
    const olderSnapshot = older ? snapshotOf(older.snapshotId) : null
    const counts =
      olderSnapshot === null
        ? null
        : diffBlocks(snapshotBlocks(olderSnapshot), snapshotBlocks(snapshot)).counts
    const change = changes.get(row.snapshotId)
    return [
      {
        snapshotId: row.snapshotId,
        firstReadAt: row.firstReadAt,
        lastReadAt: row.lastReadAt,
        reads: row.reads,
        publishedAt: row.publishedAt,
        modifiedAt: row.modifiedAt,
        wordCount: snapshot.wordCount,
        previousSnapshotId: olderSnapshot === null ? null : olderSnapshot.id,
        counts,
        sentence: counts === null ? null : diffSentence(counts),
        change: change && page ? toPageChange(change, page, fixes) : null
      }
    ]
  })
  return { pageId, url: page?.url ?? '', versions }
}

/** Two versions of one page, block by block. Null when either is not this page's. */
export function diffVersions(
  db: SqliteDatabase,
  pageId: string,
  fromSnapshotId: string,
  toSnapshotId: string
): PageDiffResult | null {
  const from = getStoredSnapshot(db, fromSnapshotId)
  const to = getStoredSnapshot(db, toSnapshotId)
  if (from === null || to === null || from.pageId !== pageId || to.pageId !== pageId) return null
  const diff = diffBlocks(snapshotBlocks(from), snapshotBlocks(to))
  const versions = new Map(listPageVersions(db, pageId).map((row) => [row.snapshotId, row]))
  return {
    pageId,
    url: pageLookup(db)(pageId)?.url ?? '',
    from: stamp(from, versions.get(from.id)),
    to: stamp(to, versions.get(to.id)),
    items: diff.items,
    counts: diff.counts,
    sentence: diffSentence(diff.counts),
    fixText: fixTextFor(diff)
  }
}

/** The fix whose go-live is nearest the change, within `LINK_DAYS` either side. */
export function linkedFix(
  change: Pick<PageChangeRow, 'pageId' | 'changedAt' | 'detectedAt'>,
  fixes: readonly FixLiveRow[],
  pageUrl: string | null = null
): FixLiveRow | null {
  const at = Date.parse(change.changedAt)
  const seen = Date.parse(change.detectedAt)
  const address = pageUrl === null ? null : urlKey(pageUrl)
  let best: { fix: FixLiveRow; gap: number } | null = null
  for (const fix of fixes) {
    const samePage =
      fix.pageId === change.pageId ||
      (address !== null && fix.url !== null && urlKey(fix.url) === address)
    if (!samePage) continue
    const live = Date.parse(fix.liveOn)
    if (Number.isNaN(live)) continue
    // Live between the change and the read that saw it counts too.
    const gap =
      live >= at && live <= seen ? 0 : Math.min(Math.abs(live - at), Math.abs(live - seen))
    if (gap > LINK_DAYS * DAY_MS) continue
    if (best === null || gap < best.gap) best = { fix, gap }
  }
  return best?.fix ?? null
}

export function toPageChange(
  row: PageChangeRow,
  page: PageInfo,
  fixes: readonly FixLiveRow[]
): PageChange {
  const fix = row.dismissedAt === null ? linkedFix(row, fixes, page.url) : null
  return {
    id: row.id,
    pageId: row.pageId,
    url: page.url,
    label: page.label,
    detectedAt: row.detectedAt,
    changedAt: row.changedAt,
    modifiedAt: row.modifiedAt,
    previousModifiedAt: row.previousModifiedAt,
    fromSnapshotId: row.fromSnapshotId,
    toSnapshotId: row.toSnapshotId,
    counts: row.counts,
    sentence: diffSentence(row.counts),
    sections: row.sections,
    state: row.dismissedAt !== null ? 'dismissed' : fix !== null ? 'linked' : 'open',
    fixId: fix?.id ?? null,
    fixNumber: fix?.number ?? null,
    dismissedAt: row.dismissedAt
  }
}

function stamp(
  snapshot: StoredSnapshot,
  version: { lastReadAt: string; modifiedAt: string | null } | undefined
): PageVersionStamp {
  return {
    snapshotId: snapshot.id,
    readAt: version?.lastReadAt ?? snapshot.fetchedAt,
    modifiedAt: version?.modifiedAt ?? snapshot.modifiedAt,
    wordCount: snapshot.wordCount
  }
}

/** One address however it is written: no scheme, no `www.`, no trailing slash, lower case. */
function urlKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

/** Pages by id (cached): their URL and the name the app shows. Topics have no URL and are skipped. */
function pageLookup(db: SqliteDatabase): (pageId: string) => PageInfo | null {
  const cache = new Map<string, PageInfo | null>()
  return (pageId) => {
    if (!cache.has(pageId)) {
      const page = getStoredPage(db, pageId)
      cache.set(
        pageId,
        page === null || page.url === null
          ? null
          : { url: page.url, label: page.label ?? page.title ?? null }
      )
    }
    return cache.get(pageId) ?? null
  }
}
