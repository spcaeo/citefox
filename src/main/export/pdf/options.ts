import PDFDocument from 'pdfkit'
import type { ExportRequest } from '@shared/ipc'
import { PdfFontError, registerPdfFonts } from '../fonts'
import { drawSvg } from './draw'
import { LOGO_UNREADABLE, type PdfLogo } from './common'

/** PDF options and logo checks. Nothing is fetched. */

const MAX_LOGO_BYTES = 8_000_000

const LOGO_TOO_LARGE = {
  reason: 'That logo is too large.',
  nextStep: 'Use an image under 8 MB.'
}

const PDF_OPTIONS_MISSING = {
  reason: 'PDF options are missing.',
  nextStep: 'Choose Letter or A4, and whether to include charts.'
}

const PAGE_SIZE_MISSING = {
  reason: 'Choose Letter or A4.',
  nextStep: 'Pick a page size.'
}

/** FR-22.2. Null and blank mean no logo. PNG, JPG, and SVG only. Nothing is fetched. */
export function parsePdfLogo(
  logoBase64: string | null
): { ok: true; logo: PdfLogo | null } | { ok: false; reason: string; nextStep: string } {
  if (logoBase64 === null) return { ok: true, logo: null }
  const trimmed = logoBase64.trim()
  if (trimmed.length === 0) return { ok: true, logo: null }
  const payload = stripDataUrl(trimmed)
  if (payload === null) return { ok: false, ...LOGO_UNREADABLE }
  const normalized = normalizeBase64(payload)
  if (normalized === null) return { ok: false, ...LOGO_UNREADABLE }
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== normalized) {
    return { ok: false, ...LOGO_UNREADABLE }
  }
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, ...LOGO_TOO_LARGE }
  if (isPng(bytes)) return openRaster(bytes, 'png')
  if (isJpeg(bytes)) return openRaster(bytes, 'jpeg')
  const svg = svgDocument(bytes)
  if (svg !== null) return openSvg(svg)
  return { ok: false, ...LOGO_UNREADABLE }
}

/** Blocks a PDF request that cannot be drawn. Other formats are ignored. */
export function rejectPdfRequest(
  request: ExportRequest
): { reason: string; nextStep: string } | null {
  if (request.format !== 'pdf') return null
  const pdf = request.pdf
  if (pdf === null) return PDF_OPTIONS_MISSING
  if (pdf.pageSize !== 'letter' && pdf.pageSize !== 'a4') return PAGE_SIZE_MISSING
  if (typeof pdf.charts !== 'boolean' || typeof pdf.hideBranding !== 'boolean') {
    return PDF_OPTIONS_MISSING
  }
  if (pdf.preparedFor !== null && typeof pdf.preparedFor !== 'string') {
    return {
      reason: 'Prepared for must be text.',
      nextStep: 'Enter a name, or leave Prepared for empty.'
    }
  }
  const logo = parsePdfLogo(request.logoBase64)
  if (!logo.ok) return { reason: logo.reason, nextStep: logo.nextStep }
  return null
}

function openRaster(
  bytes: Buffer,
  kind: 'png' | 'jpeg'
): { ok: true; logo: PdfLogo } | { ok: false; reason: string; nextStep: string } {
  const doc = new PDFDocument({ autoFirstPage: false })
  doc.on('data', () => undefined)
  doc.on('error', () => undefined)
  try {
    doc.addPage({ size: 'LETTER' })
    doc.image(bytes, 0, 0, { fit: [8, 8] })
    doc.end()
    return { ok: true, logo: { kind, bytes } }
  } catch {
    try {
      doc.end()
    } catch {
      // The document already failed while reading the image.
    }
    return { ok: false, ...LOGO_UNREADABLE }
  }
}

function openSvg(
  text: string
): { ok: true; logo: PdfLogo } | { ok: false; reason: string; nextStep: string } {
  const warnings: string[] = []
  const doc = new PDFDocument({ autoFirstPage: true, size: 'LETTER' })
  doc.on('data', () => undefined)
  doc.on('error', () => undefined)
  try {
    registerPdfFonts(doc)
    drawSvg(doc, text, 0, 0, 16, 16, warnings)
    doc.end()
  } catch (error) {
    if (error instanceof PdfFontError) throw error
    try {
      doc.end()
    } catch {
      // The document already failed while reading the SVG.
    }
    return { ok: false, ...LOGO_UNREADABLE }
  }
  if (warnings.some((warning) => /does not look like a valid SVG|parsing error/i.test(warning))) {
    return { ok: false, ...LOGO_UNREADABLE }
  }
  return { ok: true, logo: { kind: 'svg', text } }
}

function stripDataUrl(value: string): string | null {
  if (!value.toLowerCase().startsWith('data:')) return value.replace(/\s/g, '')
  const match = /^data:image\/(?:png|jpeg|jpg|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value)
  if (match === null) return null
  return (match[1] ?? '').replace(/\s/g, '')
}

function normalizeBase64(value: string): string | null {
  const compact = value.replace(/\s/g, '')
  if (compact.length === 0 || compact.length % 4 === 1) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null
  const remainder = compact.length % 4
  return remainder === 0 ? compact : compact + '='.repeat(4 - remainder)
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function svgDocument(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null
  const text = bytes
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim()
  if (text.length === 0) return null
  const head = text.slice(0, 300).toLowerCase()
  if (
    head.startsWith('<svg') ||
    (head.startsWith('<?xml') && text.toLowerCase().includes('<svg'))
  ) {
    return text
  }
  return null
}
