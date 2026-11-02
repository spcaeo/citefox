import { barLength, peakOf, round1 } from './scale'
import {
  countMarks,
  defaultFormat,
  emptyChart,
  FONT,
  fittedText,
  legend,
  mark,
  rect,
  signed,
  svgDoc,
  text,
  type ChartCommon,
  type ChartMarkup
} from './svg'

export interface RankedItem {
  id?: string | null
  label: string
  value: number
  /** The value at the earlier check, drawn as a faint wider bar behind. */
  previous?: number | null
  /** Your own site: green bar, bold label. */
  highlight?: boolean
}

export interface RankedBarsInput extends ChartCommon {
  items: readonly RankedItem[]
  /** Legend words for the solid bar, e.g. "Oct 28". */
  nowLabel?: string
  /** Legend words for the faint bar, e.g. "Sep 16". */
  previousLabel?: string
  /** Width of the label column; about a third of the chart by default. */
  labelWidth?: number
}

const ROW_H = 24
const BAR_H = 12
const VALUE_ROOM = 48

/**
 * Ranked bars, as given (sort before calling): label on the left, the bar, the
 * number. When an item has a previous value it shows as a faint full-height bar
 * with the current value as a thinner bar on top.
 */
export function rankedBars(input: RankedBarsInput): ChartMarkup {
  const { items, width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  if (items.length === 0)
    return emptyChart('ranked', width, label, input.emptyText ?? 'Nothing cited yet')
  const anyPrevious = items.some((item) => item.previous !== undefined && item.previous !== null)
  const key =
    anyPrevious && input.previousLabel
      ? legend(
          [
            { label: input.previousLabel, swatch: 'cfc-before' },
            { label: input.nowLabel ?? 'Now', swatch: 'cfc-t-ink' }
          ],
          0,
          0,
          width
        )
      : { markup: '', height: 0 }
  const top = key.height > 0 ? key.height + 8 : 0
  const labelW = Math.round(input.labelWidth ?? Math.min(180, Math.max(80, width * 0.32)))
  const barX = labelW + 10
  const span = Math.max(20, width - barX - VALUE_ROOM)
  const max = peakOf(items.flatMap((item) => [item.value, item.previous ?? 0]))
  let body = key.markup
  items.forEach((item, index) => {
    const y = top + index * ROW_H
    const has = item.previous !== undefined && item.previous !== null
    const now = barLength(item.value, max, span)
    const before = has ? barLength(item.previous ?? 0, max, span) : 0
    const tone = item.highlight ? 'cfc-t-target' : 'cfc-t-ink'
    const cy = y + (ROW_H - BAR_H) / 2
    const tip = [item.label, `${input.nowLabel ?? 'Now'}: ${format(item.value)}`]
    if (has) {
      tip.push(`${input.previousLabel ?? 'Before'}: ${format(item.previous ?? 0)}`)
      tip.push(`Change: ${signed(item.value - (item.previous ?? 0), format)}`)
    }
    const inner =
      rect(0, y, width, ROW_H, 'cfc-row', 4) +
      fittedText(
        labelW,
        y + 16,
        item.label,
        labelW,
        item.highlight ? 'cfc-label cfc-label-me' : 'cfc-label',
        FONT,
        'end',
        titles
      ) +
      (has ? rect(barX, cy, before, BAR_H, 'cfc-bar cfc-before') : '') +
      (has
        ? rect(barX, cy + 3, now, BAR_H - 6, `cfc-bar ${tone}`, 2)
        : rect(barX, cy + 1, now, BAR_H - 2, `cfc-bar ${tone}`)) +
      text(barX + span + 8, y + 16, format(item.value), 'cfc-value')
    const words = has
      ? `${item.label}: ${format(item.value)}, before ${format(item.previous ?? 0)}`
      : `${item.label}: ${format(item.value)}`
    body += mark({ id: item.id, label: words, tip, titles }, inner)
  })
  const height = round1(top + items.length * ROW_H)
  const svg = svgDoc(
    'ranked',
    width,
    height,
    label,
    body,
    items.some((item) => item.id)
  )
  return { svg, width, height, marks: countMarks(svg) }
}
