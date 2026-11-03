import type { PageChange, PageChangeList, PageReadDates } from '@shared/ipc'
import type { BlockDiffItem } from '@shared/page-diff'
import { FROM_PAGE_CHANGE, newFixValues } from '../fixes/drawer/model'
import { pathOf } from '../fixes/model'
import { todayInput } from '../progress/model'
import type { DrawerParamPatch } from '../shell/drawerUrl'
import type { ChartEvent } from '../ui'
import { formatDay, formatMoment } from '../utils/dates'

/**
 * Page change history in the renderer, pure: the Pages banner's words, the fix a
 * change is logged as, the dashed "?" chart markers, the diff drawer's URL and
 * the Pages grid's "Updated" buckets.
 */

/** Days after which a page counts as "Not updated in 12 months". */
export const STALE_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

/** Changes nobody logged as a fix or marked "Not a fix", newest first. */
export function openChanges(list: Pick<PageChangeList, 'changes'> | null): PageChange[] {
  return (list?.changes ?? [])
    .filter((change) => change.state === 'open')
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))
}

export function changePath(change: Pick<PageChange, 'url'>): string {
  return pathOf(change.url)
}

/** "Oct 28, 12:00 PM": when the change went live, in the computer's own zone and clock. */
export function changeDay(change: Pick<PageChange, 'changedAt'>): string {
  return formatMoment(change.changedAt)
}

/**
 * The banner's question: "/blog/att… changed on Oct 28." then "The page says
 * "Updated Oct 28". 2 sections are new and 1 heading changed. Is this a fix?"
 */
export function bannerText(change: PageChange): { lead: string; detail: string } {
  const said = change.modifiedAt
    ? `The page says "Updated ${formatDay(change.modifiedAt, { year: false })}". `
    : ''
  return {
    lead: `${changePath(change)} changed on ${changeDay(change)}.`,
    detail: `${said}${change.sentence} Is this a fix?`
  }
}

/** The go-live day a change is logged with, `yyyy-mm-dd` in local time. */
export function liveDay(change: Pick<PageChange, 'changedAt'>): string {
  return todayInput(new Date(change.changedAt))
}

/** A short fix description: what changed and where. */
export function fixText(change: Pick<PageChange, 'sentence' | 'sections'>): string {
  return change.sections.length === 0
    ? change.sentence
    : `${change.sentence} Changed: ${change.sections.join(', ')}.`
}

/** "Log as fix, live Oct 28": the fix drawer, prefilled with the page, the day and the text. */
export function logFixValues(change: PageChange, text?: string): DrawerParamPatch {
  return newFixValues({
    pageId: change.pageId,
    text: text ?? fixText(change),
    liveOn: liveDay(change),
    from: FROM_PAGE_CHANGE
  })
}

/** "See what changed" for a noticed change. */
export function changeDrawerValues(change: Pick<PageChange, 'id'>): DrawerParamPatch {
  return { 'pc.id': change.id }
}

/** "See what changed" for two versions of a page. */
export function versionDrawerValues(
  pageId: string,
  fromSnapshotId: string,
  toSnapshotId: string
): DrawerParamPatch {
  return { 'pc.page': pageId, 'pc.from': fromSnapshotId, 'pc.to': toSnapshotId }
}

/** The change a version diff stands for, when CiteFox noticed one. */
export function changeForVersions(
  list: Pick<PageChangeList, 'changes'> | null,
  pageId: string | null,
  toSnapshotId: string | null
): PageChange | null {
  if (pageId === null || toSnapshotId === null) return null
  return (
    list?.changes.find(
      (change) => change.pageId === pageId && change.toSnapshotId === toSnapshotId
    ) ?? null
  )
}

const EVENT_PREFIX = 'page:'

/**
 * Changes nobody logged as dashed "?" markers (`pageIds` null: every page).
 * Logged ones show as their fix's marker; "Not a fix" ones are left out.
 */
export function pageChangeEvents(
  changes: readonly PageChange[],
  pageIds: ReadonlySet<string> | null
): ChartEvent[] {
  return changes
    .filter((change) => change.state === 'open')
    .filter((change) => pageIds === null || pageIds.has(change.pageId))
    .map((change) => ({
      id: `${EVENT_PREFIX}${change.id}`,
      kind: 'page' as const,
      at: change.changedAt,
      title: `${changePath(change)} changed`,
      line: change.sentence
    }))
}

/** The change id behind a dashed "?" marker, else null. */
export function changeIdOfEvent(event: Pick<ChartEvent, 'id' | 'kind'>): string | null {
  return event.kind === 'page' && event.id.startsWith(EVENT_PREFIX)
    ? event.id.slice(EVENT_PREFIX.length)
    : null
}

/** "Updated" facet of the Pages grid. */
export type UpdatedBucket = 'recent' | 'stale' | 'none'

export function updatedBucket(modifiedAt: string | null | undefined, now: Date): UpdatedBucket {
  if (!modifiedAt) return 'none'
  const at = Date.parse(modifiedAt)
  if (Number.isNaN(at)) return 'none'
  return now.getTime() - at > STALE_DAYS * DAY_MS ? 'stale' : 'recent'
}

export const UPDATED_LABEL: Readonly<Record<UpdatedBucket, string>> = {
  recent: 'Updated in the last 12 months',
  stale: 'Not updated in 12 months',
  none: 'No date on the page'
}

/**
 * The page's latest stated dates, shown under a change only when it is the page's
 * newest change (an older change would sit next to dates it never saw).
 */
export function datesForChange(
  list: Pick<PageChangeList, 'dates' | 'changes'> | null,
  change: Pick<PageChange, 'id' | 'pageId' | 'detectedAt'>
): PageReadDates | null {
  const newer = list?.changes.some(
    (other) =>
      other.pageId === change.pageId &&
      other.id !== change.id &&
      Date.parse(other.detectedAt) > Date.parse(change.detectedAt)
  )
  return newer ? null : datesFor(list, change.pageId)
}

/** The dates a page states, from the list. */
export function datesFor(
  list: Pick<PageChangeList, 'dates'> | null,
  pageId: string
): PageReadDates | null {
  return list?.dates.find((item) => item.pageId === pageId) ?? null
}

/** A run of unchanged blocks this long folds into one line in "changes only". */
export const FOLD_AT = 3

export type DiffRow =
  { kind: 'item'; item: BlockDiffItem } | { kind: 'fold'; count: number; section: string | null }

/**
 * The diff with long unchanged runs folded: one unchanged block stays on each
 * side of a change, and headings always stay so every change keeps its place.
 */
export function foldDiff(items: readonly BlockDiffItem[], all: boolean): DiffRow[] {
  if (all) return items.map((item) => ({ kind: 'item', item }))
  const near = new Set<number>()
  items.forEach((item, index) => {
    if (item.op === 'same') return
    near.add(index - 1)
    near.add(index)
    near.add(index + 1)
  })
  const rows: DiffRow[] = []
  let run: BlockDiffItem[] = []
  const flush = (): void => {
    if (run.length >= FOLD_AT) {
      rows.push({ kind: 'fold', count: run.length, section: run[0]?.section ?? null })
    } else rows.push(...run.map((item): DiffRow => ({ kind: 'item', item })))
    run = []
  }
  items.forEach((item, index) => {
    const keep = near.has(index) || (item.op === 'same' && /^h[1-4]$/.test(item.kind))
    if (keep) {
      flush()
      rows.push({ kind: 'item', item })
    } else run.push(item)
  })
  flush()
  return rows
}
