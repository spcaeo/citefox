import type { Count } from '../../model/types'
import { esc } from '../escape'
import { drill } from '../parts'

/**
 * Horizontal bars as inline SVG. Each row's number is a drill button, so every bar
 * opens the prompts behind it; clicking the row anywhere does the same.
 */

export type Tone = 'blue' | 'orange' | 'aqua' | 'violet' | 'gray' | 'red' | 'none'

export interface BarItem {
  /** Escaped HTML for the label (a path, a domain with a chip). */
  labelHtml: string
  value: Count
  /** Drawer title for this bar. */
  drillLabel: string
  tone?: Tone
  /** Secondary text after the number, such as "5 citations". */
  meta?: string
  /** The value in the previous full check, drawn as a faint bar under this one. */
  before?: number | null
}

export interface StackPart {
  value: Count
  tone: Tone
  label: string
}

/** The faint bar for the previous check: 4px under the bar, `fraction` 0–1 of the width. */
export interface EarlierBar {
  fraction: number
  title: string
}

/** One SVG bar track, `fraction` 0–1 of the width, with an optional earlier bar under it. */
export function barSvg(
  fraction: number,
  tone: Tone,
  title: string,
  height = 12,
  earlier?: EarlierBar
): string {
  const width = clampPct(fraction)
  const total = earlier === undefined ? height : height + 6
  const before = earlier === undefined ? 0 : clampPct(earlier.fraction)
  return (
    `<svg class="bar-svg" width="100%" height="${total}" role="presentation" focusable="false">` +
    `<rect class="track" x="0" y="0" width="100%" height="${height}" rx="3"/>` +
    (width > 0
      ? `<rect class="t-${tone}" x="0" y="0" width="${width}%" height="${height}" rx="3"><title>${esc(title)}</title></rect>`
      : '') +
    (earlier !== undefined && before > 0
      ? `<rect class="before" x="0" y="${height + 2}" width="${before}%" height="4" rx="2"><title>${esc(earlier.title)}</title></rect>`
      : '') +
    `</svg>`
  )
}

/** Stacked segments in one SVG track; fractions are of `total`. */
export function stackSvg(parts: readonly StackPart[], total: number, height = 14): string {
  let x = 0
  const rects = parts
    .map((part) => {
      if (total <= 0 || part.value.n <= 0) return ''
      const width = (part.value.n / total) * 100
      const rect = `<rect class="t-${part.tone} seg" x="${round(x)}%" y="0" width="${round(width)}%" height="${height}"><title>${esc(`${part.label}: ${part.value.n}`)}</title></rect>`
      x += width
      return rect
    })
    .join('')
  return (
    `<svg class="bar-svg" width="100%" height="${height}" role="presentation" focusable="false">` +
    `<rect class="track" x="0" y="0" width="100%" height="${height}" rx="3"/>${rects}</svg>`
  )
}

/** A list of bars, longest at the top as given. `max` defaults to the largest value. */
export function barList(items: readonly BarItem[], ariaLabel: string, max?: number): string {
  if (items.length === 0) return '<p class="tbl-empty">Nothing to show yet.</p>'
  const top = max ?? Math.max(1, ...items.map((item) => Math.max(item.value.n, item.before ?? 0)))
  const rows = items
    .map((item) => {
      const tone = item.tone ?? 'blue'
      const meta = item.meta === undefined ? '' : `<span class="bar-meta">${esc(item.meta)}</span>`
      const earlier =
        item.before === undefined || item.before === null
          ? undefined
          : { fraction: item.before / top, title: `Previous check: ${item.before}` }
      return (
        `<li class="bar-row"><span class="bar-label">${item.labelHtml}</span>` +
        `<span class="bar-track">${barSvg(item.value.n / top, tone, `${item.drillLabel}: ${item.value.n}`, 12, earlier)}</span>` +
        `<span class="bar-value">${drill(item.value, item.drillLabel)}${meta}</span></li>`
      )
    })
    .join('')
  return `<ul class="bars" aria-label="${esc(ariaLabel)}">${rows}</ul>`
}

/** Legend of swatches. Identity is never colour alone: every swatch has its label. */
export function legend(items: readonly { tone: Tone; label: string }[]): string {
  return `<ul class="legend">${items
    .map(
      (item) =>
        `<li><span class="swatch t-${item.tone}" aria-hidden="true"></span>${esc(item.label)}</li>`
    )
    .join('')}</ul>`
}

function clampPct(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0
  return round(Math.min(1, fraction) * 100)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
