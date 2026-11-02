import {
  DAY_BUCKETS,
  dayBucket,
  inNextRound,
  OWNER_LABEL_MAX,
  type DayBucketId,
  type LoopStep
} from '@shared/fix-loop'
import type { ChangeLedger, ChangeRow, IndexCheckPreview, LoopSchedule } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { indexBucket, latestRows, rowFacts, type IndexBucket } from '../../changes/model'
import { formatDay } from '../../utils/dates'
import { backlinkRows } from '../backlinks/model'

/** The next round: the five steps, their counts, and the index check. Pure. */

export const STEP_COPY: Record<LoopStep, { name: string; line: string }> = {
  measure: { name: 'Measure', line: 'CiteFox checks every tracked page' },
  reoptimise: { name: 'Re-optimise', line: 'Fresh content for each page not cited yet' },
  publish: { name: 'Publish', line: 'The new version goes live' },
  index: { name: 'Get indexed', line: 'Google has to find the page first' },
  backlinks: { name: 'Build backlinks', line: 'Links from other sites to the page' }
}

/** The pages each step counts. Measure counts tracked pages, which the ledger does not list. */
export interface RoundCounts {
  measure: number
  reoptimise: readonly ChangeRow[]
  publish: readonly ChangeRow[]
  index: readonly ChangeRow[]
  backlinks: readonly ChangeRow[]
}

/** Changes live since the last full check, or going live later: the next check measures them. */
export function unmeasuredRows(ledger: Pick<ChangeLedger, 'rows' | 'schedule'>): ChangeRow[] {
  const last = ledger.schedule.lastCheckAt === null ? null : Date.parse(ledger.schedule.lastCheckAt)
  return ledger.rows.filter((row) => {
    if (row.daysLive !== null && row.daysLive < 0) return true
    if (last === null || Number.isNaN(last)) return true
    return Date.parse(row.liveSince) > last
  })
}

/** Latest-on-page pages that go into the next round (not cited yet, or lost ground). */
export function roundRows(ledger: Pick<ChangeLedger, 'rows'>): ChangeRow[] {
  return latestRows(ledger).filter((row) => inNextRound(rowFacts(row)))
}

/** Latest-on-page pages Google has not shown as indexed (not indexed, or never checked). */
export function needsIndexRows(ledger: Pick<ChangeLedger, 'rows'>): ChangeRow[] {
  return latestRows(ledger).filter((row) => indexBucket(row) !== 'indexed')
}

export function tooNewRows(ledger: Pick<ChangeLedger, 'rows'>): ChangeRow[] {
  return latestRows(ledger).filter((row) => row.status === 'too_new')
}

export function notIndexedRows(ledger: Pick<ChangeLedger, 'rows'>): ChangeRow[] {
  return latestRows(ledger).filter((row) => indexBucket(row) === 'not_indexed')
}

export function roundCounts(ledger: ChangeLedger): RoundCounts {
  return {
    measure: ledger.trackedPages,
    reoptimise: roundRows(ledger),
    publish: unmeasuredRows(ledger),
    index: needsIndexRows(ledger),
    backlinks: backlinkRows(ledger).map((item) => item.row)
  }
}

/** "Next measurement on Nov 2, then every 14 days." */
export function scheduleLine(schedule: LoopSchedule): string {
  if (schedule.paused) return 'Paused: no check runs until you resume the schedule.'
  if (schedule.nextCheckAt === null) return 'No check is scheduled.'
  return `Next measurement on ${formatDay(schedule.nextCheckAt, { year: false })}, then every ${pluralize(schedule.intervalDays, 'day')}.`
}

/** An owner label as saved: trimmed and cut to the limit. Empty resets to the default. */
export function cleanOwner(label: string): string {
  return label.trim().slice(0, OWNER_LABEL_MAX)
}

/* ---- Google index ---- */

/** The pages "Check index" checks: each changed page once, once it is live. */
export function indexPageIds(ledger: Pick<ChangeLedger, 'rows'>): string[] {
  return latestRows(ledger)
    .filter((row) => row.daysLive === null || row.daysLive >= 0)
    .map((row) => row.pageId)
}

/** "Checks 4 pages with a Google site: search. Uses 4–8 searches; 52 left this month." */
export function previewLine(preview: IndexCheckPreview): string {
  const pages = `Checks ${pluralize(preview.pages, 'page')} with a Google site: search.`
  const uses =
    preview.searchesMin === preview.searchesMax
      ? `Uses ${pluralize(preview.searchesMin, 'search', 'searches')}`
      : `Uses ${preview.searchesMin}–${preview.searchesMax} searches`
  const left = preview.left === null ? '' : `; ${preview.left} left this month`
  return `${pages} ${uses}${left}.`
}

export interface IndexBucketRow {
  id: DayBucketId
  label: string
  rows: readonly ChangeRow[]
  byIndex: Readonly<Record<IndexBucket, readonly ChangeRow[]>>
}

/** Changed pages by days live, split by what Google shows. */
export function indexByDays(ledger: Pick<ChangeLedger, 'rows'>): IndexBucketRow[] {
  const live = latestRows(ledger)
  return DAY_BUCKETS.map((bucket) => {
    const rows = live.filter((row) => dayBucket(row.daysLive) === bucket.id)
    return {
      id: bucket.id,
      label: bucket.label,
      rows,
      byIndex: {
        indexed: rows.filter((row) => indexBucket(row) === 'indexed'),
        not_indexed: rows.filter((row) => indexBucket(row) === 'not_indexed'),
        not_checked: rows.filter((row) => indexBucket(row) === 'not_checked')
      }
    }
  })
}
