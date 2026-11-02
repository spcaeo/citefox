/**
 * Pure geometry for the report charts (src/shared/charts): bar lengths, column
 * slots, parts that add up to a width or to 100%, and the label-width guess that
 * truncates long labels. No DOM, so the app and the downloaded report draw the
 * same numbers.
 */

/** One decimal place: SVG numbers stay short and stable. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** The largest finite value, or 0. */
export function peakOf(values: readonly number[]): number {
  let peak = 0
  for (const value of values) if (Number.isFinite(value) && value > peak) peak = value
  return peak
}

/**
 * The length of a bar for `value` out of `max` over `span` pixels. A value above 0
 * is never drawn shorter than `minimum`, so a 1 next to a 900 still shows.
 */
export function barLength(value: number, max: number, span: number, minimum = 2): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0 || span <= 0) return 0
  const length = (Math.min(value, max) / max) * span
  return round1(Math.min(span, Math.max(minimum, length)))
}

export interface Slot {
  x: number
  width: number
}

/** `count` equal slots across `width` with `gap` between them. */
export function slots(count: number, width: number, gap: number): Slot[] {
  if (count <= 0 || width <= 0) return []
  const each = Math.max(0, (width - gap * (count - 1)) / count)
  return Array.from({ length: count }, (_, index) => ({
    x: round1(index * (each + gap)),
    width: round1(each)
  }))
}

/**
 * Whole numbers proportional to `values` that add up to exactly `total` (largest
 * remainder). Negative values count by their size. Every value above 0 gets at
 * least `minimum`, taken from the biggest parts, while `total` allows it.
 */
export function splitWhole(values: readonly number[], total: number, minimum = 0): number[] {
  const sizes = values.map((value) => (Number.isFinite(value) ? Math.abs(value) : 0))
  const sum = sizes.reduce((acc, value) => acc + value, 0)
  const whole = Math.max(0, Math.round(total))
  if (sum <= 0 || whole === 0) return sizes.map(() => 0)
  const exact = sizes.map((value) => (value / sum) * whole)
  const out = exact.map(Math.floor)
  let left = whole - out.reduce((acc, value) => acc + value, 0)
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    out[index] = (out[index] ?? 0) + 1
    left -= 1
  }
  const nonZero = sizes.filter((value) => value > 0).length
  if (minimum > 0 && nonZero * minimum <= whole) {
    for (let index = 0; index < out.length; index += 1) {
      if ((sizes[index] ?? 0) <= 0) continue
      while ((out[index] ?? 0) < minimum) {
        let donor = -1
        for (let j = 0; j < out.length; j += 1) {
          if (
            j !== index &&
            (out[j] ?? 0) > minimum &&
            (donor < 0 || (out[j] ?? 0) > (out[donor] ?? 0))
          )
            donor = j
        }
        if (donor < 0) break
        out[donor] = (out[donor] ?? 0) - 1
        out[index] = (out[index] ?? 0) + 1
      }
    }
  }
  return out
}

/** Whole percents for `values` that add up to 100 (0 each when all are 0). */
export function percentShares(values: readonly number[]): number[] {
  return splitWhole(values, 100)
}

/** Rough width of `text` in pixels at `size` px (Inter averages about 0.56 em a character). */
export function textWidth(text: string, size: number): number {
  let units = 0
  for (const char of text) {
    if (char === ' ') units += 0.28
    else if (/[ilj.,:;'|!·]/.test(char)) units += 0.28
    else if (/[mwMW@%#]/.test(char)) units += 0.85
    else if (/[A-Z0-9]/.test(char)) units += 0.62
    else if (/[a-z]/.test(char)) units += 0.53
    else units += 0.56
  }
  return round1(units * size)
}

/**
 * `text` cut to fit `maxWidth` px at `size` px, ending in "…" when cut. The full
 * text always goes in the mark's aria-label and title.
 */
export function truncate(text: string, maxWidth: number, size: number): string {
  if (textWidth(text, size) <= maxWidth) return text
  const chars = [...text]
  let end = chars.length
  while (end > 0 && textWidth(`${chars.slice(0, end).join('').trimEnd()}…`, size) > maxWidth)
    end -= 1
  return end <= 0 ? '…' : `${chars.slice(0, end).join('').trimEnd()}…`
}

/**
 * `text` as one line when it fits `maxWidth`, else two lines split at the space
 * that best balances them (the second line is cut with "…" if still too long).
 */
export function wrapTwo(text: string, maxWidth: number, size: number): string[] {
  if (textWidth(text, size) <= maxWidth || !text.includes(' ')) return [text]
  const words = text.split(' ')
  let best: [string, string] = [text, '']
  let worst = Infinity
  for (let cut = 1; cut < words.length; cut += 1) {
    const a = words.slice(0, cut).join(' ')
    const b = words.slice(cut).join(' ')
    const longest = Math.max(textWidth(a, size), textWidth(b, size))
    if (longest < worst) {
      worst = longest
      best = [a, b]
    }
  }
  return best
}
