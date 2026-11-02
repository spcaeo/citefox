import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openSync } from 'fontkit'
import PDFDocument from 'pdfkit'

/**
 * Playwright loads main-process source as CommonJS, and `import.meta` is a
 * syntax error there. The electron-vite bundle is CommonJS too, so `__dirname`
 * is `out/main` next to the copied fonts. Vitest loads this file as ESM and
 * throws on `__dirname`; resolution then uses the working directory.
 */
declare const __dirname: string

/**
 * Embedded report fonts. Noto Sans covers Latin, Greek, and Cyrillic.
 * Noto Sans SC covers Han and kana. Noto Sans KR covers Hangul.
 * A character uses the first face that has a glyph. Anything else becomes "?".
 * Bold Latin uses Noto Sans Bold. CJK faces ship as regular only, so a bold
 * run of Han, kana, or Hangul stays on the regular CJK file.
 */

export const PDF_FONT_FILES = {
  sansRegular: 'NotoSans-Regular.ttf',
  sansBold: 'NotoSans-Bold.ttf',
  cjk: 'NotoSansSC-Regular.woff',
  hangul: 'NotoSansKR-Regular.woff'
} as const

export const PDF_SANS = 'CiteFoxSans'
export const PDF_SANS_BOLD = 'CiteFoxSans-Bold'
export const PDF_CJK = 'CiteFoxCJK'
export const PDF_HANGUL = 'CiteFoxHangul'

export type PdfFontFace = 'sans' | 'cjk' | 'hangul'
export type PdfFontWeight = 'regular' | 'bold'

export interface PdfTextRun {
  face: PdfFontFace
  text: string
}

export interface PdfFontCoverage {
  has(face: PdfFontFace, codePoint: number): boolean
}

export class PdfFontError extends Error {
  readonly nextStep: string

  constructor(reason: string, nextStep: string) {
    super(reason)
    this.name = 'PdfFontError'
    this.nextStep = nextStep
  }
}

const FONT_MISSING = {
  reason: 'The report font is missing.',
  nextStep: 'Reinstall CiteFox and try the export again.'
}

const FONT_UNREADABLE = {
  reason: 'The report font could not be read.',
  nextStep: 'Reinstall CiteFox and try the export again.'
}

const INHERIT_CODE = new Set([0x09, 0x0a, 0x0d, 0x20])

let cachedCoverage: { directory: string; coverage: PdfFontCoverage } | null = null

/** Directory of this module in CommonJS. Absent under the ESM test runner. */
function moduleDirectory(): string {
  try {
    if (typeof __dirname === 'string' && __dirname.length > 0) return __dirname
  } catch {
    return process.cwd()
  }
  return process.cwd()
}

/** Directory that holds the four font files and OFL.txt. */
export function resolvePdfFontDirectory(): string {
  const here = moduleDirectory()
  const candidates = [
    join(here, 'fonts'),
    join(here, '..', '..', 'resources', 'fonts'),
    join(here, '..', '..', '..', 'resources', 'fonts'),
    join(process.cwd(), 'resources', 'fonts')
  ]
  const resources = packagedResourcesPath()
  if (resources !== undefined) candidates.push(join(resources, 'fonts'))
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, PDF_FONT_FILES.sansRegular)) &&
      existsSync(join(candidate, PDF_FONT_FILES.cjk))
    ) {
      return candidate
    }
  }
  throw new PdfFontError(FONT_MISSING.reason, FONT_MISSING.nextStep)
}

export function pdfFontCoverage(directory = resolvePdfFontDirectory()): PdfFontCoverage {
  if (cachedCoverage?.directory === directory) return cachedCoverage.coverage
  const coverage = loadCoverage(directory)
  cachedCoverage = { directory, coverage }
  return coverage
}

export function pdfFontName(face: PdfFontFace, weight: PdfFontWeight): string {
  if (face === 'cjk') return PDF_CJK
  if (face === 'hangul') return PDF_HANGUL
  return weight === 'bold' ? PDF_SANS_BOLD : PDF_SANS
}

