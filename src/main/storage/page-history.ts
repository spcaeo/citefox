import type { BlockDiffCounts } from '@shared/page-diff'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireOptionalLabel, requireUtcTimestamp } from './values'

/**
 * `page_reads` and `page_changes` in a project database (project migration 054,
 * src/main/storage/project-schema-page-history.ts): every read of a tracked page
 * with the dates it stated, and the changes seen between two reads.
 */

/** Versions (distinct snapshots) each page keeps the reads of. */
export const PAGE_VERSIONS_KEPT = 24
/** Reads each page keeps at most, oldest dropped first. */
export const PAGE_READS_KEPT = 400

export interface PageReadRow {
  pageId: string
  snapshotId: string
  readAt: string
  publishedAt: string | null
  modifiedAt: string | null
}

export interface PageVersionRow {
  snapshotId: string
  firstReadAt: string
  lastReadAt: string
  reads: number
  /** The dates of the newest read of this version. */
  publishedAt: string | null
  modifiedAt: string | null
}

export interface PageChangeRow {
  id: string
  pageId: string
  fromSnapshotId: string
  toSnapshotId: string
  detectedAt: string
  changedAt: string
  modifiedAt: string | null
  previousModifiedAt: string | null
  counts: BlockDiffCounts
  sections: readonly string[]
  dismissedAt: string | null
}

interface ReadSql {
  page_id: string
  snapshot_id: string
  read_at: string
  published_at: string | null
  modified_at: string | null
}

interface ChangeSql {
  id: string
  page_id: string
  from_snapshot_id: string
  to_snapshot_id: string
  detected_at: string
  changed_at: string
  modified_at: string | null
  previous_modified_at: string | null
  sections_added: number
  sections_removed: number
  headings_changed: number
  text_changed: number
  sections_json: string
  dismissed_at: string | null
}

const SECTIONS_MAX = 8
const SECTION_TEXT_MAX = 200

/** The page's newest read, or null before its first. */
export function latestPageRead(db: SqliteDatabase, pageId: string): PageReadRow | null {
  const row = db
    .prepare<unknown[], ReadSql>(
      `SELECT page_id, snapshot_id, read_at, published_at, modified_at FROM page_reads
       WHERE page_id = ? ORDER BY read_at DESC, id DESC LIMIT 1`
    )
    .get(assertId(pageId))
  return row === undefined ? null : readFromSql(row)
}

/** Every page's newest read. */
export function latestPageReads(db: SqliteDatabase): PageReadRow[] {
  return db
    .prepare<unknown[], ReadSql>(
      `SELECT page_id, snapshot_id, read_at, published_at, modified_at FROM page_reads AS r
       WHERE r.id = (
         SELECT id FROM page_reads WHERE page_id = r.page_id ORDER BY read_at DESC, id DESC LIMIT 1
       )`
    )
    .all()
    .map(readFromSql)
}

export function insertPageRead(db: SqliteDatabase, read: PageReadRow): void {
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO page_reads (page_id, snapshot_id, read_at, published_at, modified_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          assertId(read.pageId),
          assertId(read.snapshotId),
          requireUtcTimestamp(read.readAt),
          requireOptionalLabel(read.publishedAt, 'published date', 40),
          requireOptionalLabel(read.modifiedAt, 'modified date', 40)
        ),
    'Save the page read'
  )
}

/**
 * Keeps the reads of the page's newest `PAGE_VERSIONS_KEPT` versions, and at most
 * `PAGE_READS_KEPT` reads. Changes stay: they name their snapshots.
 */
export function prunePageReads(db: SqliteDatabase, pageId: string): void {
  const id = assertId(pageId)
  db.prepare(
    `DELETE FROM page_reads WHERE page_id = ? AND snapshot_id NOT IN (
       SELECT snapshot_id FROM page_reads WHERE page_id = ?
       GROUP BY snapshot_id ORDER BY MAX(read_at) DESC LIMIT ?
     )`
  ).run(id, id, PAGE_VERSIONS_KEPT)
  db.prepare(
    `DELETE FROM page_reads WHERE page_id = ? AND id NOT IN (
       SELECT id FROM page_reads WHERE page_id = ? ORDER BY read_at DESC, id DESC LIMIT ?
     )`
  ).run(id, id, PAGE_READS_KEPT)
}

/** The page's versions, newest first: one row per snapshot it was read as. */
export function listPageVersions(db: SqliteDatabase, pageId: string): PageVersionRow[] {
  const rows = db
    .prepare<
      unknown[],
      {
        snapshot_id: string
        first_read_at: string
        last_read_at: string
        reads: number
        published_at: string | null
        modified_at: string | null
      }
    >(
      `SELECT r.snapshot_id, MIN(r.read_at) AS first_read_at, MAX(r.read_at) AS last_read_at,
              COUNT(*) AS reads,
              (SELECT published_at FROM page_reads WHERE page_id = r.page_id
                 AND snapshot_id = r.snapshot_id ORDER BY read_at DESC, id DESC LIMIT 1) AS published_at,
              (SELECT modified_at FROM page_reads WHERE page_id = r.page_id
                 AND snapshot_id = r.snapshot_id ORDER BY read_at DESC, id DESC LIMIT 1) AS modified_at
       FROM page_reads AS r WHERE r.page_id = ?
       GROUP BY r.snapshot_id ORDER BY MAX(r.read_at) DESC`
    )
    .all(assertId(pageId))
  return rows.map((row) => ({
    snapshotId: row.snapshot_id,
    firstReadAt: row.first_read_at,
    lastReadAt: row.last_read_at,
    reads: row.reads,
    publishedAt: row.published_at,
    modifiedAt: row.modified_at
  }))
}

