import { PDF_SANS, PDF_SANS_BOLD, drawPdfText, withPdfTextFallback } from '../../fonts'
import type { Tone } from '../blocks'

/** Page geometry, colours and text helpers for the v2 PDF painter. */

export const INK = '#16181D'
export const MUTED = '#5F6673'
export const FAINT = '#858B97'
export const LINE = '#E1E4E9'
export const PANEL = '#F5F6F8'
export const HEAD = '#EDEFF3'
export const WHITE = '#FFFFFF'
export const DEFAULT_ACCENT = '#C2410C'

/** Page margins. The header sits above `top`, the footer below `bottom`. */
export const MARGINS = { top: 76, right: 50, bottom: 56, left: 50 } as const

const TONES: Record<Exclude<Tone, 'accent'>, string> = {
  blue: '#2A78D6',
  aqua: '#1BAF7A',
  yellow: '#EDA100',
  violet: '#6250D6',
  slate: '#475569',
  gray: '#AEB4BE',
  light: '#E3E6EA'
}

/** Tones dark enough for white text on top. */
const DARK_TONES: ReadonlySet<Tone> = new Set(['accent', 'blue', 'violet', 'slate', 'aqua'])

export interface Painter {
  doc: PDFKit.PDFDocument
  accent: string
}

export function toneColor(painter: Painter, tone: Tone): string {
  return tone === 'accent' ? painter.accent : TONES[tone]
}

export function toneInk(tone: Tone): string {
  return DARK_TONES.has(tone) ? WHITE : INK
}

/** A `#RRGGBB` brand colour, or the default accent when the value is not one. */
export function accentColor(value: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed)
  if (short !== null)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase()
  return DEFAULT_ACCENT
}

/** Mix a `#RRGGBB` colour with white. `amount` 0 is the colour, 1 is white. */
export function tint(color: string, amount: number): string {
  const value = Number.parseInt(color.slice(1), 16)
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount)
  const r = mix((value >> 16) & 255)
  const g = mix((value >> 8) & 255)
  const b = mix(value & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`
}

export function left(painter: Painter): number {
  return painter.doc.page.margins.left
}

export function contentWidth(painter: Painter): number {
  const page = painter.doc.page
  return page.width - page.margins.left - page.margins.right
}

export function bottom(painter: Painter): number {
  return painter.doc.page.height - painter.doc.page.margins.bottom
}

/** True when nothing has been drawn below the header on this page yet. */
export function atPageTop(painter: Painter): boolean {
  return painter.doc.y <= painter.doc.page.margins.top + 0.5
}

/** Start a new page unless `height` points still fit on this one. */
export function ensureSpace(painter: Painter, height: number): void {
  if (painter.doc.y + height > bottom(painter) && !atPageTop(painter)) newPage(painter)
}

export function newPage(painter: Painter): void {
  painter.doc.addPage()
  painter.doc.x = left(painter)
  painter.doc.y = painter.doc.page.margins.top
}

export interface TextStyle {
  size: number
  weight?: 'regular' | 'bold'
  color?: string
  lineGap?: number
  align?: 'left' | 'right' | 'center'
  characterSpacing?: number
}

/** Height of wrapped text at a width. */
export function measure(painter: Painter, text: string, width: number, style: TextStyle): number {
  if (text.length === 0) return 0
  const doc = painter.doc
  doc.font(style.weight === 'bold' ? PDF_SANS_BOLD : PDF_SANS).fontSize(style.size)
  let height = 0
  withPdfTextFallback(doc, () => {
    height = doc.heightOfString(text, {
      width,
      lineGap: style.lineGap ?? 0,
      characterSpacing: style.characterSpacing ?? 0
    })
  })
  return height
}

/** Width of one line of text. */
export function lineWidth(painter: Painter, text: string, style: TextStyle): number {
  const doc = painter.doc
  doc.font(style.weight === 'bold' ? PDF_SANS_BOLD : PDF_SANS).fontSize(style.size)
  let width = 0
  withPdfTextFallback(doc, () => {
    width = doc.widthOfString(text, { characterSpacing: style.characterSpacing ?? 0 })
  })
  return width
}

/** One line cut with an ellipsis so it fits `width`. */
export function fitLine(painter: Painter, text: string, width: number, style: TextStyle): string {
  if (lineWidth(painter, text, style) <= width) return text
  const chars = [...text]
  let low = 0
  let high = chars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (lineWidth(painter, `${chars.slice(0, mid).join('').trimEnd()}…`, style) <= width) low = mid
    else high = mid - 1
  }
  return `${chars.slice(0, low).join('').trimEnd()}…`
}

/** Draw wrapped text at a point. Returns the height used. */
export function write(
  painter: Painter,
  text: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle
): number {
  if (text.length === 0) return 0
  const doc = painter.doc
  doc.fillColor(style.color ?? INK)
  drawPdfText(
    doc,
    text,
    style.weight ?? 'regular',
    style.size,
    {
      width,
      lineGap: style.lineGap ?? 0,
      align: style.align ?? 'left',
      characterSpacing: style.characterSpacing ?? 0
    },
    { x, y }
  )
  const used = doc.y - y
  doc.x = left(painter)
  return used
}

/** Draw a paragraph at the cursor and move the cursor below it. */
export function flow(painter: Painter, text: string, style: TextStyle, after: number): void {
  const width = contentWidth(painter)
  const height = measure(painter, text, width, style)
  ensureSpace(painter, Math.min(height, 120))
  const y = painter.doc.y
  write(painter, text, left(painter), y, width, style)
  painter.doc.y = y + height + after
}
