import type { ReportBlock } from '../blocks'
import type { PdfLogo } from '../common'
import { paintBars, paintLine, paintStacked } from './charts'
import { ensureSpace, type Painter } from './layout'
import { paintTable } from './table'
import {
  paintCover,
  paintEmpty,
  paintFaq,
  paintH2,
  paintH3,
  paintKpis,
  paintList,
  paintParagraph,
  paintSection
} from './text'

export { drawPageFooter, drawPageHeader, type Frame } from './frame'
export { MARGINS, accentColor, type Painter } from './layout'

/** Draw one block at the cursor. */
export function paintBlock(painter: Painter, block: ReportBlock, logo: PdfLogo | null): void {
  switch (block.kind) {
    case 'cover':
      paintCover(painter, block, logo)
      return
    case 'section':
      paintSection(painter, block.title, block.description)
      return
    case 'h2':
      paintH2(painter, block.text)
      return
    case 'h3':
      paintH3(painter, block.text)
      return
    case 'p':
      paintParagraph(painter, block.text, block.tone)
      return
    case 'kpis':
      paintKpis(painter, block.tiles)
      return
    case 'bars':
      paintBars(painter, block.rows)
      return
    case 'stacked':
      paintStacked(painter, block.rows, block.legend, block.scale)
      return
    case 'line':
      paintLine(painter, block)
      return
    case 'table':
      paintTable(painter, block)
      return
    case 'empty':
      paintEmpty(painter, block)
      return
    case 'list':
      paintList(painter, block.items)
      return
    case 'faq':
      paintFaq(painter, block)
  }
}

/**
 * Keep a heading with what follows it: the notes under it and the first chart, table
 * rows or tiles. Estimates are generous rather than exact.
 */
export function keepWithNext(
  painter: Painter,
  blocks: readonly ReportBlock[],
  index: number
): void {
  const block = blocks[index]
  if (block === undefined || (block.kind !== 'h2' && block.kind !== 'h3')) return
  let height = block.kind === 'h2' ? 34 : 22
  for (let next = index + 1; next < blocks.length; next += 1) {
    const following = blocks[next]
    if (following === undefined) break
    height += estimate(following)
    if (following.kind !== 'p') break
  }
  const page = painter.doc.page
  ensureSpace(painter, Math.min(height, page.height - page.margins.top - page.margins.bottom))
}

function estimate(block: ReportBlock): number {
  switch (block.kind) {
    case 'p':
      return block.tone === 'lead' ? 44 : 22
    case 'bars':
      return block.rows.length * 17 + 6
    case 'stacked':
      return block.rows.length * 20 + 26
    case 'line':
      return 270
    case 'kpis':
      return 96
    case 'table':
      return 24 + Math.min(block.rows.length, 3) * 26
    case 'faq':
      return 110
    case 'list':
      return Math.min(block.items.length, 2) * 22
    default:
      return 40
  }
}
