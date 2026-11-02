/**
 * Pure drawing helpers for the shared chart kit (ui/chart): scales, ticks, the
 * smooth line and its area, gaps, and the nearest check to the pointer. No React,
 * no DOM, so every rule here has a unit test.
 */

export type Pt = readonly [number, number]

export const DAY_MS = 86_400_000

/** Maps a domain onto a pixel range. A flat domain maps to the middle of the range. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number]
): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d1 === d0) return () => (r0 + r1) / 2
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)
}

/** Earliest and latest moment of a list of ISO dates. Null when none parses. */
export function timeExtent(isos: readonly string[]): [number, number] | null {
  const times = isos.map((iso) => Date.parse(iso)).filter((t) => !Number.isNaN(t))
  if (times.length === 0) return null
  return [Math.min(...times), Math.max(...times)]
}

/**
 * Percent axis (0–1 rates) that reaches the highest point: 10% steps up to 50%,
 * then 25% steps up to 100%. The same rule the rate chart always used.
 */
export function rateTicks(peak: number): number[] {
  const top = Math.max(0.5, peak)
  const step = top > 0.5 ? 0.25 : 0.1
  const max = Math.min(1, Math.ceil(top / step - 0.001) * step)
  return Array.from({ length: Math.round(max / step) + 1 }, (_, index) =>
    Number((index * step).toFixed(4))
  )
}

/** Whole-number axis from 0 that reaches `peak` in at most `count` even steps. */
export function countTicks(peak: number, count = 4): number[] {
  const top = Math.max(1, Math.ceil(peak))
  const step = Math.max(1, Math.ceil(top / count))
  const ticks: number[] = []
  for (let value = 0; value < top + step; value += step) ticks.push(value)
  return ticks
}

/**
 * A monotone cubic path through the points (no overshoot, so a line never dips
 * below 0% or above the real peak between two checks). Points go left to right.
 */
export function monotonePath(points: readonly Pt[]): string {
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M${fmt(first[0])},${fmt(first[1])}`
  const n = points.length
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i] as Pt
    const b = points[i + 1] as Pt
    const dx = b[0] - a[0]
    slopes.push(dx === 0 ? 0 : (b[1] - a[1]) / dx)
  }
  const tangents: number[] = [slopes[0] ?? 0]
  for (let i = 1; i < n - 1; i += 1) {
    const before = slopes[i - 1] ?? 0
    const after = slopes[i] ?? 0
    tangents.push(before * after <= 0 ? 0 : (before + after) / 2)
  }
  tangents.push(slopes[n - 2] ?? 0)
  // Fritsch–Carlson: cap each segment's end tangents at 3× its own slope. Without it,
  // checks a few minutes apart (a steep slope) next to checks days apart send the
  // curve far past the chart between them.
  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i] ?? 0
    if (slope === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const alpha = (tangents[i] ?? 0) / slope
    const beta = (tangents[i + 1] ?? 0) / slope
    const size = alpha * alpha + beta * beta
    if (size > 9) {
      const tau = 3 / Math.sqrt(size)
      tangents[i] = tau * alpha * slope
      tangents[i + 1] = tau * beta * slope
    }
  }
  let d = `M${fmt(first[0])},${fmt(first[1])}`
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i] as Pt
    const b = points[i + 1] as Pt
    const h = (b[0] - a[0]) / 3
    const c1 = [a[0] + h, a[1] + h * (tangents[i] ?? 0)]
    const c2 = [b[0] - h, b[1] - h * (tangents[i + 1] ?? 0)]
    d += ` C${fmt(c1[0] as number)},${fmt(c1[1] as number)} ${fmt(c2[0] as number)},${fmt(c2[1] as number)} ${fmt(b[0])},${fmt(b[1])}`
  }
  return d
}

/** The light fill under a line: the line, then down to the baseline and back. */
export function areaPath(points: readonly Pt[], baseY: number): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || points.length < 2) return ''
  return `${monotonePath(points)} L${fmt(last[0])},${fmt(baseY)} L${fmt(first[0])},${fmt(baseY)} Z`
}

/**
 * Splits a series at its gaps: each run of points with a value becomes one
 * segment, and a missing value (null) ends it. The line breaks there instead of
 * drawing across a week or check with no data.
 */
export function segmentsOf<T>(items: readonly T[], has: (item: T) => boolean): T[][] {
  const out: T[][] = []
  let run: T[] = []
  for (const item of items) {
    if (has(item)) run.push(item)
    else if (run.length > 0) {
      out.push(run)
      run = []
    }
  }
  if (run.length > 0) out.push(run)
  return out
}

/** Index of the x closest to `at`. Null for an empty list. */
export function nearestIndex(xs: readonly number[], at: number): number | null {
  let best: number | null = null
  let gap = Infinity
  xs.forEach((x, index) => {
    const d = Math.abs(x - at)
    if (d < gap) {
      gap = d
      best = index
    }
  })
  return best
}

/** Left edge for a card of `cardWidth` centred on `x`, kept inside `[0, width]`. */
export function clampCard(x: number, cardWidth: number, width: number): number {
  return Math.max(0, Math.min(x - cardWidth / 2, width - cardWidth))
}

/** The local calendar day of an ISO moment, `yyyy-mm-dd` (markers on one day stack). */
export function localDayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A `yyyy-mm-dd` day as local midnight, ISO. */
export function dayStartIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toISOString()
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * Moves label positions apart so no two sit closer than `gap`, keeping their order
 * and staying as near their own value as it can. Returns them in the given order.
 */
export function spreadLabels(ys: readonly number[], gap: number): number[] {
  const order = ys.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  // Runs of labels that crowd each other, each centred on the mean of its values.
  const runs: { top: number; items: typeof order }[] = []
  for (const item of order) {
    runs.push({ top: item.value, items: [item] })
    for (;;) {
      const cur = runs[runs.length - 1]
      const prev = runs[runs.length - 2]
      if (!cur || !prev || prev.top + prev.items.length * gap <= cur.top) break
      const items = [...prev.items, ...cur.items]
      const mean = items.reduce((sum, entry) => sum + entry.value, 0) / items.length
      runs.splice(-2, 2, { top: mean - ((items.length - 1) * gap) / 2, items })
    }
  }
  const out = new Array<number>(ys.length)
  for (const run of runs) {
    run.items.forEach((item, i) => {
      out[item.index] = run.top + i * gap
    })
  }
  return out
}
