import type { PageBlock } from '@shared/ipc'
import { changedSections, diffBlocks, isTrivial, type BlockDiff } from '@shared/page-diff'
import { randomUUID } from 'node:crypto'
import type { StoredSnapshot } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import {
  insertPageChange,
  insertPageRead,
  latestPageRead,
  prunePageReads,
  type PageChangeRow
} from '../storage/page-history'
import { getStoredSnapshot } from '../storage/snapshot-records'
import { blocksFromMarkdown, blocksFromText } from '../topics/page-blocks'

/**
 * Page change history, fed by every read of a tracked page (`readPage`: page
 * setup, "Read the page again", the background setup runner). Each read is kept
 * with the dates the page stated; when its text differs from the read before by
 * more than noise, a change is saved for "Is this a fix?". No search, no AI.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface PageReadInput {
  pageId: string
  /** The snapshot this read kept: a new one, or the earlier one when the text is the same. */
  snapshot: StoredSnapshot
  /** ISO-8601 UTC. */
  readAt: string
  /** The dates the page stated on this read (they can move while the text stays). */
  publishedAt: string | null
  modifiedAt: string | null
  newId?: () => string
}

/** Saves the read, and the change since the read before when there is one. Returns the change. */
export function recordPageRead(db: SqliteDatabase, input: PageReadInput): PageChangeRow | null {
  return db.transaction((): PageChangeRow | null => {
    const previous = latestPageRead(db, input.pageId)
    insertPageRead(db, {
      pageId: input.pageId,
      snapshotId: input.snapshot.id,
      readAt: input.readAt,
      publishedAt: input.publishedAt,
      modifiedAt: input.modifiedAt
    })
    let change: PageChangeRow | null = null
    if (previous !== null && previous.snapshotId !== input.snapshot.id) {
      const older = getStoredSnapshot(db, previous.snapshotId)
      if (older !== null) {
        const diff = diffBlocks(snapshotBlocks(older), snapshotBlocks(input.snapshot))
        if (!isTrivial(diff)) {
          change = changeRow(input, previous, diff)
          insertPageChange(db, change)
        }
      }
    }
    prunePageReads(db, input.pageId)
    return change
  })()
}

/**
 * A snapshot as blocks: a direct read keeps plain text and its outline; a Reader
 * or file read keeps markdown. Both start at the page's H1 (the menu above it is
 * not the page).
 */
export function snapshotBlocks(snapshot: StoredSnapshot): PageBlock[] {
  return snapshot.method === 'direct'
    ? blocksFromText(snapshot.bodyText, snapshot.outline, snapshot.h1)
    : blocksFromMarkdown(snapshot.bodyText)
}

/**
 * The day the change most likely went live: the page's own new "Updated" date
 * when it moved and falls between the two reads, else the read that saw it.
 */
export function changedAtOf(
  readAt: string,
  previousReadAt: string,
  modifiedAt: string | null,
  previousModifiedAt: string | null
): string {
  if (modifiedAt === null || modifiedAt === previousModifiedAt) return readAt
  const stated = Date.parse(modifiedAt)
  const from = Date.parse(previousReadAt)
  const to = Date.parse(readAt)
  if (Number.isNaN(stated) || stated < from - DAY_MS || stated > to + DAY_MS) return readAt
  return new Date(Math.min(stated, to)).toISOString()
}

function changeRow(
  input: PageReadInput,
  previous: { snapshotId: string; readAt: string; modifiedAt: string | null },
  diff: BlockDiff
): PageChangeRow {
  const moved = input.modifiedAt !== null && input.modifiedAt !== previous.modifiedAt
  return {
    id: input.newId?.() ?? `pc-${randomUUID()}`,
    pageId: input.pageId,
    fromSnapshotId: previous.snapshotId,
    toSnapshotId: input.snapshot.id,
    detectedAt: input.readAt,
    changedAt: changedAtOf(input.readAt, previous.readAt, input.modifiedAt, previous.modifiedAt),
    modifiedAt: moved ? input.modifiedAt : null,
    previousModifiedAt: previous.modifiedAt,
    counts: diff.counts,
    sections: changedSections(diff, 8),
    dismissedAt: null
  }
}
