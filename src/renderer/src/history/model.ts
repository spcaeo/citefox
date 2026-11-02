import type { ContentDiff, DiffLine, HistoryEvent, HistoryEventKind } from '@shared/domain'
import { pluralize, pluralWord } from '@shared/pluralize'
import { formatDay, formatMoment } from '../utils/dates'
import type { SortDir, SortSpec } from '../utils/sort'

/** History view-model (FR-15.1–15.3). Pure: no React, no IPC. */

export type KindFilter = 'all' | HistoryEventKind

export const KIND_FILTERS: readonly { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'check', label: 'Checks' },
  { id: 'content', label: 'Content changes' },
  { id: 'note', label: 'Notes' },
  { id: 'fix', label: 'Fixes' },
  { id: 'prompt_set', label: 'Question sets' }
]

export type HistoryView = 'timeline' | 'table'

export type HistorySortKey = 'date' | 'type' | 'score'

export type HistorySort = SortSpec<HistorySortKey>

/** The table opens newest first, like the timeline. */
export const DEFAULT_SORT: readonly HistorySort[] = [{ key: 'date', dir: 'desc' }]

export function kindLabel(kind: KindFilter): string {
  return KIND_FILTERS.find((item) => item.id === kind)?.label ?? 'All'
}

export function inKind(event: HistoryEvent, kind: KindFilter): boolean {
  return kind === 'all' || event.kinds.includes(kind)
}

export function kindCounts(events: readonly HistoryEvent[]): Record<KindFilter, number> {
  const counts = { all: 0, check: 0, content: 0, note: 0, fix: 0, prompt_set: 0 }
  for (const item of KIND_FILTERS) {
    counts[item.id] = events.filter((event) => inKind(event, item.id)).length
  }
  return counts
}

export function filterByKind(events: readonly HistoryEvent[], kind: KindFilter): HistoryEvent[] {
  return events.filter((event) => inKind(event, kind))
}

