import { percentShares, round1 } from './scale'
import {
  countMarks,
  defaultFormat,
  emptyChart,
  mark,
  n,
  svgDoc,
  text,
  type ChartCommon,
  type ChartMarkup,
  type ChartTone
} from './svg'

export interface DonutPart {
  id?: string | null
  label: string
  value: number
  tone: ChartTone
}

export interface DonutInput extends ChartCommon {
  parts: readonly DonutPart[]
  /** Words in the hole under the total, e.g. "answers". */
  centerWords?: string
}

const SIZE = 168
const RING = 26

/** One ring segment from angle `a0` to `a1` (radians, 0 at the top, clockwise). */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  inner: number,
  a0: number,
  a1: number
): string {
  // A full ring cannot be one arc: draw it as two halves.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI
    return `${arcPath(cx, cy, r, inner, a0, mid)}${arcPath(cx, cy, r, inner, mid, a1)}`
  }
  const point = (radius: number, angle: number): string =>
    `${n(cx + radius * Math.sin(angle))} ${n(cy - radius * Math.cos(angle))}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return (
    `M${point(r, a0)}A${n(r)} ${n(r)} 0 ${large} 1 ${point(r, a1)}` +
    `L${point(inner, a1)}A${n(inner)} ${n(inner)} 0 ${large} 0 ${point(inner, a0)}Z`
  )
}

/**
 * A ring cut into parts that add up to the whole (share of voice: you, named
 * competitors, other sites only). The total sits in the hole; the legend to the
 * right names each part with its count and share. Each part drills.
 */
export function donutChart(input: DonutInput): ChartMarkup {
  const { width, label } = input
  const format = input.format ?? defaultFormat
  const titles = input.titles ?? true
  const total = input.parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  if (total <= 0) return emptyChart('donut', width, label, input.emptyText ?? 'Nothing to show yet')
  const size = Math.min(SIZE, Math.max(120, width * 0.4))
  const r = size / 2 - 2
  const inner = r - RING
  const cx = size / 2
  const cy = size / 2
  const shares = percentShares(input.parts.map((part) => Math.max(0, part.value)))
  let angle = 0
  let ring = ''
  input.parts.forEach((part, index) => {
    if (part.value <= 0) return
    const sweep = (part.value / total) * Math.PI * 2
    const share = shares[index] ?? 0
    const words = `${part.label}: ${format(part.value)} (${share}%)`
    ring += mark(
      { id: part.id, label: words, tip: [part.label, `${format(part.value)} · ${share}%`], titles },
      `<path class="cfc-seg cfc-t-${part.tone}" d="${arcPath(cx, cy, r, inner, angle, angle + sweep)}"/>`
    )
    angle += sweep
  })
  let body =
    ring +
    text(cx, cy + 2, format(total), 'cfc-donut-total', 'middle') +
    (input.centerWords ? text(cx, cy + 18, input.centerWords, 'cfc-legend', 'middle') : '')
  // Legend beside the ring (under it when narrow).
  const side = width >= size + 180
  const x = side ? size + 24 : 0
  let y = side ? Math.max(8, cy - (input.parts.length * 22) / 2) : size + 12
  input.parts.forEach((part, index) => {
    const words = `${part.label}: ${format(part.value)} · ${shares[index] ?? 0}%`
    body += `<g aria-hidden="true"><rect class="cfc-swatch cfc-t-${part.tone}" x="${n(x)}" y="${n(y + 2)}" width="10" height="10" rx="3"/>${text(x + 16, y + 11, words, 'cfc-legend')}</g>`
    y += 22
  })
  const height = round1(side ? Math.max(size, y) : y)
  const svg = svgDoc(
    'donut',
    width,
    height,
    `${label}: ${format(total)} in all`,
    body,
    input.parts.some((part) => part.id && part.value > 0)
  )
  return { svg, width, height, marks: countMarks(svg) }
}
