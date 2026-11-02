import { round1, textWidth, truncate } from './scale'

/**
 * SVG markup helpers shared by every report chart builder. Every string from the
 * caller is escaped here. Colours are never written in: a mark carries a
 * `cfc-t-<tone>` class and charts.css maps it to a token (app) or a report
 * colour (downloaded report).
 */

/**
 * What a mark means, as a colour class: the four results (target page cited,
 * your other page, not cited, no AI answer), plain ink, a quiet grey, and
 * up/down for change.
 */
export type ChartTone =
  'target' | 'target-soft' | 'other' | 'not-cited' | 'none' | 'ink' | 'muted' | 'up' | 'down'

/** A finished chart: the SVG and its size in px. `marks` counts the drillable marks. */
export interface ChartMarkup {
  svg: string
  width: number
  height: number
  marks: number
}

/** Options every builder takes. */
export interface ChartCommon {
  /** The chart's accessible name, e.g. "Most cited sites, Oct 28". */
  label: string
  /** Width in px to draw at. The SVG scales with its box (viewBox) in the report. */
  width: number
  /** Formats a value; whole numbers with thousands separators by default. */
  format?: (value: number) => string
  /**
   * Native `<title>` tooltips on marks (the downloaded report). The app turns
   * them off and shows its own hover card from `data-tip`.
   */
  titles?: boolean
  /** Shown when there is nothing to draw. */
  emptyText?: string
}

export const FONT = 12
export const SMALL = 11

/** Escapes text for element content and quoted attributes. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Whole numbers with separators, one decimal otherwise ("1,204", "2.5"). */
export function defaultFormat(value: number): string {
  if (!Number.isFinite(value)) return '–'
  const rounded = Number.isInteger(value) ? value : round1(value)
  return rounded.toLocaleString('en-US')
}

/** "+4", "−3" (a real minus) or "0". */
export function signed(value: number, format: (value: number) => string = defaultFormat): string {
  if (value > 0) return `+${format(value)}`
  if (value < 0) return `−${format(Math.abs(value))}`
  return format(0)
}

export function n(value: number): string {
  return String(round1(value))
}

export interface MarkSpec {
  /** Drill id: the mark becomes a focusable button with `data-drill`. */
  id?: string | null
  /** Full words for screen readers and the title tooltip. */
  label: string
  /** Lines for the app's hover card. */
  tip: readonly string[]
  titles: boolean
  className?: string
}

/** A group that is one mark: a drill button when it has an id, else a labelled image. */
export function mark(spec: MarkSpec, inner: string): string {
  const drill = spec.id ? ` tabindex="0" role="button" data-drill="${esc(spec.id)}"` : ' role="img"'
  const tip = spec.tip.map(esc).join('&#10;')
  const cls = `cfc-mark${spec.id ? ' cfc-drill' : ''}${spec.className ? ` ${spec.className}` : ''}`
  const title = spec.titles ? `<title>${esc(spec.label)}</title>` : ''
  return `<g class="${cls}"${drill} aria-label="${esc(spec.label)}" data-tip="${tip}">${title}${inner}</g>`
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  className: string,
  radius = 3
): string {
  if (width <= 0 || height <= 0) return ''
  const rx = Math.min(radius, width / 2, height / 2)
  return `<rect class="${className}" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${n(rx)}"/>`
}

export type Anchor = 'start' | 'middle' | 'end'

/** A text line, already fitted by the caller. `aria-hidden` when a mark labels it. */
export function text(
  x: number,
  y: number,
  value: string,
  className: string,
  anchor: Anchor = 'start'
): string {
  const a = anchor === 'start' ? '' : ` text-anchor="${anchor}"`
  return `<text class="cfc-text ${className}" x="${n(x)}" y="${n(y)}"${a}>${esc(value)}</text>`
}

/** A label cut to `maxWidth`, with the full text as its title when it was cut. */
export function fittedText(
  x: number,
  y: number,
  value: string,
  maxWidth: number,
  className: string,
  size = FONT,
  anchor: Anchor = 'start',
  titles = true
): string {
  const shown = truncate(value, maxWidth, size)
  if (shown === value || !titles) return text(x, y, shown, className, anchor)
  const a = anchor === 'start' ? '' : ` text-anchor="${anchor}"`
  return `<text class="cfc-text ${className}" x="${n(x)}" y="${n(y)}"${a}><title>${esc(value)}</title>${esc(shown)}</text>`
}

/** A rounded change chip ("▲ +4"), its right edge at `right` when `anchor` is end. */
export function chip(
  x: number,
  y: number,
  value: string,
  tone: 'up' | 'down' | 'flat',
  anchor: 'start' | 'end' = 'end'
): { markup: string; width: number } {
  const width = round1(textWidth(value, SMALL) + 14)
  const left = anchor === 'end' ? x - width : x
  return {
    width,
    markup:
      rect(left, y, width, 18, `cfc-chip cfc-chip-${tone}`, 9) +
      text(left + width / 2, y + 13, value, `cfc-chip-text cfc-chip-text-${tone}`, 'middle')
  }
}

/** The chip words for a change: "▲ +4", "▼ −3", "0". */
export function changeWords(change: number, format?: (value: number) => string): string {
  if (change > 0) return `▲ ${signed(change, format)}`
  if (change < 0) return `▼ ${signed(change, format)}`
  return '0'
}

export function svgDoc(
  kind: string,
  width: number,
  height: number,
  label: string,
  body: string,
  interactive: boolean
): string {
  const w = n(width)
  const h = n(height)
  const role = interactive ? 'group' : 'img'
  return `<svg class="cfc cfc-${kind}" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="${role}" aria-label="${esc(label)}">${body}</svg>`
}

/** The chart with nothing to draw: one quiet line, labelled for screen readers. */
export function emptyChart(kind: string, width: number, label: string, words: string): ChartMarkup {
  const height = 48
  const body = text(width / 2, 28, words, 'cfc-empty', 'middle')
  return {
    svg: svgDoc(kind, width, height, `${label}: ${words}`, body, false),
    width,
    height,
    marks: 0
  }
}

export interface LegendItem {
  label: string
  /** A swatch class, e.g. `cfc-t-target` or `cfc-before`. */
  swatch: string
}

/** A legend row that wraps onto more lines when it runs out of width. */
export function legend(
  items: readonly LegendItem[],
  x: number,
  y: number,
  width: number
): { markup: string; height: number } {
  if (items.length === 0) return { markup: '', height: 0 }
  let cx = x
  let cy = y
  let out = ''
  for (const item of items) {
    const words = truncate(item.label, Math.max(40, width - 16), SMALL)
    const span = 14 + textWidth(words, SMALL) + 16
    if (cx > x && cx + span > x + width) {
      cx = x
      cy += 18
    }
    out += rect(cx, cy + 2, 10, 10, `cfc-swatch ${item.swatch}`, 3)
    out += text(cx + 14, cy + 11, words, 'cfc-legend')
    cx += span
  }
  return { markup: `<g class="cfc-legend-row" aria-hidden="true">${out}</g>`, height: cy - y + 18 }
}

export function countMarks(svg: string): number {
  return (svg.match(/ data-drill="/g) ?? []).length
}