function byNewest(left: HistoryEvent, right: HistoryEvent): number {
  if (left.at !== right.at) return left.at < right.at ? 1 : -1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** Timeline order: newest first, always. */
export function newestFirst(events: readonly HistoryEvent[]): HistoryEvent[] {
  return [...events].sort(byNewest)
}

/** The Type column. A check whose content changed is still a check. */
export function typeLabel(event: HistoryEvent): string {
  switch (event.primary) {
    case 'check':
      return 'Check'
    case 'content':
      return 'Content change'
    case 'note':
      return 'Note'
    case 'fix':
      return 'Fix'
    case 'prompt_set':
      return 'Question set'
  }
}

const FIRST_DIR: Record<HistorySortKey, SortDir> = { date: 'desc', type: 'asc', score: 'desc' }

/**
 * Header click on the History table. A plain click sorts by that column alone and
 * cycles its natural direction, the other one, then off. Shift adds or cycles a
 * further sort (the mock's Shift-click second sort).
 */
export function cycleHistorySort(
  current: readonly HistorySort[],
  key: HistorySortKey,
  additive: boolean
): HistorySort[] {
  const index = current.findIndex((item) => item.key === key)
  const first = FIRST_DIR[key]
  const second: SortDir = first === 'asc' ? 'desc' : 'asc'
  const dir = index < 0 ? null : (current[index]?.dir ?? null)
  const nextDir = dir === null ? first : dir === first ? second : null
  if (additive) {
    const next = current.slice()
    if (index < 0) next.push({ key, dir: first })
    else if (nextDir) next[index] = { key, dir: nextDir }
    else next.splice(index, 1)
    return next
  }
  if (index >= 0 && current.length > 1) {
    return [{ key, dir: dir === 'asc' ? 'desc' : 'asc' }]
  }
  return nextDir ? [{ key, dir: nextDir }] : []
}

function sortValue(event: HistoryEvent, key: HistorySortKey): string | number | null {
  if (key === 'date') return event.at
  if (key === 'type') return typeLabel(event).toLowerCase()
  return event.check?.score ?? null
}

/** Multi-sort. Blank scores go last in either direction. Ties fall back to newest first. */
export function sortEvents(
  events: readonly HistoryEvent[],
  sorts: readonly HistorySort[]
): HistoryEvent[] {
  return [...events].sort((left, right) => {
    for (const sort of sorts) {
      const a = sortValue(left, sort.key)
      const b = sortValue(right, sort.key)
      if (a === null && b === null) continue
      if (a === null) return 1
      if (b === null) return -1
      const compared =
        typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
      if (compared !== 0) return sort.dir === 'desc' ? -compared : compared
    }
    return byNewest(left, right)
  })
}

export function scoreText(score: number | null): string {
  return score === null ? 'No score' : `Score ${score}`
}

/** "+12", "−3" (minus sign), "0", or an em dash when there is no previous check. */
export function changeText(change: number | null): string {
  if (change === null) return '—'
  if (change > 0) return `+${change}`
  if (change < 0) return `−${Math.abs(change)}`
  return '0'
}

export function changeTone(change: number | null): 'up' | 'down' | 'flat' {
  if (change === null || change === 0) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/** "All 7 events · newest first", "2 events of 7 · Notes". The table has its own sort. */
export function statusLine(
  kind: KindFilter,
  shown: number,
  total: number,
  view: HistoryView
): string {
  const head =
    kind === 'all'
      ? `All ${pluralize(total, 'event')}`
      : `${shown} ${pluralWord(shown, 'event')} of ${total} · ${kindLabel(kind)}`
  return view === 'timeline' ? `${head} · newest first` : head
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date written YYYY-MM-DD. */
export function isValidNoteDate(value: string): boolean {
  const match = DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The local calendar day, YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Noon local time on a YYYY-MM-DD date, as ISO, so it formats as that day everywhere. */
export function noteDateIso(date: string): string {
  const match = DATE.exec(date)
  if (!match) return date
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12).toISOString()
}

/**
 * When it happened: "Oct 19, 3:12 PM" in the computer's own clock, with the year
 * when it is not this year. Notes show the date the user picked: "Oct 19".
 */
export function eventDay(event: HistoryEvent, now: Date = new Date()): string {
  if (!event.note) return formatMoment(event.at, { now })
  const iso = noteDateIso(event.note.date)
  const year = new Date(iso).getFullYear()
  return formatDay(iso, { year: year !== now.getFullYear() })
}

/** For a tooltip, always with the year: "Oct 19, 2026, 3:12 PM"; a note's day, "Oct 19, 2026". */
export function fullDay(event: HistoryEvent): string {
  // A "now" in another year makes formatMoment write the year.
  if (!event.note) return formatMoment(event.at, { now: new Date(0) })
  return formatDay(noteDateIso(event.note.date))
}

export type DiffItem = { kind: 'line'; line: DiffLine } | { kind: 'fold'; count: number }

/**
 * Folds runs of unchanged lines, keeping `context` lines next to each change.
 * A diff with no change folds into one item.
 */
export function collapseDiff(lines: readonly DiffLine[], context = 2): DiffItem[] {
  const items: DiffItem[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line) break
    if (line.op !== 'same') {
      items.push({ kind: 'line', line })
      index += 1
      continue
    }
    let end = index
    while (end < lines.length && lines[end]?.op === 'same') end += 1
    const run = lines.slice(index, end)
    const leading = index === 0
    const trailing = end === lines.length
    if (leading && trailing) {
      items.push({ kind: 'fold', count: run.length })
    } else {
      const keepStart = leading ? 0 : context
      const keepEnd = trailing ? 0 : context
      const hidden = run.length - keepStart - keepEnd
      if (hidden < 2) {
        for (const kept of run) items.push({ kind: 'line', line: kept })
      } else {
        for (const kept of run.slice(0, keepStart)) items.push({ kind: 'line', line: kept })
        items.push({ kind: 'fold', count: hidden })
        for (const kept of run.slice(run.length - keepEnd)) {
          items.push({ kind: 'line', line: kept })
        }
      }
    }
    index = end
  }
  return items
}

export function foldText(count: number): string {
  return `… ${pluralize(count, 'unchanged line')}`
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** The grid's group: the event's local month, "2026-10" / "October 2026". Notes use their date. */
export function eventMonth(event: HistoryEvent): { key: string; label: string } {
  const date = new Date(event.note ? noteDateIso(event.note.date) : event.at)
  if (Number.isNaN(date.getTime())) return { key: '0000-00', label: 'Undated' }
  const month = date.getMonth()
  return {
    key: `${date.getFullYear()}-${pad(month + 1)}`,
    label: `${MONTHS[month] ?? ''} ${date.getFullYear()}`
  }
}

/** Month keys newest first, for the grid's group order. */
export function monthsNewestFirst(events: readonly HistoryEvent[]): string[] {
  return [...new Set(events.map((event) => eventMonth(event).key))].sort().reverse()
}

/** What the grid's search matches: title, detail, note text and the type. */
export function eventSearchText(event: HistoryEvent): string {
  return [event.title, event.detail ?? '', event.note?.text ?? '', typeLabel(event)]
    .join(' ')
    .toLowerCase()
}

/** Changed lines across the fields, outline, FAQs and body. */
export function changeCount(diff: ContentDiff): number {
  const lines = [...diff.outline, ...diff.faqs, ...diff.body].filter((line) => line.op !== 'same')
  return lines.length + diff.fields.filter((field) => field.changed).length
}

/** An event title as plain text (a crumb, a dialog name): markdown marks dropped. */
export function plainTitle(title: string): string {
  return title
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The ISO time an event sits at on the timeline (a note: noon on its picked day). */
export function eventIso(event: HistoryEvent): string {
  return event.note ? noteDateIso(event.note.date) : event.at
}

/**
 * The check just before and just after `iso` (not `exceptId`), for the
 * "Checks before and after" rail of an event or a new note.
 */
export function nearbyChecks(
  events: readonly HistoryEvent[],
  iso: string,
  exceptId: string | null = null
): { before: HistoryEvent | null; after: HistoryEvent | null } {
  const checks = events
    .filter((event) => event.check !== null && event.id !== exceptId)
    .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
  const before = checks.filter((event) => event.at <= iso).at(-1) ?? null
  const after = checks.find((event) => event.at > iso) ?? null
  return { before, after }
}

/** What the note part of the event drawer is doing (`he.note` on the URL). */
export type EventNoteMode = 'view' | 'edit' | 'delete'

export function eventNoteMode(value: string | undefined): EventNoteMode {
  return value === 'edit' || value === 'delete' ? value : 'view'
}
