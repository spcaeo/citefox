import type { TableBlock } from '../blocks'
import {
  HEAD,
  INK,
  LINE,
  MUTED,
  bottom,
  contentWidth,
  ensureSpace,
  left,
  measure,
  newPage,
  tint,
  write,
  type Painter,
  type TextStyle
} from './layout'

/**
 * Tables that fit the page width and break across pages, repeating the header row.
 * A cell's first line is the value; lines after a line break are drawn smaller and muted
 * (a URL under a page title, for example).
 */

const PAD_X = 4
const PAD_Y = 3.5
const METER_TEXT = 30

export function paintTable(painter: Painter, block: TableBlock): void {
  if (block.rows.length === 0) return
  const size = block.size ?? 8
  const widths = columnWidths(painter, block.widths, block.headers.length)
  const headerStyle: TextStyle = { size: size - 0.5, weight: 'bold', color: MUTED }
  const headerHeight =
    Math.max(
      ...block.headers.map((header, index) =>
        measure(painter, header, (widths[index] ?? 0) - PAD_X * 2, headerStyle)
      )
    ) +
    PAD_Y * 2
  const rowHeights = block.rows.map((row) => rowHeight(painter, row, widths, size, block))
  ensureSpace(painter, headerHeight + Math.min(rowHeights[0] ?? 0, 200))
  drawHeader(painter, block, widths, headerHeight, headerStyle)
  block.rows.forEach((row, index) => {
    const height = rowHeights[index] ?? 0
    if (painter.doc.y + height > bottom(painter)) {
      newPage(painter)
      drawHeader(painter, block, widths, headerHeight, headerStyle)
    }
    drawRow(painter, block, row, index, widths, height, size)
  })
  painter.doc.y += 8
}

function columnWidths(painter: Painter, weights: readonly number[], count: number): number[] {
  const width = contentWidth(painter)
  const list = Array.from({ length: count }, (_, index) => Math.max(weights[index] ?? 1, 0.1))
  const sum = list.reduce((total, weight) => total + weight, 0)
  return list.map((weight) => (weight / sum) * width)
}

function splitCell(value: string): { main: string; sub: string } {
  const at = value.indexOf('\n')
  if (at < 0) return { main: value, sub: '' }
  return { main: value.slice(0, at), sub: value.slice(at + 1) }
}

function cellWidth(block: TableBlock, widths: readonly number[], index: number): number {
  const width = (widths[index] ?? 0) - PAD_X * 2
  return block.meter?.column === index ? Math.min(width, METER_TEXT) : width
}

function rowHeight(
  painter: Painter,
  row: readonly string[],
  widths: readonly number[],
  size: number,
  block: TableBlock
): number {
  let tallest = 0
  row.forEach((value, index) => {
    const { main, sub } = splitCell(value)
    const width = cellWidth(block, widths, index)
    const height =
      measure(painter, main, width, { size, lineGap: 1 }) +
      (sub.length === 0 ? 0 : 1 + measure(painter, sub, width, { size: size - 1.5, lineGap: 0.5 }))
    tallest = Math.max(tallest, height)
  })
  return Math.max(tallest, size * 1.2) + PAD_Y * 2
}

function drawHeader(
  painter: Painter,
  block: TableBlock,
  widths: readonly number[],
  height: number,
  style: TextStyle
): void {
  const doc = painter.doc
  const top = doc.y
  doc.save()
  doc.rect(left(painter), top, contentWidth(painter), height).fill(HEAD)
  doc.restore()
  let x = left(painter)
  block.headers.forEach((header, index) => {
    const width = widths[index] ?? 0
    write(painter, header, x + PAD_X, top + PAD_Y, width - PAD_X * 2, {
      ...style,
      align: block.align[index] === 'right' && block.meter?.column !== index ? 'right' : 'left'
    })
    x += width
  })
  doc.y = top + height
}

function drawRow(
  painter: Painter,
  block: TableBlock,
  row: readonly string[],
  rowIndex: number,
  widths: readonly number[],
  height: number,
  size: number
): void {
  const doc = painter.doc
  const top = doc.y
  let x = left(painter)
  row.forEach((value, index) => {
    const width = widths[index] ?? 0
    const meter = block.meter?.column === index ? block.meter.values[rowIndex] : undefined
    const textWidth = cellWidth(block, widths, index)
    const align = block.align[index] === 'right' && meter === undefined ? 'right' : 'left'
    const { main, sub } = splitCell(value)
    const used = write(painter, main, x + PAD_X, top + PAD_Y, textWidth, {
      size,
      color: INK,
      lineGap: 1,
      align
    })
    if (sub.length > 0) {
      write(painter, sub, x + PAD_X, top + PAD_Y + used + 1, textWidth, {
        size: size - 1.5,
        color: MUTED,
        lineGap: 0.5,
        align
      })
    }
    if (meter !== undefined && meter !== null) {
      const barX = x + PAD_X + METER_TEXT + 4
      const barWidth = width - PAD_X * 2 - METER_TEXT - 6
      if (barWidth > 12) {
        const barY = top + PAD_Y + size * 0.35
        const filled = (Math.max(0, Math.min(100, meter)) / 100) * barWidth
        doc.save()
        doc.roundedRect(barX, barY, barWidth, 5, 2.5).fill(tint(painter.accent, 0.85))
        if (filled > 0.5)
          doc.roundedRect(barX, barY, Math.max(filled, 5), 5, 2.5).fill(painter.accent)
        doc.restore()
      }
    }
    x += width
  })
  doc.save()
  doc
    .moveTo(left(painter), top + height)
    .lineTo(left(painter) + contentWidth(painter), top + height)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke()
  doc.restore()
  doc.y = top + height
}
