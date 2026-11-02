import type { GoogleUpdate } from '@shared/google-updates'
import { formatDay } from '../../utils/dates'
import { DAY_MS, dayStartIso, localDayKey } from './scale'

/**
 * Markers under every trend chart, Ahrefs style: a filled number is a fix you
 * logged, a "G" ring a Google update, a dashed "?" ring a change seen on your page
 * that nobody logged, a small grey "±" a change to what CiteFox tracks (questions,
 * engines, markets, schedule), so a jump it causes is not taken for a fix. Events on
 * one local day stack into one circle with a count.
 */

/**
 * The page-change feed: `page` events are the changes CiteFox saw between two reads
 * of a page that nobody logged as a fix or marked "Not a fix" (`pageChanges:list`,
 * src/renderer/src/pageChanges/model.ts `pageChangeEvents`, `usePageChangeEvents`).
 * Their pinned card's "See what changed" opens the diff drawer, which asks "Is this
 * a fix?" (`openChartEvent`).
 */
export type MarkerKind = 'fix' | 'google' | 'page' | 'tracking'

export const MARKER_KINDS: readonly MarkerKind[] = ['fix', 'google', 'page', 'tracking']

/** Who made the change, as the hover card's first line says it. */
export const MARKER_WHO: Readonly<Record<MarkerKind, string>> = {
  fix: 'Your fix',
  google: 'Google',
  page: 'Seen on your page',
  tracking: 'Tracking changed'
}

/** The toggle chip above the chart. */
export const MARKER_CHIP: Readonly<Record<MarkerKind, string>> = {
  fix: 'Your fixes',
  google: 'Google updates',
  page: 'Page changed, not logged',
  tracking: 'Tracking changes'
}

/** The face of each kind's marker (and of its toggle chip). */
export const MARKER_FACE: Readonly<Record<Exclude<MarkerKind, 'fix'>, string>> = {
  google: 'G',
  page: '?',
  tracking: '±'
}

/** Days CiteFox measures a fix after it goes live (the light band after its marker). */
export const MEASURE_DAYS = 14

export type VerdictTone = 'good' | 'bad' | 'wait'

export interface ChartEvent {
  id: string
  kind: MarkerKind
  /** ISO moment the marker sits at (a Google update: the local day it started). */
  at: string
  /** "Fix 2 · Added a comparison table", "March 2026 core update". */
  title: string
  /** One plain line on what changed. */
  line: string
  /** A fix's number on its page: the digit in its circle. */
  number?: number
  /** Opens the fix drawer. */
  fixId?: string
  /** "1 of 8 → 5 of 8". */
  beforeNow?: string
  verdict?: string
  verdictTone?: VerdictTone
  /** Learn more (Google's page). */
  url?: string
  /** A Google update's rollout: the local days it started and finished (null while it still runs). */
  span?: { from: string; to: string | null }
  /** A fix that goes live later: no measuring band yet. */
  planned?: boolean
}

export interface MarkerStack {
  /** The local day, `yyyy-mm-dd`. */
  key: string
  at: string
  /** Fixes first, then Google, then page changes. */
  events: readonly ChartEvent[]
  /** One kind, or `mixed` when kinds share the day. */
  kind: MarkerKind | 'mixed'
  /** What the circle shows: the fix number, G, ?, or the count. */
  label: string
  /** Accessible name. */
  name: string
}

const KIND_ORDER: Readonly<Record<MarkerKind, number>> = { fix: 0, google: 1, page: 2, tracking: 3 }

/** Groups events by local day, oldest day first. */
export function stackMarkers(events: readonly ChartEvent[]): MarkerStack[] {
  const byDay = new Map<string, ChartEvent[]>()
  for (const event of events) {
    const key = localDayKey(event.at)
    const list = byDay.get(key) ?? []
    list.push(event)
    byDay.set(key, list)
  }
  return [...byDay.entries()]
    .map(([key, list]) => buildStack(key, list))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function buildStack(key: string, list: readonly ChartEvent[]): MarkerStack {
  const sorted = [...list].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.number ?? 0) - (b.number ?? 0)
  )
  const first = sorted[0] as ChartEvent
  const kinds = new Set(sorted.map((event) => event.kind))
  const kind: MarkerStack['kind'] = kinds.size === 1 ? first.kind : 'mixed'
  const days = [
    ...new Set(sorted.map((event) => event.at).sort((a, b) => Date.parse(a) - Date.parse(b)))
  ]
  const firstDay = formatDay(days[0] ?? first.at, { year: false })
  const lastDay = formatDay(days[days.length - 1] ?? first.at, { year: false })
  const day = firstDay === lastDay ? firstDay : `${firstDay} to ${lastDay}`
  const name =
    sorted.length === 1
      ? `${day}, ${MARKER_WHO[first.kind]}: ${first.title}`
      : `${day}, ${sorted.length} events: ${sorted.map((event) => event.title).join('; ')}`
  const at = firstDay === lastDay ? first.at : (days[0] ?? first.at)
  return { key, at, events: sorted, kind, label: stackLabel(sorted), name }
}

/** Smallest gap between two marker centres: a 24px touch target each (WCAG 2.5.8). */
export const MARKER_MIN_GAP = 24

/**
 * Stacks placed closer than `minGap` pixels (days next to each other on a long
 * chart) join into one marker at the first one's place, so no circle covers its
 * neighbour and each stays a full-size target. Input sorted by `x`.
 */
