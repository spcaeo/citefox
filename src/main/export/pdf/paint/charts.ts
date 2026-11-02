import type { BarRow, LegendItem, LineChartBlock, StackedRow } from '../blocks'
import { chartOffsets } from '../draw'
import {
  FAINT,
  INK,
  LINE,
  MUTED,
  WHITE,
  contentWidth,
  ensureSpace,
  fitLine,
  left,
  lineWidth,
  toneColor,
  toneInk,
  write,
  type Painter
} from './layout'

/** Vector charts: labelled bars, stacked bars, and the time-true line chart. */

const ROW = 17
const BAR = 9
const VALUE_WIDTH = 96
const GAP = 1.5

function labelWidth(painter: Painter): number {
  return Math.min(contentWidth(painter) * 0.36, 190)
}

export function paintBars(painter: Painter, rows: readonly BarRow[]): void {
  const doc = painter.doc
  const x = left(painter)
  const labelW = labelWidth(painter)
  const area = contentWidth(painter) - labelW - VALUE_WIDTH - 8
  const max = Math.max(1, ...rows.map((row) => row.value))
  keepTogether(painter, rows.length * ROW + 6)
  for (const row of rows) {
    ensureSpace(painter, ROW)
    const y = doc.y
    const label = { size: 8.5, color: INK } as const
    write(painter, fitLine(painter, row.label, labelW - 8, label), x, y + 2.5, labelW - 8, label)
    const barX = x + labelW
    const width = (row.value / max) * area
    doc.save()
    doc.rect(barX, y + 4, area, BAR).fill('#F1F2F4')
    if (width > 0)
      doc.roundedRect(barX, y + 4, Math.max(width, 3), BAR, 2).fill(toneColor(painter, row.tone))
    doc.restore()
    write(painter, row.display, barX + area + 8, y + 3, VALUE_WIDTH, { size: 8, color: MUTED })
    doc.y = y + ROW
  }
  doc.y += 6
}

export function paintStacked(
  painter: Painter,
  rows: readonly StackedRow[],
  legend: readonly LegendItem[],
  scale: 'max' | 'share'
): void {
  const doc = painter.doc
  const x = left(painter)
  const single = rows.length === 1 && scale === 'share'
  const labelW = single ? 0 : labelWidth(painter)
  const area = contentWidth(painter) - labelW - (single ? 0 : VALUE_WIDTH + 8)
  const height = single ? 18 : 12
  const totals = rows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0))
  const max = Math.max(1, ...totals)
  keepTogether(painter, rows.length * (height + 8) + 24)
  rows.forEach((row, index) => {
    const rowTotal = totals[index] ?? 0
    ensureSpace(painter, height + 10)
    const y = doc.y
    if (!single) {
      const label = { size: 8.5, color: INK } as const
      write(
        painter,
        fitLine(painter, row.label, labelW - 8, label),
        x,
        y + (height - 8.5) / 2,
        labelW - 8,
        label
      )
    }
    const span = scale === 'share' ? area : (rowTotal / max) * area
    let cursor = x + labelW
    doc.save()
    if (rowTotal === 0) doc.rect(cursor, y, area, height).fill('#F1F2F4')
    for (const segment of row.segments) {
      if (segment.value <= 0 || rowTotal === 0) continue
      const width = (segment.value / rowTotal) * span
      const drawn = Math.max(width - GAP, 0.8)
      doc.rect(cursor, y, drawn, height).fill(toneColor(painter, segment.tone))
      const text = String(segment.value)
      const style = {
        size: single ? 8.5 : 7.5,
        weight: 'bold',
        color: toneInk(segment.tone)
      } as const
      if (lineWidth(painter, text, style) + 6 <= drawn) {
        doc.restore()
        write(painter, text, cursor, y + (height - style.size * 1.2) / 2 + 0.5, drawn, {
          ...style,
          align: 'center'
        })
        doc.save()
      }
      cursor += width
    }
    doc.restore()
    if (!single) {
      write(painter, row.display, x + labelW + span + 8, y + (height - 8) / 2, VALUE_WIDTH, {
        size: 8,
        color: MUTED
      })
    }
    doc.y = y + height + (single ? 8 : 6)
  })
  paintLegend(painter, legend)
}

export function paintLegend(
  painter: Painter,
  items: readonly LegendItem[],
  extra: readonly string[] = []
): void {
  const doc = painter.doc
  const x0 = left(painter)
  const width = contentWidth(painter)
  const style = { size: 7.5, color: MUTED } as const
  ensureSpace(painter, 14)
  let x = x0
  let y = doc.y + 2
  const entries = [
    ...items.map((item) => ({ item, text: item.label })),
    ...extra.map((text) => ({ item: null, text }))
  ]
  for (const entry of entries) {
    const textWidth = lineWidth(painter, entry.text, style)
    const need = (entry.item === null ? 0 : 12) + textWidth + 14
    if (x > x0 && x + need > x0 + width) {
      x = x0
      y += 12
    }
    if (entry.item !== null) {
      doc.save()
      doc.roundedRect(x, y + 1, 8, 8, 1.5).fill(toneColor(painter, entry.item.tone))
      if (entry.item.tone === 'light')
        doc
          .roundedRect(x, y + 1, 8, 8, 1.5)
          .lineWidth(0.5)
          .strokeColor('#C9CDD4')
          .stroke()
      doc.restore()
      x += 12
    }
    write(painter, entry.text, x, y + 0.5, textWidth + 2, style)
    x += textWidth + 14
  }
  doc.y = y + 18
}

