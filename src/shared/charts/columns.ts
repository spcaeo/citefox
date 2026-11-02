import { barLength, peakOf, round1, slots, wrapTwo } from './scale'
import {
  countMarks,
  defaultFormat,
  emptyChart,
  FONT,
  fittedText,
  mark,
  rect,
  SMALL,
  svgDoc,
  text,
  type ChartCommon,
  type ChartMarkup,
  type ChartTone
} from './svg'

/** One column: a bucket such as "0–3 days" or "#1". */
export interface BucketItem {
  id?: string | null
  label: string
  value: number
  /** A second line under the label, e.g. "2 of 5 pages cited". */
  sub?: string
  tone?: ChartTone
}

export interface BucketColumnsInput extends ChartCommon {
  items: readonly BucketItem[]
  /** Total height in px. */
  height?: number
  /** What a value counts, for screen readers and the hover card: "questions citing". */
  valueWords?: string
}

const VALUE_ROOM = 20
const SLOT_GAP = 6

/**
 * Columns, one per bucket, on one scale from 0: the number on top, the label and
 * an optional second line under each. Every column is one mark.
 */
export function columnsChart(kind: string, input: BucketColumnsInput): ChartMarkup {
  const { items, width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  if (items.length === 0) return emptyChart(kind, width, label, input.emptyText ?? 'No data yet')
  const height = Math.max(120, input.height ?? 220)
  const cells = slots(items.length, width, SLOT_GAP)
  const room = Math.max(20, (cells[0]?.width ?? width) - 2)
  // Labels and second lines wrap onto two lines when a slot is narrow.
  const labelLines = items.map((item) => wrapTwo(item.label, room, FONT))
  const subLines = items.map((item) => (item.sub ? wrapTwo(item.sub, room, SMALL) : []))
  const labelRows = Math.max(1, ...labelLines.map((lines) => lines.length))
  const subRows = Math.max(0, ...subLines.map((lines) => lines.length))
  const below = 8 + labelRows * 14 + subRows * 13
  const base = height - below
  const plot = base - VALUE_ROOM
  const max = peakOf(items.map((item) => item.value))
  let body = rect(0, base, width, 1, 'cfc-base', 0)
  items.forEach((item, index) => {
    const slot = cells[index] ?? { x: 0, width }
    const colW = Math.min(72, slot.width * 0.7)
    const cx = slot.x + slot.width / 2
    const h = item.value > 0 ? barLength(item.value, max, plot, 3) : 0
    const valueWords = input.valueWords
      ? `${format(item.value)} ${input.valueWords}`
      : format(item.value)
    const words = [item.label, valueWords, item.sub].filter(Boolean).join(', ')
    const inner =
      rect(slot.x, 0, slot.width, height, 'cfc-hit', 4) +
      (h > 0
        ? rect(
            cx - colW / 2,
            base - h,
            colW,
            h,
            `cfc-bar cfc-col cfc-t-${item.tone ?? 'target'}`,
            5
          )
        : rect(cx - colW / 2, base - 2, colW, 2, 'cfc-bar cfc-zero', 1)) +
      text(cx, base - h - 6, format(item.value), 'cfc-value cfc-value-strong', 'middle') +
      (labelLines[index] ?? [])
        .map((line, row) =>
          fittedText(cx, base + 16 + row * 14, line, room, 'cfc-label', FONT, 'middle', titles)
        )
        .join('') +
      (subLines[index] ?? [])
        .map((line, row) =>
          fittedText(
            cx,
            base + 17 + labelRows * 14 + row * 13,
            line,
            room,
            'cfc-sub',
            SMALL,
            'middle',
            titles
          )
        )
        .join('')
    body += mark(
      {
        id: item.id,
        label: words,
        tip: [item.label, valueWords, ...(item.sub ? [item.sub] : [])],
        titles
      },
      inner
    )
  })
  const svg = svgDoc(
    kind,
    width,
    height,
    label,
    body,
    items.some((item) => item.id)
  )
  return { svg, width, height: round1(height), marks: countMarks(svg) }
}

/** "How fast pages get cited": one column per days-live bucket. */
export function bucketColumns(input: BucketColumnsInput): ChartMarkup {
  return columnsChart('buckets', input)
}
