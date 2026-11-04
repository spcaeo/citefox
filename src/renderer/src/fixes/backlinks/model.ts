import { fixKindLabel } from '@shared/domain'
import {
  backlinkPriority,
  changeStatusLabel,
  needsBacklinks,
  type BacklinkPriority
} from '@shared/fix-loop'
import type { ChangeLedger, ChangeRow, GridCsvRequest } from '@shared/ipc'
import { INDEX_LABELS, indexBucket, latestRows, rowFacts } from '../../changes/model'
import { csvFileName } from '../../grid/model/labels'
import { formatWhen } from '../../utils/dates'
import { pathOf } from '../model'

/** The backlink ask list. Pure. */

export interface BacklinkRow {
  row: ChangeRow
  priority: BacklinkPriority
  /** The cached suggested anchor text. Null until one is written. */
  anchor: string | null
}

export const PRIORITY_LABELS: Record<BacklinkPriority, string> = { first: 'First', next: 'Next' }

/**
 * Latest-on-page pages that need links (not cited yet, lost ground, or not indexed):
 * "First" before "Next", then the longest live first.
 */
export function backlinkRows(ledger: Pick<ChangeLedger, 'rows' | 'anchors'>): BacklinkRow[] {
  const anchors = new Map(ledger.anchors.map((item) => [item.pageId, item.text]))
  return latestRows(ledger)
    .filter((row) => needsBacklinks(rowFacts(row)))
    .map((row) => ({
      row,
      priority: backlinkPriority(rowFacts(row)),
      anchor: anchors.get(row.pageId) ?? null
    }))
    .sort(
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === 'first' ? -1 : 1) ||
        (b.row.daysLive ?? -Infinity) - (a.row.daysLive ?? -Infinity)
    )
}

/** The pages on the list that have no anchor text yet. */
export function missingAnchorIds(rows: readonly BacklinkRow[]): string[] {
  return rows.filter((item) => item.anchor === null).map((item) => item.row.pageId)
}

/** Every address on the list, one per line, for "Copy all URLs". */
export function urlList(rows: readonly BacklinkRow[]): string {
  return rows.map((item) => item.row.url).join('\n')
}

/**
 * Exactly the rows the list shows, in its order. Main writes UTF-8 with a BOM and
 * neutralizes formula text, so cells go as they are.
 */
export function backlinkCsv(
  rows: readonly BacklinkRow[],
  projectName: string,
  now: Date
): GridCsvRequest {
  return {
    fileName: csvFileName(`${projectName}-backlink-ask-list`, now),
    header: [
      'Priority',
      'Page',
      'URL',
      'Suggested anchor text',
      'Kind',
      'Live since',
      'Google index',
      'Status'
    ],
    rows: rows.map(({ row, priority, anchor }) => [
      PRIORITY_LABELS[priority],
      row.title ?? pathOf(row.url),
      row.url,
      anchor ?? '',
      fixKindLabel(row.kind),
      formatWhen(row.liveSince),
      INDEX_LABELS[indexBucket(row)],
      changeStatusLabel(row.status)
    ])
  }
}
