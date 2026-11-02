import { barLength, peakOf, round1 } from './scale'
import {
  countMarks,
  defaultFormat,
  emptyChart,
  FONT,
  fittedText,
  mark,
  rect,
  svgDoc,
  text,
  type ChartCommon,
  type ChartMarkup
} from './svg'

/** One step: tracked → AI answer shown → cited → named. */
export interface FunnelStep {
  id?: string | null
  label: string
  value: number
  /** Drill id for the drop from the step before ("−12 lost here"). */
  lostId?: string | null
}

export interface FunnelInput extends ChartCommon {
  steps: readonly FunnelStep[]
}

export interface FunnelRow {
  value: number
  /** Share of the first step, 0–100 whole. */
  percent: number
  /** How many fell away since the step before (0 for the first step). */
  lost: number
}

/** Each step's share of the first step and the drop from the step before. */
export function funnelRows(steps: readonly FunnelStep[]): FunnelRow[] {
  const first = steps[0]?.value ?? 0
  return steps.map((step, index) => {
    const before = index === 0 ? step.value : (steps[index - 1]?.value ?? 0)
    return {
      value: step.value,
      percent: first > 0 ? Math.round((step.value / first) * 100) : 0,
      lost: index === 0 ? 0 : Math.max(0, before - step.value)
    }
  })
}

const ROW_H = 26
const DROP_H = 20
const BAR_H = 16

/**
 * "Where visibility falls away": one bar per step on the first step's scale, the
 * count and share at the end, and the number lost between two steps.
 */
export function funnelChart(input: FunnelInput): ChartMarkup {
  const { steps, width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  if (steps.length === 0)
    return emptyChart('funnel', width, label, input.emptyText ?? 'No checks yet')
  const rows = funnelRows(steps)
  const labelW = Math.round(Math.min(180, Math.max(110, width * 0.36)))
  const valueRoom = 96
  const barX = labelW + 12
  const span = Math.max(20, width - barX - valueRoom)
  const max = peakOf(steps.map((step) => step.value))
  let body = ''
  let y = 0
  steps.forEach((step, index) => {
    const row = rows[index] ?? { value: 0, percent: 0, lost: 0 }
    if (index > 0) {
      const lostWords = row.lost > 0 ? `−${format(row.lost)} lost here` : 'none lost here'
      const drop = text(barX + 4, y + 14, lostWords, row.lost > 0 ? 'cfc-drop' : 'cfc-sub')
      const prev = steps[index - 1]?.label ?? ''
      body +=
        step.lostId && row.lost > 0
          ? mark(
              {
                id: step.lostId,
                label: `${format(row.lost)} lost between ${prev} and ${step.label}`,
                tip: [`${prev} → ${step.label}`, lostWords],
                titles,
                className: 'cfc-drop-mark'
              },
              rect(barX, y + 1, Math.min(span, 160), DROP_H - 2, 'cfc-row', 4) + drop
            )
          : `<g aria-hidden="true">${drop}</g>`
      y += DROP_H
    }
    const w = barLength(step.value, max, span)
    const share = `${format(step.value)} · ${row.percent}%`
    const inner =
      rect(0, y, width, ROW_H, 'cfc-row', 4) +
      fittedText(0, y + 17, step.label, labelW, 'cfc-label', FONT, 'start', titles) +
      rect(barX, y + (ROW_H - BAR_H) / 2, span, BAR_H, 'cfc-track', 4) +
      rect(
        barX,
        y + (ROW_H - BAR_H) / 2,
        w,
        BAR_H,
        `cfc-bar cfc-t-${index === 0 ? 'muted' : 'target'}`,
        4
      ) +
      text(barX + span + 10, y + 17, share, 'cfc-value')
    body += mark(
      {
        id: step.id,
        label: `${step.label}: ${format(step.value)}, ${row.percent}% of ${steps[0]?.label ?? 'the first step'}`,
        tip: [step.label, share],
        titles
      },
      inner
    )
    y += ROW_H
  })
  const height = round1(y)
  const svg = svgDoc(
    'funnel',
    width,
    height,
    label,
    body,
    steps.some((step) => step.id || step.lostId)
  )
  return { svg, width, height, marks: countMarks(svg) }
}