/** Split text into font runs. Unsupported code points are counted and drawn as "?". */
export function shapePdfText(
  value: string,
  coverage: PdfFontCoverage
): { text: string; replaced: number; runs: PdfTextRun[] } {
  let text = ''
  let replaced = 0
  const runs: PdfTextRun[] = []
  let face: PdfFontFace | null = null
  let chunk = ''

  const push = (): void => {
    if (chunk.length === 0 || face === null) return
    const last = runs[runs.length - 1]
    if (last !== undefined && last.face === face) last.text += chunk
    else runs.push({ face, text: chunk })
    chunk = ''
  }

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    let next: PdfFontFace
    let drawn = char
    if (INHERIT_CODE.has(code)) {
      next = face ?? 'sans'
    } else if (coverage.has('sans', code)) {
      next = 'sans'
    } else if (coverage.has('cjk', code)) {
      next = 'cjk'
    } else if (coverage.has('hangul', code)) {
      next = 'hangul'
    } else {
      next = face ?? 'sans'
      drawn = '?'
      replaced += 1
    }
    if (face !== null && next !== face) push()
    face = next
    chunk += drawn
    text += drawn
  }
  push()
  return { text, replaced, runs }
}

export function registerPdfFonts(
  doc: PDFKit.PDFDocument,
  directory = resolvePdfFontDirectory()
): void {
  doc.registerFont(PDF_SANS, join(directory, PDF_FONT_FILES.sansRegular))
  doc.registerFont(PDF_SANS_BOLD, join(directory, PDF_FONT_FILES.sansBold))
  doc.registerFont(PDF_CJK, join(directory, PDF_FONT_FILES.cjk))
  doc.registerFont(PDF_HANGUL, join(directory, PDF_FONT_FILES.hangul))
}

export function drawPdfText(
  doc: PDFKit.PDFDocument,
  text: string,
  weight: PdfFontWeight,
  size: number,
  options: PDFKit.Mixins.TextOptions,
  origin?: { x: number; y: number }
): void {
  const runs = shapePdfText(text, pdfFontCoverage()).runs
  if (runs.length === 0) {
    doc.font(pdfFontName('sans', weight)).fontSize(size)
    if (origin !== undefined) doc.text(text, origin.x, origin.y, options)
    else doc.text(text, options)
    return
  }
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    if (run === undefined) continue
    doc.font(pdfFontName(run.face, weight)).fontSize(size)
    const next = { ...options, continued: index < runs.length - 1 || options.continued === true }
    if (index === 0 && origin !== undefined) doc.text(run.text, origin.x, origin.y, next)
    else doc.text(run.text, next)
  }
}

interface PdfTextHost {
  font(name: string): PdfTextHost
  fontSize(size: number): PdfTextHost
  text(
    text: string,
    x?: number | PDFKit.Mixins.TextOptions,
    y?: number | PDFKit.Mixins.TextOptions,
    options?: PDFKit.Mixins.TextOptions
  ): PdfTextHost
  widthOfString(text: string, options?: PDFKit.Mixins.TextOptions): number
  _fontSource?: unknown
  _fontSize: number
}

/**
 * pdfkit tables draw each cell with one font. While `draw` runs, measure and
 * paint with the same run splitting as the rest of the report.
 */
export function withPdfTextFallback(doc: PDFKit.PDFDocument, draw: () => void): void {
  const host = doc as PDFKit.PDFDocument & PdfTextHost
  const originalText = host.text.bind(host)
  const originalWidth = host.widthOfString.bind(host)
  host.widthOfString = (value, options) =>
    measureRuns(host, String(value ?? ''), originalWidth, options)
  host.text = ((text, x, y, options) =>
    writeRuns(host, originalText, String(text), x, y, options)) as typeof host.text
  try {
    draw()
  } finally {
    host.text = originalText
    host.widthOfString = originalWidth
  }
}

/** One page, for tests. Uses the same registration and run splitting as a report. */
export function renderPdfTextSample(text: string, directory?: string): Promise<Buffer> {
  const fonts = directory ?? resolvePdfFontDirectory()
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 72, right: 48, bottom: 48, left: 48 }
  })
  registerPdfFonts(doc, fonts)
  pdfFontCoverage(fonts)
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    doc.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    doc.on('error', () => {
      reject(new PdfFontError(FONT_UNREADABLE.reason, FONT_UNREADABLE.nextStep))
    })
  })
  drawPdfText(doc, text, 'regular', 16, { width: 500 })
  drawPdfText(doc, text, 'bold', 16, { width: 500 })
  doc.end()
  return done
}

