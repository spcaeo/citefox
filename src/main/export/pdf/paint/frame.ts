import { LOGO_UNREADABLE, PdfReportError, type PdfLogo } from '../common'
import { drawSvg } from '../draw'
import { FAINT, LINE, MUTED, fitLine, write, type Painter } from './layout'

/** The running header and footer on every page after the cover, and the logo. */

export interface Frame {
  logo: PdfLogo | null
  /** Left of the header when there is no logo, such as `example.com · AI visibility report`. */
  title: string
  /** "Prepared for Northwind Ops", or empty. */
  prepared: string
  /** "Built with CiteFox", or empty when branding is hidden. */
  branding: string
}

export function drawLogoAt(
  doc: PDFKit.PDFDocument,
  logo: PdfLogo,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  try {
    if (logo.kind === 'svg') {
      drawSvg(doc, logo.text, x, y, width, height, [])
      return
    }
    doc.image(logo.bytes, x, y, { fit: [width, height] })
  } catch {
    throw new PdfReportError(LOGO_UNREADABLE.reason, LOGO_UNREADABLE.nextStep)
  }
}

/** Drawn outside the margins, so the cursor and margins are restored afterwards. */
export function drawPageHeader(painter: Painter, frame: Frame): void {
  withoutMargins(painter, () => {
    const doc = painter.doc
    const page = doc.page
    const x = page.margins.left
    const width = page.width - page.margins.left - page.margins.right
    const right = frame.prepared.length > 0 ? Math.min(220, width / 2) : 0
    if (frame.logo !== null) {
      drawLogoAt(doc, frame.logo, x, 26, 110, 24)
    } else {
      const style = { size: 8, color: MUTED } as const
      write(
        painter,
        fitLine(painter, frame.title, width - right - 12, style),
        x,
        34,
        width - right - 12,
        style
      )
    }
    if (right > 0) {
      const style = { size: 8, color: MUTED, align: 'right' } as const
      write(
        painter,
        fitLine(painter, frame.prepared, right, style),
        x + width - right,
        34,
        right,
        style
      )
    }
    doc.save()
    doc
      .moveTo(x, 56)
      .lineTo(x + width, 56)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke()
    doc.restore()
  })
}

export function drawPageFooter(
  painter: Painter,
  frame: Frame,
  pageNumber: number,
  pageTotal: number
): void {
  withoutMargins(painter, () => {
    const doc = painter.doc
    const page = doc.page
    const x = page.margins.left
    const width = page.width - page.margins.left - page.margins.right
    const y = page.height - 34
    const style = { size: 7.5, color: FAINT } as const
    if (frame.branding.length > 0) write(painter, frame.branding, x, y, 200, style)
    write(painter, `${pageNumber} / ${pageTotal}`, x + width - 80, y, 80, {
      ...style,
      align: 'right'
    })
  })
}

function withoutMargins(painter: Painter, draw: () => void): void {
  const doc = painter.doc
  const page = doc.page
  const saved = { ...page.margins }
  const x = doc.x
  const y = doc.y
  page.margins.top = 0
  page.margins.bottom = 0
  try {
    draw()
  } finally {
    page.margins.top = saved.top
    page.margins.bottom = saved.bottom
    doc.x = x
    doc.y = y
  }
}
