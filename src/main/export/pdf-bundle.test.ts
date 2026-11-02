import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PDF_FONT_FILES, drawPdfText, registerPdfFonts } from './fonts'
import {
  extractPdfText,
  pdfEmbeddedFontNames,
  pdfHasEmbeddedFontFile
} from './pdf-inspect.test-helper'

const bundlePath = join(process.cwd(), 'out/main/index.js')

interface BundleDoc {
  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
  font(name: string): BundleDoc
  text(value: string): void
  end(): void
}

const UNICODE_SAMPLE = 'Café Привет 日本語'

/**
 * `npm test` builds, then `test:e2e` runs this file. Unit runs skip it when `out/`
 * is not there yet. The main electron-vite build externalizes dependencies, so the
 * bundle must `require("pdfkit")` and `require("svg-to-pdfkit")` and those packages
 * must still be able to write a PDF from that file's location.
 */
describe('built main bundle', () => {
  test('writes a PDF with the external pdfkit required by out/main', async (context) => {
    if (!existsSync(bundlePath)) {
      context.skip(true, 'out/main/index.js is absent. Run npm run build before this check.')
      return
    }

    const source = readFileSync(bundlePath, 'utf8')
    expect(source).toContain('require("pdfkit")')
    expect(source).toContain('require("svg-to-pdfkit")')
    expect(source).not.toContain('class PDFDocument')
    expect(source).not.toContain('SVGElemImage')

    const bundleRequire = createRequire(bundlePath)
    const PDFDocument = bundleRequire('pdfkit') as new (options?: { size?: string }) => BundleDoc
    const svgToPdf = bundleRequire('svg-to-pdfkit') as (
      doc: BundleDoc,
      svg: string,
      x: number,
      y: number,
      options: { width: number; height: number; assumePt: boolean }
    ) => void

    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'LETTER' })
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      doc.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
      doc.on('error', () => {
        reject(new Error('pdfkit failed while writing from the built bundle'))
      })
    })
    doc.font('Helvetica').text('Built bundle PDF')
    svgToPdf(
      doc,
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#c2410c"/></svg>',
      72,
      40,
      { width: 8, height: 8, assumePt: true }
    )
    doc.end()

    const pdf = await done
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(extractPdfText(pdf)).toContain('Built bundle PDF')
  })

  test('embeds the shipped fonts and round-trips CJK, Cyrillic, and accented text', async (context) => {
    if (!existsSync(bundlePath)) {
      context.skip(true, 'out/main/index.js is absent. Run npm run build before this check.')
      return
    }

    const source = readFileSync(bundlePath, 'utf8')
    const fontDir = join(dirname(bundlePath), 'fonts')
    expect(source).toMatch(/require\(["']fontkit["']\)/)
    for (const name of Object.values(PDF_FONT_FILES)) {
      expect(source).toContain(name)
      expect(existsSync(join(fontDir, name))).toBe(true)
    }
    expect(existsSync(join(fontDir, 'OFL.txt'))).toBe(true)

    const bundleRequire = createRequire(bundlePath)
    const PDFDocument = bundleRequire('pdfkit') as new (options?: { size?: string }) => BundleDoc
    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'LETTER' })
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      doc.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
      doc.on('error', () => {
        reject(new Error('pdfkit failed while writing Unicode from the built bundle'))
      })
    })
    registerPdfFonts(doc as unknown as PDFKit.PDFDocument, fontDir)
    drawPdfText(doc as unknown as PDFKit.PDFDocument, UNICODE_SAMPLE, 'regular', 16, { width: 480 })
    doc.end()

    const pdf = await done
    const text = extractPdfText(pdf)
    expect(text).toContain('Café')
    expect(text).toContain('Привет')
    expect(text).toContain('日本語')
    expect(text).not.toContain('?')
    expect(pdfHasEmbeddedFontFile(pdf)).toBe(true)
    const names = pdfEmbeddedFontNames(pdf).join(' ')
    expect(names).toContain('NotoSans')
    expect(names).toMatch(/NotoSansSC/)
  })
})
