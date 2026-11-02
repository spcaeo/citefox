import { round1 } from './scale'
import { countMarks, emptyChart, mark, rect, svgDoc, type ChartMarkup } from './svg'

/** What one check found for a question. */
export type HistoryState = 'target' | 'other' | 'named' | 'not-cited' | 'none' | 'missing'

export const HISTORY_WORDS: Record<HistoryState, string> = {
  target: 'Right page cited',
  other: 'Your other page cited',
  named: 'Named, not cited',
  'not-cited': 'Not cited',
  none: 'No AI answer',
  missing: 'Not checked'
}

export interface HistoryCell {
  id?: string | null
  /** The check's date as shown, e.g. "Sep 16". */
  date: string
  state: HistoryState
  /** Your source position in that answer, when cited. */
  position?: number | null
}

export interface HistoryStripInput {
  label: string
  cells: readonly HistoryCell[]
  /** Most px the strip may take; squares shrink (to 4 px) to fit. */
  width?: number
  /** Square size when there is room. */
  cell?: number
  titles?: boolean
  emptyText?: string
}

const GAP = 3

/** The square size that fits `count` squares in `width`, between 4 px and `max`. */
export function historyCellSize(count: number, width: number | undefined, max = 12): number {
  if (count <= 0) return max
  if (width === undefined) return max
  const fit = Math.floor((width + GAP) / count - GAP)
  return Math.max(4, Math.min(max, fit))
}

/**
 * One coloured square per check, oldest first: green target page, blue other
 * page, an outlined tint when named but not cited, orange not cited, grey no AI
 * answer, an empty outline when not checked. Each square's tooltip names the
 * date, the result and, when cited, the source position.
 */
export function historyStrip(input: HistoryStripInput): ChartMarkup {
  const titles = input.titles ?? true
  const count = input.cells.length
  if (count === 0)
    return emptyChart(
      'history',
      input.width ?? 120,
      input.label,
      input.emptyText ?? 'No checks yet'
    )
  const size = historyCellSize(count, input.width, input.cell ?? 12)
  const width = round1(count * (size + GAP) - GAP)
  const height = size + 2
  const cited = input.cells.filter(
    (cell) => cell.state === 'target' || cell.state === 'other'
  ).length
  const body = input.cells
    .map((cell, index) => {
      const where = typeof cell.position === 'number' ? `source #${cell.position}` : null
      const words = `${cell.date}: ${HISTORY_WORDS[cell.state]}${where ? `, ${where}` : ''}`
      return mark(
        {
          id: cell.id,
          label: words,
          tip: [cell.date, HISTORY_WORDS[cell.state], ...(where ? [where] : [])],
          titles,
          className: 'cfc-cell'
        },
        rect(
          index * (size + GAP),
          1,
          size,
          size,
          `cfc-sq cfc-sq-${cell.state}`,
          Math.min(3, size / 4)
        )
      )
    })
    .join('')
  const label = `${input.label}: ${count} ${count === 1 ? 'check' : 'checks'}, cited in ${cited}`
  const svg = svgDoc(
    'history',
    width,
    height,
    label,
    body,
    input.cells.some((cell) => cell.id)
  )
  return { svg, width, height, marks: countMarks(svg) }
}

/** The words for a legend of the strip's colours, in order. */
export function historyLegendWords(): { state: HistoryState; words: string }[] {
  return (Object.keys(HISTORY_WORDS) as HistoryState[]).map((state) => ({
    state,
    words: HISTORY_WORDS[state]
  }))
}