export function joinCrowded<T extends { stack: MarkerStack; x: number }>(
  placed: readonly T[],
  minGap = MARKER_MIN_GAP
): T[] {
  const groups: T[][] = []
  for (const item of placed) {
    const group = groups[groups.length - 1]
    const anchor = group?.[0]
    if (group && anchor && item.x - anchor.x < minGap) group.push(item)
    else groups.push([item])
  }
  return groups.map((group) => {
    const anchor = group[0] as T
    if (group.length === 1) return anchor
    const key = group.map((item) => item.stack.key).join('+')
    const stack = buildStack(
      key,
      group.flatMap((item) => item.stack.events)
    )
    return { ...anchor, stack }
  })
}

function stackLabel(events: readonly ChartEvent[]): string {
  const first = events[0]
  if (!first) return ''
  if (events.length > 1) return String(events.length)
  if (first.kind === 'fix') return first.number === undefined ? '•' : String(first.number)
  return MARKER_FACE[first.kind]
}

/** The only fix in a stack of one: clicking it opens that fix. Null otherwise. */
export function soleFix(stack: MarkerStack): ChartEvent | null {
  const only = stack.events.length === 1 ? stack.events[0] : undefined
  return only && only.kind === 'fix' ? only : null
}

/** A stack a click opens straight away: one fix, or one page change ("See what changed"). */
export function soleOpenable(stack: MarkerStack): ChartEvent | null {
  const only = stack.events.length === 1 ? stack.events[0] : undefined
  return only && (only.kind === 'fix' || only.kind === 'page') ? only : null
}

/** Events the chart shows: kinds not hidden, inside `[t0, t1]` (a day's slack each side). */
export function visibleEvents(
  events: readonly ChartEvent[],
  hidden: ReadonlySet<MarkerKind>,
  t0: number,
  t1: number
): ChartEvent[] {
  return events.filter((event) => {
    if (hidden.has(event.kind)) return false
    const at = Date.parse(event.at)
    return !Number.isNaN(at) && at >= t0 - DAY_MS && at <= t1 + DAY_MS
  })
}

/** The 14-day measuring window after each live fix, cut at `limit`. */
export function measuringBands(
  events: readonly ChartEvent[],
  limit: number,
  days = MEASURE_DAYS
): { id: string; from: number; to: number }[] {
  return events.flatMap((event) => {
    if (event.kind !== 'fix' || event.planned) return []
    const from = Date.parse(event.at)
    if (Number.isNaN(from) || from > limit) return []
    return [{ id: event.id, from, to: Math.min(from + days * DAY_MS, limit) }]
  })
}

/**
 * Google updates as chart events. An update that started before `t0` but was still
 * rolling out then sits at `t0`, so a chart that starts mid-rollout still shows it.
 */
export function googleEvents(
  updates: readonly GoogleUpdate[],
  t0: number,
  t1: number
): ChartEvent[] {
  return updates.flatMap((update) => {
    const start = Date.parse(dayStartIso(update.startedOn))
    const end = update.finishedOn ? Date.parse(dayStartIso(update.finishedOn)) : t1
    if (Number.isNaN(start) || start > t1 + DAY_MS || end < t0 - DAY_MS) return []
    const at = start < t0 ? new Date(t0).toISOString() : dayStartIso(update.startedOn)
    return [
      {
        id: `google:${update.id}`,
        kind: 'google' as const,
        at,
        title: update.name,
        line: update.description,
        url: update.url,
        span: {
          from: dayStartIso(update.startedOn),
          to: update.finishedOn ? dayStartIso(update.finishedOn) : null
        }
      }
    ]
  })
}

/**
 * The light band behind each Google update while it rolled out (AI answers often
 * shift during the rollout, not on day one), cut to `[t0, t1]`.
 */
export function rolloutBands(
  events: readonly ChartEvent[],
  t0: number,
  t1: number
): { id: string; from: number; to: number }[] {
  return events.flatMap((event) => {
    if (!event.span) return []
    const from = Math.max(Date.parse(event.span.from), t0)
    const to = Math.min(event.span.to ? Date.parse(event.span.to) + DAY_MS : t1, t1)
    return Number.isNaN(from) || to <= from ? [] : [{ id: event.id, from, to }]
  })
}

/** The card's date: "Oct 29", or a rollout's "Mar 27 – Apr 8" / "Since Oct 2". */
export function eventDay(event: Pick<ChartEvent, 'at' | 'span'>): string {
  const span = event.span
  if (!span) return formatDay(event.at, { year: false })
  const from = formatDay(span.from, { year: false })
  if (!span.to) return `Since ${from}`
  return span.to === span.from ? from : `${from} – ${formatDay(span.to, { year: false })}`
}

/** "Finished Apr 8, 2026." or "Still rolling out." */
export function finishedText(span: NonNullable<ChartEvent['span']>): string {
  return span.to ? `Finished ${formatDay(span.to)}.` : 'Still rolling out.'
}

/** The `marks.hide` URL list, read as kinds. Unknown names are dropped. */
export function hiddenKinds(items: readonly string[]): Set<MarkerKind> {
  return new Set(
    items.filter((item): item is MarkerKind => MARKER_KINDS.includes(item as MarkerKind))
  )
}
