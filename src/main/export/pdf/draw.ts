import SVGtoPDF from 'svg-to-pdfkit'
import { PDF_SANS, PDF_SANS_BOLD } from '../fonts'

/** X positions from 0 through `width`, spaced by the real time between checks (NFR-15). */
export function chartOffsets(times: readonly number[], width: number): number[] {
  if (times.length === 0 || width < 0) return []
  if (times.length === 1) return [width / 2]
  let min = times[0] ?? 0
  let max = min
  for (const time of times) {
    if (!Number.isFinite(time)) continue
    if (time < min) min = time
    if (time > max) max = time
  }
  if (max === min) {
    const slot = width / times.length
    return times.map((_, index) => slot * (index + 0.5))
  }
  const span = max - min
  return times.map((time) => ((time - min) / span) * width)
}

export function drawSvg(
  doc: PDFKit.PDFDocument,
  svg: string,
  x: number,
  y: number,
  width: number,
  height: number,
  warnings: string[]
): void {
  SVGtoPDF(doc, svg, x, y, {
    width,
    height,
    assumePt: true,
    preserveAspectRatio: 'xMinYMin meet',
    warningCallback: (message) => {
      warnings.push(message)
    },
    imageCallback: () => '',
    fontCallback: safeSvgFont
  })
}

function safeSvgFont(family: string, bold: boolean, italic: boolean): string {
  void family
  void italic
  return bold ? PDF_SANS_BOLD : PDF_SANS
}
