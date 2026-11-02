import { segmentValue } from '../../metrics/breakdowns'
import { countOf, isAnswered, isNamedRow, rateOf } from '../../metrics/counts'
import type { MetricCount, MetricRow, MetricsResult, SegmentDimension } from '../../metrics/types'
import type { NamedSegment, NamedView, SplitRow } from './changed-types'
import type { SectionInput } from './sections'
import type { Kpi, Num, ReviewLens, Tile } from './types'
import { REVIEW_LENSES } from './types'

/**
 * Brand named (Docs/REPORT-SPEC.md "What changed"): answers whose text names the brand,
 * the second headline of every report. The helpers here are pure and reusable; each
 * share is named ÷ AI answers shown at that end, over the compared questions when two
 * checks are compared, else over every question of the latest check.
 */

/** Named and answered at both ends. Ids are `to` row ids, so lists line up. */
export interface NamedEnds {
  before: MetricCount | null
  now: MetricCount
  answeredBefore: number | null
  answeredNow: number
  shareBefore: number | null
  shareNow: number | null
}

export function namedEnds(metrics: MetricsResult): NamedEnds {
  const c = metrics.comparison
  if (c === null) {
    return {
      before: null,
      now: metrics.now.named,
      answeredBefore: null,
      answeredNow: metrics.now.answered.n,
      shareBefore: null,
      shareNow: rateOf(metrics.now.named.n, metrics.now.answered.n)
    }
  }
  return {
    before: c.movement.namedBefore,
    now: c.movement.namedAfter,
    answeredBefore: c.before.answered.n,
    answeredNow: c.after.answered.n,
    shareBefore: rateOf(c.movement.namedBefore.n, c.before.answered.n),
    shareNow: rateOf(c.movement.namedAfter.n, c.after.answered.n)
  }
}

/** Compared questions named now and not before, and the reverse. `to` row ids. */
export function namedMovement(metrics: MetricsResult): {
  newly: MetricCount
  noLonger: MetricCount
} {
  const c = metrics.comparison
  if (c === null) return { newly: countOf([]), noLonger: countOf([]) }
  const before = new Set(c.movement.namedBefore.ids)
  const after = new Set(c.movement.namedAfter.ids)
  return {
    newly: countOf(c.movement.namedAfter.ids.filter((id) => !before.has(id))),
    noLonger: countOf(c.movement.namedBefore.ids.filter((id) => !after.has(id)))
  }
}

/**
 * Market vs your work for any before → after count: the market part is the change in AI
 * answers at the old share, in tenths; your work takes the rest so both add up exactly.
 * The same rule as `decompose` (src/shared/metrics/counts.ts).
 */
export function splitTenths(
  before: number,
  after: number,
  answeredBefore: number,
  answeredAfter: number
): { marketTenths: number; workTenths: number } {
  const rate = rateOf(before, answeredBefore)
  const raw = rate === null ? 0 : (answeredAfter - answeredBefore) * rate
  const marketTenths = Math.round(raw * 10) || 0
  return { marketTenths, workTenths: (after - before) * 10 - marketTenths }
}

/** The `to` row of each compared question with its `from` row, or every `to` row alone. */
export function endRows(metrics: MetricsResult): { to: MetricRow; from: MetricRow | null }[] {
  const c = metrics.comparison
  const ids = c === null ? metrics.now.checked.ids : c.compared.ids
  return ids.flatMap((id) => {
    const to = metrics.rows[id]
    if (to === undefined) return []
    const fromId = c === null ? undefined : metrics.fromOf[id]
    const from = fromId === undefined ? null : (metrics.rows[fromId] ?? null)
    return [{ to, from }]
  })
}

export interface NamedSegmentCounts {
  value: string
  namedBefore: string[] | null
  namedNow: string[]
  answeredBefore: number | null
  answeredNow: number
}

/** Named and answered per value of one lens. Values match the Topics table's rows. */
export function namedBySegment(
  metrics: MetricsResult,
  lens: SegmentDimension
): Map<string, NamedSegmentCounts> {
  const comparing = metrics.comparison !== null
  const out = new Map<string, NamedSegmentCounts>()
  for (const { to, from } of endRows(metrics)) {
    const value = segmentValue(to, lens)
    const entry = out.get(value) ?? {
      value,
      namedBefore: comparing ? [] : null,
      namedNow: [],
      answeredBefore: comparing ? 0 : null,
      answeredNow: 0
    }
    if (isAnswered(to)) entry.answeredNow += 1
    if (isNamedRow(to)) entry.namedNow.push(to.id)
    if (from !== null && entry.answeredBefore !== null && entry.namedBefore !== null) {
      if (isAnswered(from)) entry.answeredBefore += 1
      if (isNamedRow(from)) entry.namedBefore.push(to.id)
    }
    out.set(value, entry)
  }
  return out
}

/** Percentage points, one decimal: 0.4 → 0.45 is 5. Null when either share is unknown. */
export function pointsChange(before: number | null, now: number | null): number | null {
  if (before === null || now === null) return null
  return Math.round((now - before) * 1000) / 10
}