export function insertPageChange(db: SqliteDatabase, change: PageChangeRow): void {
  const sections = change.sections
    .slice(0, SECTIONS_MAX)
    .map((section) => section.replace(/\s+/g, ' ').trim().slice(0, SECTION_TEXT_MAX))
    .filter((section) => section.length > 0)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO page_changes (
             id, page_id, from_snapshot_id, to_snapshot_id, detected_at, changed_at, modified_at,
             previous_modified_at, sections_added, sections_removed, headings_changed, text_changed,
             sections_json, dismissed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (page_id, to_snapshot_id) DO NOTHING`
        )
        .run(
          assertId(change.id),
          assertId(change.pageId),
          assertId(change.fromSnapshotId),
          assertId(change.toSnapshotId),
          requireUtcTimestamp(change.detectedAt),
          requireUtcTimestamp(change.changedAt),
          requireOptionalLabel(change.modifiedAt, 'modified date', 40),
          requireOptionalLabel(change.previousModifiedAt, 'modified date', 40),
          count(change.counts.sectionsAdded),
          count(change.counts.sectionsRemoved),
          count(change.counts.headingsChanged),
          count(change.counts.textChanged),
          JSON.stringify(sections),
          change.dismissedAt === null ? null : requireUtcTimestamp(change.dismissedAt)
        ),
    'Save the page change'
  )
}

const CHANGE_SELECT = `SELECT id, page_id, from_snapshot_id, to_snapshot_id, detected_at, changed_at,
  modified_at, previous_modified_at, sections_added, sections_removed, headings_changed,
  text_changed, sections_json, dismissed_at FROM page_changes`

/** Changes newest first: one page's, or the whole project's (`pageId` null), at most `limit`. */
export function listPageChanges(
  db: SqliteDatabase,
  pageId: string | null,
  limit = 500
): PageChangeRow[] {
  const rows =
    pageId === null
      ? db
          .prepare<unknown[], ChangeSql>(`${CHANGE_SELECT} ORDER BY changed_at DESC, id LIMIT ?`)
          .all(limit)
      : db
          .prepare<unknown[], ChangeSql>(
            `${CHANGE_SELECT} WHERE page_id = ? ORDER BY changed_at DESC, id LIMIT ?`
          )
          .all(assertId(pageId), limit)
  return rows.map(changeFromSql)
}

export function getPageChange(db: SqliteDatabase, changeId: string): PageChangeRow | null {
  const row = db
    .prepare<unknown[], ChangeSql>(`${CHANGE_SELECT} WHERE id = ?`)
    .get(assertId(changeId))
  return row === undefined ? null : changeFromSql(row)
}

/** "Not a fix" (`at`), or Undo (`null`). */
export function setPageChangeDismissed(
  db: SqliteDatabase,
  changeId: string,
  at: string | null
): void {
  const result = db
    .prepare(`UPDATE page_changes SET dismissed_at = ? WHERE id = ?`)
    .run(at === null ? null : requireUtcTimestamp(at), assertId(changeId))
  if (result.changes !== 1) throw new StorageError('That page change is not in this project')
}

/** A fix's page, number and go-live, for linking changes. */
export interface FixLiveRow {
  id: string
  pageId: string
  /** The page address a fix on a topic (or an untracked page) is about. */
  url: string | null
  number: number
  liveOn: string
}

export function listFixLiveDates(db: SqliteDatabase): FixLiveRow[] {
  return db
    .prepare<
      unknown[],
      { id: string; page_id: string; url: string | null; number: number; live_on: string }
    >(`SELECT id, page_id, url, number, live_on FROM fixes`)
    .all()
    .map((row) => ({
      id: row.id,
      pageId: row.page_id,
      url: row.url,
      number: row.number,
      liveOn: row.live_on
    }))
}

function readFromSql(row: ReadSql): PageReadRow {
  return {
    pageId: row.page_id,
    snapshotId: row.snapshot_id,
    readAt: row.read_at,
    publishedAt: row.published_at,
    modifiedAt: row.modified_at
  }
}

function changeFromSql(row: ChangeSql): PageChangeRow {
  let sections: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.sections_json)
    if (Array.isArray(parsed)) {
      sections = parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // An unreadable list reads as none.
  }
  return {
    id: row.id,
    pageId: row.page_id,
    fromSnapshotId: row.from_snapshot_id,
    toSnapshotId: row.to_snapshot_id,
    detectedAt: row.detected_at,
    changedAt: row.changed_at,
    modifiedAt: row.modified_at,
    previousModifiedAt: row.previous_modified_at,
    counts: {
      sectionsAdded: row.sections_added,
      sectionsRemoved: row.sections_removed,
      headingsChanged: row.headings_changed,
      textChanged: row.text_changed
    },
    sections,
    dismissedAt: row.dismissed_at
  }
}

function count(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new StorageError('Invalid change count')
  return value
}
