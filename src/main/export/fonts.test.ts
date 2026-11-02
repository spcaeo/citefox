import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  PDF_CJK,
  PDF_FONT_FILES,
  PDF_HANGUL,
  PDF_SANS_BOLD,
  pdfFontName,
  renderPdfTextSample,
  resolvePdfFontDirectory,
  shapePdfText,
  type PdfFontCoverage
} from './fonts'
import {
  extractPdfText,
  pdfEmbeddedFontNames,
  pdfHasEmbeddedFontFile
} from './pdf-inspect.test-helper'

const SAMPLE = 'Café Привет Αθήνα 日本語 カタカナ 한글'

function coverageFor(sans: string, cjk: string, hangul: string): PdfFontCoverage {
  const sets = {
    sans: codes(sans),
    cjk: codes(cjk),
    hangul: codes(hangul)
  }
  return {
    has(face, codePoint) {
      return sets[face].has(codePoint)
    }
  }
}

function codes(value: string): Set<number> {
  const set = new Set<number>()
  for (const char of value) set.add(char.codePointAt(0) ?? 0)
  return set
}

describe('PDF font fallback', () => {
  test('picks Noto Sans, then the CJK face, then Hangul', () => {
    const coverage = coverageFor('Café Привет Αθήνα ', '日本語 カタカナ', '한글')
    const shaped = shapePdfText(SAMPLE, coverage)
    expect(shaped.replaced).toBe(0)
    expect(shaped.text).toBe(SAMPLE)
    expect(shaped.runs.map((run) => run.face)).toEqual(['sans', 'cjk', 'hangul'])
    expect(shaped.runs.map((run) => run.text)).toEqual([
      'Café Привет Αθήνα ',
      '日本語 カタカナ ',
      '한글'
    ])
  })

  test('a character present in Noto Sans stays on that face when the CJK face also has it', () => {
    const coverage = coverageFor('A', 'A日', '')
    const shaped = shapePdfText('A日', coverage)
    expect(shaped.runs).toEqual([
      { face: 'sans', text: 'A' },
      { face: 'cjk', text: '日' }
    ])
  })

  test('whitespace stays with the previous face', () => {
    const coverage = coverageFor('A', '日', '')
    const shaped = shapePdfText('A 日\n', coverage)
    expect(shaped.replaced).toBe(0)
    expect(shaped.runs).toEqual([
      { face: 'sans', text: 'A ' },
      { face: 'cjk', text: '日\n' }
    ])
  })

  test('characters outside every face become ? and are counted', () => {
    const coverage = coverageFor('AB', '', '')
    const shaped = shapePdfText('A😀B', coverage)
    expect(shaped.text).toBe('A?B')
    expect(shaped.replaced).toBe(1)
    expect(shaped.runs).toEqual([{ face: 'sans', text: 'A?B' }])
  })

  test('bold Latin uses Noto Sans Bold and CJK stays on the regular CJK face', () => {
    expect(pdfFontName('sans', 'bold')).toBe(PDF_SANS_BOLD)
    expect(pdfFontName('sans', 'regular')).not.toBe(PDF_SANS_BOLD)
    expect(pdfFontName('cjk', 'bold')).toBe(PDF_CJK)
    expect(pdfFontName('hangul', 'bold')).toBe(PDF_HANGUL)
  })

  test('the dev font directory contains the OFL files', () => {
    const directory = resolvePdfFontDirectory()
    for (const name of Object.values(PDF_FONT_FILES)) {
      expect(existsSync(join(directory, name))).toBe(true)
    }
    expect(existsSync(join(directory, 'OFL.txt'))).toBe(true)
  })

  test('a rendered sample round-trips mixed scripts and embeds the fonts', async () => {
    const bytes = await renderPdfTextSample(SAMPLE)
    const text = extractPdfText(bytes)
    expect(text).toContain('Café')
    expect(text).toContain('Привет')
    expect(text).toContain('Αθήνα')
    expect(text).toContain('日本語')
    expect(text).toContain('カタカナ')
    expect(text).toContain('한글')
    expect(text).not.toContain('?')
    expect(pdfHasEmbeddedFontFile(bytes)).toBe(true)
    const names = pdfEmbeddedFontNames(bytes).join(' ')
    expect(names).toContain('NotoSans-Regular')
    expect(names).toContain('NotoSans-Bold')
    expect(names).toMatch(/NotoSansSC/)
    expect(names).toMatch(/NotoSansKR/)
  })

  test('a rendered emoji is replaced instead of dropped', async () => {
    const bytes = await renderPdfTextSample('OK 😀')
    const text = extractPdfText(bytes)
    expect(text).toContain('OK')
    expect(text).toContain('?')
    expect(text).not.toContain('😀')
  })
})
