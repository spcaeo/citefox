import { round1, splitWhole, textWidth } from './scale'
import {
  countMarks,
  defaultFormat,
  emptyChart,
  mark,
  rect,
  signed,
  SMALL,
  svgDoc,
  text,
  type ChartCommon,
  type ChartMarkup,
  type ChartTone
} from './svg'

export interface SplitPart {
  id?: string | null
  label: string
  /** May be negative (a part that pulled the total down). */
  value: number
  tone: ChartTone
  /** Longer words for the legend, e.g. "6 questions gained an AI answer". */
  note?: string
}

export interface SplitBarInput extends ChartCommon {
  parts: readonly SplitPart[]
  /**
   * The total the parts should add up to. When they fall short, a grey "Rest"
   * part makes up the difference, so the bar always adds up.
   */
  total?: number
  /** Words for the remainder part. */
  restLabel?: string
  /** Show values with a sign ("+2.1") - for a change split into parts. */
  signedValues?: boolean
  /** Bar height in px. */
  barHeight?: number
}

/** The parts, plus a "Rest" part when they fall short of `total` (never when they exceed it). */
export function splitParts(
  parts: readonly SplitPart[],
  total?: number,
  restLabel = 'Rest'
): SplitPart[] {
  const sum = parts.reduce((acc, part) => acc + part.value, 0)
  if (total === undefined) return [...parts]
  const rest = round1(total - sum)
  if (Math.abs(rest) < 0.05 || rest < 0) return [...parts]
  return [...parts, { label: restLabel, value: rest, tone: 'none' }]
}

/** Segment widths in whole px that add up to exactly `width`; each part above 0 gets 4 px at least. */
export function splitWidths(parts: readonly SplitPart[], width: number): number[] {
  return splitWhole(
    parts.map((part) => part.value),
    width,
    4
  )
}

/**
 * One bar cut into parts that add up: e.g. a change split into "the market moved"
 * and "your work". A negative part is drawn hatched and labelled with a minus.
 * The legend under the bar names every part with its value.
 */
export function splitBar(input: SplitBarInput): ChartMarkup {
  const { width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  const parts = splitParts(input.parts, input.total, input.restLabel)
  const show = (value: number): string =>
    input.signedValues || value < 0 ? signed(value, format) : format(value)
  if (parts.every((part) => !part.value))
    return emptyChart('split', width, label, input.emptyText ?? 'No change to split')
  const barH = input.barHeight ?? 32
  const widths = splitWidths(parts, Math.round(width))
  const drawn = widths.map((w, index) => (w > 0 ? index : -1)).filter((index) => index >= 0)
  const firstDrawn = drawn[0]
  const lastDrawn = drawn[drawn.length - 1]
  let x = 0
  let bar = ''
  parts.forEach((part, index) => {
    const w = widths[index] ?? 0
    if (w <= 0) return
    const value = show(part.value)
    const full = `${value} ${part.label}`
    const inside =
      textWidth(full, 12) + 16 <= w ? full : textWidth(value, 12) + 12 <= w ? value : ''
    const neg = part.value < 0 ? ' cfc-neg' : ''
    const inner =
      `<path class="cfc-seg cfc-t-${part.tone}${neg}" d="${segmentPath(x, w, barH, 8, index === firstDrawn, index === lastDrawn)}"/>` +
      (inside
        ? text(
            x + w / 2,
            barH / 2 + 4,
            inside,
            part.tone === 'none' || part.tone === 'muted' ? 'cfc-on cfc-on-quiet' : 'cfc-on',
            'middle'
          )
        : '')
    const words = `${part.label}: ${value}${part.note ? `. ${part.note}` : ''}`
    bar += mark(
      {
        id: part.id,
        label: words,
        tip: [part.label, value, ...(part.note ? [part.note] : [])],
        titles
      },
      inner
    )
    x += w
  })
  let body = bar + rect(0.5, 0.5, width - 1, barH - 1, 'cfc-split-edge', 8)
  // Legend: one line per part, with its words.
  let y = barH + 12
  parts.forEach((part) => {
    const words = `${part.label}: ${show(part.value)}${part.note ? ` · ${part.note}` : ''}`
    body += `<g aria-hidden="true">${rect(0, y + 2, 10, 10, `cfc-swatch cfc-t-${part.tone}${part.value < 0 ? ' cfc-neg' : ''}`, 3)}${text(16, y + 11, fitLine(words, width - 16), 'cfc-legend')}</g>`
    y += 18
  })
  const height = round1(y)
  const svg = svgDoc(
    'split',
    width,
    height,
    label,
    body,
    parts.some((part) => part.id)
  )
  return { svg, width, height, marks: countMarks(svg) }
}

function fitLine(words: string, room: number): string {
  if (textWidth(words, SMALL) <= room) return words
  const chars = [...words]
  while (chars.length > 1 && textWidth(`${chars.join('')}…`, SMALL) > room) chars.pop()
  return `${chars.join('').trimEnd()}…`
}

/** A segment's outline: square inside the bar, rounded on the bar's two ends. */
export function segmentPath(
  x: number,
  w: number,
  h: number,
  radius: number,
  left: boolean,
  right: boolean
): string {
  const r = Math.min(radius, w / 2, h / 2)
  const l = left ? r : 0
  const rr = right ? r : 0
  const x1 = round1(x)
  const x2 = round1(x + w)
  return [
    `M${round1(x1 + l)},0`,
    `H${round1(x2 - rr)}`,
    rr ? `A${round1(rr)},${round1(rr)} 0 0 1 ${x2},${round1(rr)}` : '',
    `V${round1(h - rr)}`,
    rr ? `A${round1(rr)},${round1(rr)} 0 0 1 ${round1(x2 - rr)},${h}` : '',
    `H${round1(x1 + l)}`,
    l ? `A${round1(l)},${round1(l)} 0 0 1 ${x1},${round1(h - l)}` : '',
    `V${round1(l)}`,
    l ? `A${round1(l)},${round1(l)} 0 0 1 ${round1(x1 + l)},0` : '',
    'Z'
  ]
    .filter(Boolean)
    .join(' ')
}
