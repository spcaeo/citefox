import type { FixKind, PromptCheckRow } from '@shared/domain'
import {
  DAY_BUCKETS,
  dayBucket,
  isCited,
  type ChangeStatus,
  type DayBucketId,
  type LoopFacts
} from '@shared/fix-loop'
import type { ChangeCheck, ChangeLedger, ChangeRow } from '@shared/ipc'
import { pathOf } from '../fixes/model'
import { formatDay, formatMoment } from '../utils/dates'

/**
 * The Changes ledger, read the same way everywhere on the Fixes screen. Pure.
 * Counts are never sent by main: each one counts `before.rows` or `now.rows`
 * here, so a number always equals the drill it opens (NFR-14).
 */

/** The cited questions of a check. Empty when there is no check. */
export function citedRows(check: ChangeCheck | null): PromptCheckRow[] {
  return check ? check.rows.filter(isCited) : []
}

/** Cited questions where the page is the first source listed. */
export function topSpotRows(check: ChangeCheck | null): PromptCheckRow[] {
  return citedRows(check).filter((row) => row.position === 1)
}

/** The cited questions' mean position, to one decimal. Null when nothing is cited. */
export function averagePosition(check: ChangeCheck | null): number | null {
  const positions = citedRows(check)
    .map((row) => row.position)
    .filter((value): value is number => value !== null)
  if (positions.length === 0) return null
  const mean = positions.reduce((sum, value) => sum + value, 0) / positions.length
  return Math.round(mean * 10) / 10
}