/** 0.4 → "40%"; null → "—". Whole percent, as the Topics table shows shares. */
export function sharePercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** "+5 pts", "−2.5 pts", "0 pts"; null → "—". */
export function pointsText(points: number | null): string {
  if (points === null) return '—'
  const abs = Math.abs(points)
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  return points > 0 ? `+${text} pts` : points < 0 ? `−${text} pts` : '0 pts'
}

/** The "Brand named" KPI tile: count now (before), with the share of answers as its note. */
export function namedKpi(view: NamedView, comparing: boolean): Kpi {
  const now = view.now.n
  const before = view.before?.n ?? null
  return {
    label: 'Brand named',
    now: now.toLocaleString('en-US'),
    before: comparing && before !== null ? before.toLocaleString('en-US') : null,
    trend:
      !comparing || before === null ? null : now > before ? 'up' : now < before ? 'down' : 'flat',
    drill: view.now.drill,
    note: comparing
      ? `${sharePercent(view.shareBefore)} → ${sharePercent(view.shareNow)} of AI answers`
      : `${sharePercent(view.shareNow)} of AI answers`
  }
}

export function namedView(input: SectionInput): NamedView {
  const { metrics, book, ctx, fromLabel, toLabel } = input
  const comparing = metrics.comparison !== null
  const ends = namedEnds(metrics)
  const q = (id: string, title: string, ids: readonly string[], sub?: string): Num =>
    book.add(id, { title, kind: 'questions', ids, ...(sub ? { sub } : {}) })
  const at = (label: string | null): string => (label === null ? '' : `, ${label}`)
  const now = q(`named:a`, `${ctx.brand} named in the answer${at(toLabel)}`, ends.now.ids)
  const before =
    ends.before === null
      ? null
      : q(`named:b`, `${ctx.brand} named in the answer${at(fromLabel)}`, ends.before.ids)
  const move = namedMovement(metrics)
  const newly = q(
    'named:new',
    `Newly named: ${ctx.brand} named now, not before`,
    move.newly.ids,
    'The answer names your brand now and did not before.'
  )
  const noLonger = q(
    'named:gone',
    `No longer named: ${ctx.brand} named before, not now`,
    move.noLonger.ids,
    'The answer named your brand before and does not now.'
  )
  const tiles: Tile[] = comparing
    ? [
        {
          label: 'Newly named',
          value: `+${newly.n}`,
          drill: newly.drill,
          tone: 'ok'
        },
        {
          label: 'No longer named',
          value: noLonger.n > 0 ? `−${noLonger.n}` : '0',
          drill: noLonger.drill,
          tone: 'warn'
        }
      ]
    : []
  const splitRows: SplitRow[] = []
  const c = metrics.comparison
  if (c !== null && before !== null) {
    const citeB = q(
      'cite:b',
      `Questions citing your pages${at(fromLabel)}`,
      input.toIds(c.before.cited.ids)
    )
    const citeA = q('cite:a', `Questions citing your pages${at(toLabel)}`, c.after.cited.ids)
    const row = (
      key: SplitRow['key'],
      label: string,
      b: typeof citeB,
      a: typeof citeA
    ): SplitRow => {
      const parts = splitTenths(b.n, a.n, c.before.answered.n, c.after.answered.n)
      return {
        key,
        label,
        before: b,
        after: a,
        change: a.n - b.n,
        ...parts,
        shareBefore: rateOf(b.n, c.before.answered.n),
        shareAfter: rateOf(a.n, c.after.answered.n)
      }
    }
    splitRows.push(row('cited', 'Citing your pages', citeB, citeA))
    splitRows.push(row('named', 'Brand named', before, now))
  }
  const lenses = {} as Record<ReviewLens, Record<string, NamedSegment>>
  for (const lens of REVIEW_LENSES) {
    const out: Record<string, NamedSegment> = {}
    for (const entry of namedBySegment(metrics, lens).values()) {
      const key = `named:seg:${lens}:${entry.value}`
      const shareNow = rateOf(entry.namedNow.length, entry.answeredNow)
      const shareBefore =
        entry.namedBefore === null || entry.answeredBefore === null
          ? null
          : rateOf(entry.namedBefore.length, entry.answeredBefore)
      out[entry.value] = {
        now: q(`${key}:a`, `${entry.value}: ${ctx.brand} named${at(toLabel)}`, entry.namedNow),
        before:
          entry.namedBefore === null
            ? null
            : q(
                `${key}:b`,
                `${entry.value}: ${ctx.brand} named${at(fromLabel)}`,
                entry.namedBefore
              ),
        shareBefore,
        shareNow,
        change: pointsChange(shareBefore, shareNow)
      }
    }
    lenses[lens] = out
  }
  return {
    now,
    before,
    shareNow: ends.shareNow,
    shareBefore: ends.shareBefore,
    newly,
    noLonger,
    tiles,
    splitRows,
    lenses
  }
}
