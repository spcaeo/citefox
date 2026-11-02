import * as ExcelJS from 'exceljs'
import { describe, expect, test } from 'vitest'
import { readXlsx, writeXlsx } from './xlsx'

/** A workbook built in the test: two visible sheets, a hidden one, merged cells, a formula and a date. */
async function fixture(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  const questions = book.addWorksheet('Questions')
  questions.addRow(['Question', 'Funnel stage', 'Landing page', 'Volume'])
  questions.addRow(['how do I text from Gmail', 'TOFU', '/gmail-to-sms/', 320])
  questions.addRow([
    { richText: [{ text: 'is email to SMS ' }, { text: 'safe', font: { bold: true } }] },
    'BOFU',
    { text: 'pricing', hyperlink: 'https://textbolt.com/pricing/' },
    { formula: '100+20', result: 120 }
  ])
  questions.addRow(['when did vtext stop', 'MOFU', '', new Date('2026-10-01T00:00:00.000Z')])
  questions.addRow([])
  questions.addRow(['merged note', '', '', ''])
  questions.mergeCells('B6:C6')
  questions.getCell('B6').value = 'Problem'
  const hidden = book.addWorksheet('Lookup')
  hidden.state = 'hidden'
  hidden.addRow(['secret'])
  const pages = book.addWorksheet('Pages')
  pages.addRow(['url'])
  pages.addRow(['https://textbolt.com/a/'])
  const written = await book.xlsx.writeBuffer()
  return new Uint8Array(written as ArrayBuffer)
}

describe('readXlsx', () => {
  test('reads visible sheets with values, not formulas', async () => {
    const book = await readXlsx(await fixture(), { rows: 5000, columns: 50 })
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Questions', 'Pages'])
    const rows = book.sheets[0]?.rows ?? []
    expect(rows[0]).toEqual(['Question', 'Funnel stage', 'Landing page', 'Volume'])
    expect(rows[1]).toEqual(['how do I text from Gmail', 'TOFU', '/gmail-to-sms/', '320'])
    expect(rows[2]).toEqual(['is email to SMS safe', 'BOFU', 'pricing', '120'])
    expect(rows[3]).toEqual(['when did vtext stop', 'MOFU', '', '2026-10-01'])
    // The blank row is left out; a merged cell repeats its value.
    expect(rows[4]).toEqual(['merged note', 'Problem', 'Problem', ''])
    expect(book.sheets[1]?.rows).toEqual([['url'], ['https://textbolt.com/a/']])
  })

  test('reads at most the row limit plus two', async () => {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Big')
    for (let index = 0; index < 30; index += 1) sheet.addRow([`q ${index}`])
    const bytes = new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer)
    const read = await readXlsx(bytes, { rows: 10, columns: 5 })
    expect(read.sheets[0]?.rows).toHaveLength(12)
  })

  test('a file that is not a workbook fails', async () => {
    await expect(
      readXlsx(new TextEncoder().encode('not a zip'), { rows: 10, columns: 5 })
    ).rejects.toThrow()
  })
})

describe('writeXlsx', () => {
  test('round-trips the template rows', async () => {
    const bytes = await writeXlsx('Questions', ['Question', 'Stage'], [['a', 'Problem']])
    const read = await readXlsx(new Uint8Array(bytes), { rows: 10, columns: 5 })
    expect(read.sheets[0]?.rows).toEqual([
      ['Question', 'Stage'],
      ['a', 'Problem']
    ])
  })
})
