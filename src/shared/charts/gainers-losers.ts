import { round1, slots, textWidth } from './scale'
import {
  changeWords,
  chip,
  countMarks,
  defaultFormat,
  emptyChart,
  FONT,
  fittedText,
  mark,
  rect,
  signed,
  SMALL,
  svgDoc,
  text,
  type ChartCommon,
  type ChartMarkup
} from './svg'

export interface MoverItem {
  id?: string | null
  label: string
  before: number
  now: number
  /** Your own site: drawn in bold. */
  highlight?: boolean
}

export interface GainersLosersInput extends ChartCommon {
  items: readonly MoverItem[]
  gainedTitle?: string
  lostTitle?: string
  gainedEmpty?: string
  lostEmpty?: string
  /** Rows per list; the rest is counted as "and N more". */
  limit?: number
}

export interface MoverLists {
  gained: MoverItem[]
  lost: MoverItem[]
}

/** Gainers (biggest rise first) and losers (biggest fall first); unchanged items drop out. */
export function splitMovers(items: readonly MoverItem[]): MoverLists {
  const change = (item: MoverItem): number => item.now - item.before
  return {
    gained: items.filter((item) => change(item) > 0).sort((a, b) => change(b) - change(a)),
    lost: items.filter((item) => change(item) < 0).sort((a, b) => change(a) - change(b))
  }
}

const TITLE_H = 26
const ROW_H = 28
const GAP = 24

/**
 * Two lists side by side (stacked when narrow): who gained ground and who lost it,
 * each row "before → now" with a change chip.
 */
export function gainersLosers(input: GainersLosersInput): ChartMarkup {
  const { width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  const limit = Math.max(1, input.limit ?? 8)
  if (input.items.length === 0)
    return emptyChart('movers', width, label, input.emptyText ?? 'Nothing moved yet')
  const lists = splitMovers(input.items)
  const side = width >= 480
  const panels = side
    ? slots(2, width, GAP)
    : [
        { x: 0, width },
        { x: 0, width }
      ]
  const parts = [
    {
      title: input.gainedTitle ?? 'Gained ground',
      empty: input.gainedEmpty ?? 'Nobody gained ground',
      rows: lists.gained
    },
    {
      title: input.lostTitle ?? 'Lost ground',
      empty: input.lostEmpty ?? 'Nobody lost ground',
      rows: lists.lost
    }
  ]
  const heights = parts.map((part) => {
    const shown = Math.min(limit, part.rows.length)
    return TITLE_H + Math.max(1, shown) * ROW_H + (part.rows.length > limit ? 20 : 0)
  })
  let body = ''
  let y0 = 0
  parts.forEach((part, p) => {
    const panel = panels[p] ?? { x: 0, width }
    const x = panel.x
    const top = side ? 0 : y0
    body += text(x, top + 15, part.title, 'cfc-title')
    if (part.rows.length === 0) {
      body += text(x, top + TITLE_H + 18, part.empty, 'cfc-empty')
    }
    part.rows.slice(0, limit).forEach((item, index) => {
      const y = top + TITLE_H + index * ROW_H
      const change = item.now - item.before
      const right = x + panel.width - 6
      const c = chip(right, y + 5, changeWords(change, format), change > 0 ? 'up' : 'down')
      const values = `${format(item.before)} → ${format(item.now)}`
      const valuesX = right - c.width - 8
      const room = valuesX - textWidth(values, SMALL) - x - 28
      const inner =
        rect(x, y + 1, panel.width, ROW_H - 2, 'cfc-row', 6) +
        fittedText(
          x + 8,
          y + 18,
          item.label,
          room,
          item.highlight ? 'cfc-label cfc-label-me' : 'cfc-label',
          FONT,
          'start',
          titles
        ) +
        text(valuesX, y + 18, values, 'cfc-value cfc-value-quiet', 'end') +
        c.markup
      const words = `${item.label}: ${format(item.before)} to ${format(item.now)}, ${signed(change, format)}`
      body += mark(
        {
          id: item.id,
          label: words,
          tip: [item.label, values, `Change: ${signed(change, format)}`],
          titles
        },
        inner
      )
    })
    if (part.rows.length > limit) {
      const y = top + TITLE_H + limit * ROW_H
      body += text(x + 8, y + 14, `and ${part.rows.length - limit} more`, 'cfc-sub')
    }
    y0 += (heights[p] ?? 0) + 12
  })
  const height = round1(side ? Math.max(...heights) : y0 - 12)
  const svg = svgDoc(
    'movers',
    width,
    height,
    label,
    body,
    input.items.some((item) => item.id)
  )
  return { svg, width, height, marks: countMarks(svg) }
}