function packagedResourcesPath(): string | undefined {
  const value: unknown = Reflect.get(process, 'resourcesPath')
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function loadCoverage(directory: string): PdfFontCoverage {
  const sets = {
    sans: readCharacterSet(join(directory, PDF_FONT_FILES.sansRegular)),
    cjk: readCharacterSet(join(directory, PDF_FONT_FILES.cjk)),
    hangul: readCharacterSet(join(directory, PDF_FONT_FILES.hangul))
  }
  return {
    has(face, codePoint) {
      return sets[face].has(codePoint)
    }
  }
}

function readCharacterSet(file: string): Set<number> {
  try {
    return new Set(openSync(file).characterSet)
  } catch {
    throw new PdfFontError(FONT_UNREADABLE.reason, FONT_UNREADABLE.nextStep)
  }
}

function fontNameFromSource(source: unknown): string {
  if (typeof source !== 'string') return PDF_SANS
  if (source.endsWith(PDF_FONT_FILES.sansBold)) return PDF_SANS_BOLD
  if (source.endsWith(PDF_FONT_FILES.cjk)) return PDF_CJK
  if (source.endsWith(PDF_FONT_FILES.hangul)) return PDF_HANGUL
  return PDF_SANS
}

function weightFromSource(source: unknown): PdfFontWeight {
  return typeof source === 'string' && source.endsWith(PDF_FONT_FILES.sansBold) ? 'bold' : 'regular'
}

function measureRuns(
  host: PdfTextHost,
  value: string,
  originalWidth: (text: string, options?: PDFKit.Mixins.TextOptions) => number,
  options: PDFKit.Mixins.TextOptions | undefined
): number {
  const size = host._fontSize
  const restore = fontNameFromSource(host._fontSource)
  const weight = weightFromSource(host._fontSource)
  const runs = shapePdfText(value, pdfFontCoverage()).runs
  if (runs.length === 0) return originalWidth(value, options)
  let total = 0
  for (const run of runs) {
    host.font(pdfFontName(run.face, weight)).fontSize(size)
    total += originalWidth(run.text, options)
  }
  host.font(restore).fontSize(size)
  return total
}

function writeRuns(
  host: PdfTextHost,
  originalText: PdfTextHost['text'],
  text: string,
  x: number | PDFKit.Mixins.TextOptions | undefined,
  y: number | PDFKit.Mixins.TextOptions | undefined,
  options: PDFKit.Mixins.TextOptions | undefined
): PdfTextHost {
  const parsed = parseTextCall(text, x, y, options)
  const size = host._fontSize
  const weight = weightFromSource(host._fontSource)
  const runs = shapePdfText(parsed.text, pdfFontCoverage()).runs
  if (runs.length === 0) {
    callText(originalText, parsed)
    return host
  }
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    if (run === undefined) continue
    host.font(pdfFontName(run.face, weight)).fontSize(size)
    const next = {
      ...parsed.options,
      continued: index < runs.length - 1 || parsed.options?.continued === true
    }
    if (index === 0) callText(originalText, { ...parsed, text: run.text, options: next })
    else originalText(run.text, next)
  }
  return host
}

function parseTextCall(
  text: string,
  x: number | PDFKit.Mixins.TextOptions | undefined,
  y: number | PDFKit.Mixins.TextOptions | undefined,
  options: PDFKit.Mixins.TextOptions | undefined
): { text: string; x?: number; y?: number; options?: PDFKit.Mixins.TextOptions } {
  if (typeof x === 'object') return { text, options: x }
  if (typeof y === 'object') return { text, x, options: y }
  return { text, x, y, options }
}

function callText(
  originalText: PdfTextHost['text'],
  parsed: { text: string; x?: number; y?: number; options?: PDFKit.Mixins.TextOptions }
): void {
  if (parsed.x !== undefined && parsed.y !== undefined) {
    originalText(parsed.text, parsed.x, parsed.y, parsed.options)
    return
  }
  if (parsed.x !== undefined) {
    originalText(parsed.text, parsed.x, parsed.options)
    return
  }
  originalText(parsed.text, parsed.options)
}