/** "2.3", or "—" when nothing is cited. */
export function averageLabel(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

/** Where the page stands in Google from its last "Check index". */
export type IndexBucket = 'indexed' | 'not_indexed' | 'not_checked'

/** A failed check (`unknown`) reads as not checked; its message stays in the tooltip. */
export function indexBucket(row: Pick<ChangeRow, 'index'>): IndexBucket {
  if (row.index?.state === 'indexed') return 'indexed'
  if (row.index?.state === 'not_indexed') return 'not_indexed'
  return 'not_checked'
}

export const INDEX_LABELS: Record<IndexBucket, string> = {
  indexed: 'Indexed',
  not_indexed: 'Not indexed',
  not_checked: 'Not checked'
}

/** The pill's tooltip: when it was checked, or why the check could not tell. */
export function indexTitle(row: Pick<ChangeRow, 'index'>): string {
  const check = row.index
  if (!check) return 'Not checked with Google yet'
  const when = `Checked ${formatMoment(check.checkedAt)}`
  return check.message ? `${when}: ${check.message}` : when
}

/** What the loop rules in `src/shared/fix-loop.ts` read from a row. */
export function rowFacts(row: ChangeRow): LoopFacts {
  return { status: row.status, daysLive: row.daysLive, index: row.index?.state ?? null }
}

/** The newest change on each page: pages count once in the chart and the round. */
export function latestRows(ledger: Pick<ChangeLedger, 'rows'>): ChangeRow[] {
  return ledger.rows.filter((row) => row.latestOnPage)
}

/** The page's name: its label or title, else its path. */
export function pageName(row: Pick<ChangeRow, 'title' | 'url'>): string {
  return row.title ?? pathOf(row.url)
}

/** "Updated Oct 15 on the page", "Published Oct 2 on the page", or null. */
export function pageDateLine(row: Pick<ChangeRow, 'pageDates'>): string | null {
  const dates = row.pageDates
  if (!dates) return null
  if (dates.modifiedAt) return `Updated ${formatDay(dates.modifiedAt, { year: false })} on the page`
  if (dates.publishedAt) {
    return `Published ${formatDay(dates.publishedAt, { year: false })} on the page`
  }
  return null
}

/** "12 days", "1 day", "Goes live in 2 days", or "—". */
export function daysLabel(days: number | null): string {
  if (days === null) return '—'
  if (days < 0) return `Goes live in ${-days} ${-days === 1 ? 'day' : 'days'}`
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/* ---- Ledger filter (`?show=`) ---- */

export type ShowFilter =
  'all' | ChangeStatus | 'not_indexed' | 'kind:new_page' | 'kind:rewrite' | 'kind:fix'

export const SHOW_FILTERS: readonly { id: ShowFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cited', label: 'Cited now' },
  { id: 'not_cited', label: 'Not cited yet' },
  { id: 'too_new', label: 'Too new' },
  { id: 'lost', label: 'Lost ground' },
  { id: 'not_indexed', label: 'Not indexed' },
  { id: 'kind:new_page', label: 'New pages' },
  { id: 'kind:rewrite', label: 'Rewrites' },
  { id: 'kind:fix', label: 'Fixes' }
]

export function isShowFilter(value: string | null): value is ShowFilter {
  return SHOW_FILTERS.some((item) => item.id === value)
}

export function matchesShow(row: ChangeRow, show: ShowFilter): boolean {
  if (show === 'all') return true
  if (show === 'not_indexed') return indexBucket(row) === 'not_indexed'
  if (show.startsWith('kind:')) return row.kind === (show.slice(5) as FixKind)
  return row.status === show
}

export function filterRows(rows: readonly ChangeRow[], show: ShowFilter): ChangeRow[] {
  return rows.filter((row) => matchesShow(row, show))
}

export function showCounts(rows: readonly ChangeRow[]): Record<ShowFilter, number> {
  const out = {} as Record<ShowFilter, number>
  for (const item of SHOW_FILTERS) out[item.id] = filterRows(rows, item.id).length
  return out
}

/* ---- "How fast changes get cited" ---- */

export interface SpeedBar {
  id: DayBucketId
  label: string
  /** Latest-on-page changes live this long. */
  rows: readonly ChangeRow[]
  /** Those with at least one cited question in their latest check. */
  cited: readonly ChangeRow[]
  /** cited ÷ rows, 0 when the bucket is empty. */
  share: number
}

/** A page counts as cited when its latest check cites it for any question. */
export function isPageCited(row: ChangeRow): boolean {
  return citedRows(row.now).length > 0
}

/** One bar per day bucket, over latest-on-page changes that are live. */
export function speedBars(ledger: Pick<ChangeLedger, 'rows'>): SpeedBar[] {
  const live = latestRows(ledger)
  return DAY_BUCKETS.map((bucket) => {
    const rows = live.filter((row) => dayBucket(row.daysLive) === bucket.id)
    const cited = rows.filter(isPageCited)
    return {
      id: bucket.id,
      label: bucket.label,
      rows,
      cited,
      share: rows.length === 0 ? 0 : cited.length / rows.length
    }
  })
}

/* ---- Change detail ---- */

export interface QuestionMove {
  promptId: string
  promptPosition: number
  text: string
  before: PromptCheckRow | null
  now: PromptCheckRow | null
}

/** Every question of either check, in prompt order, with where it stood before and now. */
export function questionMoves(row: Pick<ChangeRow, 'before' | 'now'>): QuestionMove[] {
  const moves = new Map<string, QuestionMove>()
  for (const item of row.before?.rows ?? []) {
    moves.set(item.promptId, {
      promptId: item.promptId,
      promptPosition: item.promptPosition,
      text: item.text,
      before: item,
      now: null
    })
  }
  for (const item of row.now?.rows ?? []) {
    const found = moves.get(item.promptId)
    if (found) found.now = item
    else {
      moves.set(item.promptId, {
        promptId: item.promptId,
        promptPosition: item.promptPosition,
        text: item.text,
        before: null,
        now: item
      })
    }
  }
  return [...moves.values()].sort((a, b) => a.promptPosition - b.promptPosition)
}

/** The next fix number on a page: one past the highest logged on the ledger. */
export function nextFixNumber(rows: readonly ChangeRow[], pageId: string): number {
  return (
    rows.filter((row) => row.pageId === pageId).reduce((max, row) => Math.max(max, row.number), 0) +
    1
  )
}
