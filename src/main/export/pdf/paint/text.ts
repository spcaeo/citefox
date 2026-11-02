import type { CoverBlock, KpiTile } from '../blocks'
import type { PdfLogo } from '../common'
import { drawLogoAt } from './frame'
import {
  FAINT,
  INK,
  LINE,
  MUTED,
  PANEL,
  atPageTop,
  contentWidth,
  ensureSpace,
  fitLine,
  flow,
  left,
  lineWidth,
  measure,
  newPage,
  tint,
  write,
  type Painter
} from './layout'

/** Painters for the cover, headings, paragraphs, KPI tiles, empty states, lists and FAQs. */

export function paintCover(painter: Painter, block: CoverBlock, logo: PdfLogo | null): void {
  const doc = painter.doc
  const x = left(painter)
  const width = contentWidth(painter)
  doc.save()
  doc.rect(0, 0, doc.page.width, 10).fill(painter.accent)
  doc.restore()
  if (logo !== null) drawLogoAt(doc, logo, x, 44, 150, 44)
  let y = 168
  y += write(painter, block.eyebrow.toUpperCase(), x, y, width, {
    size: 9,
    weight: 'bold',
    color: painter.accent,
    characterSpacing: 0.8
  })
  y += 10
  y += write(painter, block.title, x, y, width, { size: 24, weight: 'bold', lineGap: 3 })
  y += 10
  y += write(painter, block.scope, x, y, width, { size: 12, color: MUTED })
  y += 26
  doc.save()
  doc
    .moveTo(x, y)
    .lineTo(x + width, y)
    .lineWidth(0.75)
    .strokeColor(LINE)
    .stroke()
  doc.restore()
  y += 14
  const labelWidth = 130
  for (const fact of block.facts) {
    const valueHeight = measure(painter, fact.value, width - labelWidth, { size: 10, lineGap: 1.5 })
    write(painter, fact.label, x, y + 1, labelWidth - 10, {
      size: 8.5,
      weight: 'bold',
      color: MUTED
    })
    write(painter, fact.value, x + labelWidth, y, width - labelWidth, { size: 10, lineGap: 1.5 })
    y += Math.max(valueHeight, 12) + 9
  }
  doc.y = y
}

export function paintSection(painter: Painter, title: string, description: string): void {
  if (!atPageTop(painter)) newPage(painter)
  const doc = painter.doc
  const x = left(painter)
  const width = contentWidth(painter)
  let y = doc.y
  y += write(painter, title, x, y, width, { size: 21, weight: 'bold' })
  y += 5
  doc.save()
  doc.rect(x, y, 34, 3).fill(painter.accent)
  doc.restore()
  y += 11
  y += write(painter, description, x, y, width, { size: 9.5, color: MUTED, lineGap: 1.5 })
  doc.y = y + 14
}

export function paintH2(painter: Painter, text: string): void {
  ensureSpace(painter, 60)
  if (!atPageTop(painter)) painter.doc.y += 12
  flow(painter, text, { size: 12.5, weight: 'bold' }, 6)
}

export function paintH3(painter: Painter, text: string): void {
  ensureSpace(painter, 40)
  if (!atPageTop(painter)) painter.doc.y += 5
  flow(painter, text, { size: 9.5, weight: 'bold', lineGap: 1 }, 3)
}

export function paintParagraph(
  painter: Painter,
  text: string,
  tone: 'lead' | 'body' | 'muted'
): void {
  if (tone === 'lead') {
    flow(painter, text, { size: 11.5, lineGap: 2.5 }, 10)
    return
  }
  if (tone === 'muted') {
    flow(painter, text, { size: 8, color: MUTED, lineGap: 1.2 }, 4)
    return
  }
  flow(painter, text, { size: 9, lineGap: 1.5 }, 5)
}

const TILE_GAP = 8
const TILE_PAD = 9

export function paintKpis(painter: Painter, tiles: readonly KpiTile[]): void {
  const perRow = tiles.length <= 4 ? tiles.length : 3
  for (let start = 0; start < tiles.length; start += perRow) {
    paintTileRow(painter, tiles.slice(start, start + perRow))
  }
  painter.doc.y += 6
}