/** Keep a chart on one page when it fits on a page at all. */
function keepTogether(painter: Painter, height: number): void {
  const page = painter.doc.page
  if (height < page.height - page.margins.top - page.margins.bottom) ensureSpace(painter, height)
}

const PLOT_HEIGHT = 170
const AXIS_WIDTH = 26

export function paintLine(painter: Painter, chart: LineChartBlock): void {
  const doc = painter.doc
  const x0 = left(painter) + AXIS_WIDTH
  const width = contentWidth(painter) - AXIS_WIDTH - 12
  ensureSpace(painter, PLOT_HEIGHT + 70)
  const top = doc.y + 14
  const base = top + PLOT_HEIGHT
  const values = chart.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null)
  )
  const yMax = niceMax(Math.max(1, ...values))
  const yOf = (value: number): number => base - (value / yMax) * PLOT_HEIGHT
  const inset = chart.times.length > 1 ? 10 : 0
  const offsets = chartOffsets(chart.times, Math.max(width - inset * 2, 1)).map(
    (offset) => x0 + inset + offset
  )

  doc.save()
  for (let step = 0; step <= 4; step += 1) {
    const value = (yMax / 4) * step
    const y = yOf(value)
    doc
      .moveTo(x0, y)
      .lineTo(x0 + width, y)
      .lineWidth(step === 0 ? 0.8 : 0.4)
      .strokeColor(step === 0 ? '#B9BEC7' : LINE)
      .stroke()
  }
  doc.restore()
  for (let step = 0; step <= 4; step += 1) {
    const value = (yMax / 4) * step
    write(painter, formatTick(value), left(painter), yOf(value) - 4.5, AXIS_WIDTH - 5, {
      size: 7,
      color: FAINT,
      align: 'right'
    })
  }
  write(painter, chart.yLabel, x0, top - 13, 120, { size: 7, color: FAINT })

  const min = Math.min(...chart.times)
  const max = Math.max(...chart.times)
  for (const marker of chart.markers) {
    if (chart.times.length < 2 || marker.at < min || marker.at > max || max === min) continue
    const mx = x0 + inset + ((marker.at - min) / (max - min)) * (width - inset * 2)
    doc.save()
    doc
      .moveTo(mx, top)
      .lineTo(mx, base)
      .dash(3, { space: 2.5 })
      .lineWidth(0.8)
      .strokeColor(MUTED)
      .stroke()
    doc.undash()
    doc.restore()
    write(painter, marker.label, mx + 3, top + 1, 60, { size: 7, weight: 'bold', color: MUTED })
  }

  for (const series of chart.series) {
    const color = toneColor(painter, series.tone)
    const points = series.values
      .map((value, index) => ({ value, index, x: offsets[index] ?? x0 }))
      .filter((point): point is { value: number; index: number; x: number } => point.value !== null)
    const solid = points.filter((point) => chart.partial[point.index] !== true)
    doc.save()
    solid.forEach((point, index) => {
      if (index === 0) doc.moveTo(point.x, yOf(point.value))
      else doc.lineTo(point.x, yOf(point.value))
    })
    if (solid.length > 1) doc.lineWidth(1.8).strokeColor(color).lineJoin('round').stroke()
    for (const point of points) {
      const hollow = chart.partial[point.index] === true
      doc.circle(point.x, yOf(point.value), 3)
      if (hollow) doc.lineWidth(1.3).fillAndStroke(WHITE, color)
      else doc.lineWidth(1).fillAndStroke(color, WHITE)
    }
    doc.restore()
  }

  let lastLabel = -Infinity
  const labelY = base + 5
  chart.xLabels.forEach((label, index) => {
    const x = offsets[index] ?? x0
    const isLast = index === chart.xLabels.length - 1
    if (x - lastLabel < 58 && !isLast) return
    if (isLast && x - lastLabel < 58 && index > 0) return
    write(painter, label, x - 34, labelY, 68, { size: 7, color: MUTED, align: 'center' })
    lastLabel = x
  })
  doc.y = labelY + 16
  paintLegend(
    painter,
    chart.series.map((series) => ({ tone: series.tone, label: series.label })),
    chart.partial.some(Boolean) ? ['Hollow point: partial check'] : []
  )
}

function niceMax(value: number): number {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = Math.ceil(value / (step * magnitude)) * step * magnitude
    if (candidate / 4 === Math.round(candidate / 4) || step === 10) {
      if (candidate >= value) return candidate
    }
  }
  return Math.ceil(value)
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
