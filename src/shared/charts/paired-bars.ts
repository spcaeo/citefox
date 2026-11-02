import { barLength, peakOf, round1, slots, textWidth, truncate } from './scale'
import {
  defaultFormat,
  emptyChart,
  FONT,
  esc,
  n,
  legend,
  mark,
  rect,
  signed,
  SMALL,
  svgDoc,
  text,
  countMarks,
  type ChartCommon,
  type ChartMarkup,
  type ChartTone
} from './svg'

/** One item with its value at the earlier check ("before") and now. */
export interface PairedItem {
  /** Drill id for the item (both bars, or the "now" bar when `beforeId` is set). */
  id?: string | null
  /** Drill id for the "before" bar alone; the bars become two marks. */
  beforeId?: string | null
  label: string
  /** Quiet words after the label, e.g. "New page". */
  sub?: string
  before: number
  now: number
  /** The "now" bar's colour (target green by default). */
  tone?: ChartTone
}

export interface PairedBarsInput extends ChartCommon {
  items: readonly PairedItem[]
  /** e.g. "Sep 16". */
  beforeLabel: string
  /** e.g. "Oct 28". */
  nowLabel: string
  /** Items side by side in two columns (wide cards). */
  columns?: 1 | 2
}

const LABEL_H = 16
const BAR_H = 11
const BAR_GAP = 3
const ROW_GAP = 14
const VALUE_ROOM = 52
const COL_GAP = 28
export const PAIRED_ROW_H = LABEL_H + BAR_H * 2 + BAR_GAP + ROW_GAP

/**
 * Paired before/after bars: per item, a faint bar for the earlier check and a solid
 * bar for now, on one shared scale, each with its number at the end.
 */
export function pairedBars(input: PairedBarsInput): ChartMarkup {
  const { items, width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  if (items.length === 0)
    return emptyChart('paired', width, label, input.emptyText ?? 'Nothing to compare yet')
  const columns = input.columns === 2 && width >= 420 ? 2 : 1
  const cols = slots(columns, width, COL_GAP)
  const max = peakOf(items.flatMap((item) => [item.before, item.now]))
  const key = legend(
    [
      { label: input.beforeLabel, swatch: 'cfc-before' },
      { label: input.nowLabel, swatch: 'cfc-t-target' }
    ],
    0,
    0,
    width
  )
  const top = key.height + 8
  const rows = Math.ceil(items.length / columns)
  let body = key.markup
  items.forEach((item, index) => {
    const col = cols[index % columns] ?? { x: 0, width }
    const x = col.x
    const y = top + Math.floor(index / columns) * PAIRED_ROW_H
    const span = Math.max(20, col.width - VALUE_ROOM)
    const change = item.now - item.before
    const tip = [
      item.label,
      `${input.beforeLabel}: ${format(item.before)}`,
      `${input.nowLabel}: ${format(item.now)}`,
      `Change: ${signed(change, format)}`
    ]
    // Label and its quiet words in one line (tspans), so the gap never depends on a width guess.
    const labelRoom = item.sub ? col.width * 0.7 : col.width - 8
    const shown = truncate(item.label, labelRoom, FONT)
    const subShown = item.sub
      ? truncate(`· ${item.sub}`, Math.max(0, col.width - textWidth(shown, FONT) - 8), SMALL)
      : ''
    const cut = shown !== item.label && titles ? `<title>${esc(item.label)}</title>` : ''
    const head =
      `<text class="cfc-text cfc-label" x="${n(x)}" y="${n(y + 12)}">${cut}${esc(shown)}` +
      (subShown ? `<tspan class="cfc-sub" dx="4">${esc(subShown)}</tspan>` : '') +
      '</text>'
    const by = y + LABEL_H
    const ny = by + BAR_H + BAR_GAP
    const bw = barLength(item.before, max, span)
    const nw = barLength(item.now, max, span)
    const beforeBar =
      rect(x, by, span, BAR_H, 'cfc-track') +
      rect(x, by, bw, BAR_H, 'cfc-bar cfc-before') +
      text(x + bw + 6, by + BAR_H - 1, format(item.before), 'cfc-value cfc-value-quiet')
    const nowBar =
      rect(x, ny, span, BAR_H, 'cfc-track') +
      rect(x, ny, nw, BAR_H, `cfc-bar cfc-t-${item.tone ?? 'target'}`) +
      text(x + nw + 6, ny + BAR_H - 1, format(item.now), 'cfc-value')
    const hit = rect(x, y, col.width, PAIRED_ROW_H - ROW_GAP + 4, 'cfc-hit', 4)
    if (item.beforeId) {
      body +=
        head +
        mark(
          {
            id: item.beforeId,
            label: `${item.label}, ${input.beforeLabel}: ${format(item.before)}`,
            tip,
            titles
          },
          beforeBar
        ) +
        mark(
          {
            id: item.id,
            label: `${item.label}, ${input.nowLabel}: ${format(item.now)}`,
            tip,
            titles
          },
          nowBar
        )
    } else {
      const words = `${item.label}: ${input.beforeLabel} ${format(item.before)}, ${input.nowLabel} ${format(item.now)}, change ${signed(change, format)}`
      body += mark({ id: item.id, label: words, tip, titles }, hit + head + beforeBar + nowBar)
    }
  })
  const height = round1(top + rows * PAIRED_ROW_H - ROW_GAP + 4)
  const svg = svgDoc(
    'paired',
    width,
    height,
    label,
    body,
    items.some((item) => item.id || item.beforeId)
  )
  return { svg, width, height, marks: countMarks(svg) }
}