function paintTileRow(painter: Painter, tiles: readonly KpiTile[]): void {
  const doc = painter.doc
  const width = contentWidth(painter)
  const tileWidth = (width - TILE_GAP * (tiles.length - 1)) / tiles.length
  const inner = tileWidth - TILE_PAD * 2
  const laid = tiles.map((tile) => {
    const valueSize = fitSize(painter, tile.value, inner)
    const label = measure(painter, tile.label.toUpperCase(), inner, labelStyle)
    const detail = tile.detail === null ? 0 : measure(painter, tile.detail, inner, detailStyle) + 2
    const definition =
      tile.definition === null ? 0 : measure(painter, tile.definition, inner, definitionStyle) + 5
    return { tile, valueSize, height: label + 4 + valueSize * 1.25 + 2 + detail + definition }
  })
  const height = Math.max(...laid.map((item) => item.height)) + TILE_PAD * 2
  ensureSpace(painter, height + TILE_GAP)
  const top = doc.y
  laid.forEach((item, index) => {
    const x = left(painter) + index * (tileWidth + TILE_GAP)
    doc.save()
    doc
      .roundedRect(x, top, tileWidth, height, 4)
      .fill(item.tile.accent ? tint(painter.accent, 0.9) : PANEL)
    if (item.tile.accent) doc.rect(x, top + 4, 2.5, height - 8).fill(painter.accent)
    doc.restore()
    const textX = x + TILE_PAD
    let y = top + TILE_PAD
    y += write(painter, item.tile.label.toUpperCase(), textX, y, inner, labelStyle) + 4
    write(
      painter,
      fitLine(painter, item.tile.value, inner, { size: item.valueSize, weight: 'bold' }),
      textX,
      y,
      inner,
      {
        size: item.valueSize,
        weight: 'bold',
        color: item.tile.accent ? painter.accent : INK
      }
    )
    y += item.valueSize * 1.25 + 2
    if (item.tile.detail !== null)
      y += write(painter, item.tile.detail, textX, y, inner, detailStyle) + 2
    if (item.tile.definition !== null)
      write(painter, item.tile.definition, textX, y + 3, inner, definitionStyle)
  })
  doc.y = top + height + TILE_GAP
}

const labelStyle = { size: 7, weight: 'bold', color: MUTED, characterSpacing: 0.4 } as const
const detailStyle = { size: 8, color: INK } as const
const definitionStyle = { size: 7, color: FAINT, lineGap: 0.8 } as const

/** The largest value size from 18 down to 10 that keeps the value on one line. */
function fitSize(painter: Painter, value: string, width: number): number {
  for (let size = 18; size > 10; size -= 1) {
    if (lineWidth(painter, value, { size, weight: 'bold' }) <= width) return size
  }
  return 10
}

export function paintEmpty(
  painter: Painter,
  block: { title: string; message: string; nextStep: string | null }
): void {
  const doc = painter.doc
  const width = contentWidth(painter)
  const inner = width - 36
  const next = block.nextStep === null ? null : `Next step: ${block.nextStep}`
  const height =
    measure(painter, block.title, inner, { size: 12.5, weight: 'bold' }) +
    8 +
    measure(painter, block.message, inner, { size: 9.5, lineGap: 1.5 }) +
    (next === null ? 0 : 8 + measure(painter, next, inner, { size: 9, weight: 'bold' })) +
    36
  ensureSpace(painter, height)
  const x = left(painter)
  const top = doc.y
  doc.save()
  doc.roundedRect(x, top, width, height, 6).fill(PANEL)
  doc
    .roundedRect(x, top, width, height, 6)
    .dash(3, { space: 3 })
    .lineWidth(0.8)
    .strokeColor('#C9CDD4')
    .stroke()
  doc.undash()
  doc.restore()
  let y = top + 18
  y += write(painter, block.title, x + 18, y, inner, { size: 12.5, weight: 'bold' }) + 8
  y += write(painter, block.message, x + 18, y, inner, { size: 9.5, color: MUTED, lineGap: 1.5 })
  if (next !== null)
    write(painter, next, x + 18, y + 8, inner, { size: 9, weight: 'bold', color: painter.accent })
  doc.y = top + height + 12
}

export function paintList(painter: Painter, items: readonly string[]): void {
  const x = left(painter)
  const width = contentWidth(painter)
  items.forEach((item, index) => {
    const height = measure(painter, item, width - 22, { size: 9, lineGap: 1.5 })
    ensureSpace(painter, height + 6)
    const y = painter.doc.y
    painter.doc.save()
    painter.doc.circle(x + 7, y + 6, 7).fill(tint(painter.accent, 0.85))
    painter.doc.restore()
    write(painter, String(index + 1), x, y + 1.8, 14, {
      size: 7.5,
      weight: 'bold',
      color: painter.accent,
      align: 'center'
    })
    write(painter, item, x + 22, y, width - 22, { size: 9, lineGap: 1.5 })
    painter.doc.y = y + Math.max(height, 14) + 6
  })
  painter.doc.y += 2
}

export function paintFaq(
  painter: Painter,
  block: { question: string; answer: string; words: string }
): void {
  const doc = painter.doc
  const width = contentWidth(painter)
  const inner = width - 28
  const height =
    10 +
    measure(painter, 'DRAFT FAQ', inner, labelStyle) +
    4 +
    measure(painter, block.question, inner, { size: 9.5, weight: 'bold' }) +
    4 +
    measure(painter, block.answer, inner, { size: 9, lineGap: 1.5 }) +
    4 +
    measure(painter, block.words, inner, { size: 7.5 }) +
    10
  ensureSpace(painter, height + 8)
  const x = left(painter)
  const top = doc.y
  doc.save()
  doc.roundedRect(x, top, width, height, 4).fill(PANEL)
  doc.rect(x, top, 3, height).fill(painter.accent)
  doc.restore()
  let y = top + 10
  y += write(painter, 'DRAFT FAQ', x + 14, y, inner, labelStyle) + 4
  y += write(painter, block.question, x + 14, y, inner, { size: 9.5, weight: 'bold' }) + 4
  y += write(painter, block.answer, x + 14, y, inner, { size: 9, lineGap: 1.5 }) + 4
  write(painter, block.words, x + 14, y, inner, { size: 7.5, color: MUTED })
  doc.y = top + height + 10
}
