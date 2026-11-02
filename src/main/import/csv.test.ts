import { describe, expect, test } from 'vitest'
import { decodeText, parseRecords, parseRows, sniffDelimiter } from './csv'

describe('sniffDelimiter', () => {
  test('finds comma, semicolon, tab and pipe', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',')
    expect(sniffDelimiter('a;b\n1;2\n3;4')).toBe(';')
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(sniffDelimiter('a|b\n1|2')).toBe('|')
  })

  test('a list of questions with the odd comma is one value per line', () => {
    const text = [
      'how do I send texts from Outlook',
      'is email to SMS safe, and is it legal',
      'what replaced vtext',
      'best way to text the night shift'
    ].join('\n')
    expect(sniffDelimiter(text)).toBeNull()
    expect(parseRows(text)).toHaveLength(4)
    expect(parseRows(text)[1]).toEqual(['is email to SMS safe, and is it legal'])
  })

  test('commas inside quotes are not counted', () => {
    expect(sniffDelimiter('"a, b, c";d\n"e, f";g')).toBe(';')
  })

  test('a tab wins a tie (a sheet paste)', () => {
    expect(sniffDelimiter('a,b\tc\n1,2\t3')).toBe('\t')
  })
})

describe('parseRecords', () => {
  test('RFC 4180: quotes, doubled quotes, multi-line cells, CRLF and line numbers', () => {
    const text =
      'q,stage\r\n"Hi, there ""you""?",Problem\r\n"Two\nlines",Options\r\n\r\nlast,Decide'
    const records = parseRecords(text)
    expect(records.map((record) => record.cells)).toEqual([
      ['q', 'stage'],
      ['Hi, there "you"?', 'Problem'],
      ['Two\nlines', 'Options'],
      ['last', 'Decide']
    ])
    expect(records.map((record) => record.line)).toEqual([1, 2, 3, 6])
  })

  test('a leading BOM is dropped and blank rows can be kept', () => {
    expect(parseRows('\uFEFFurl\nhttps://a.com/')).toEqual([['url'], ['https://a.com/']])
    expect(parseRecords('a,b\n,\nc,d', { delimiter: ',', keepEmpty: true })).toHaveLength(3)
    expect(parseRecords('a,b\n,\nc,d', { delimiter: ',' })).toHaveLength(2)
  })

  test('a quote in the middle of a cell is text', () => {
    expect(parseRows('5" screen,x\ny,z', { delimiter: ',' })[0]).toEqual(['5" screen', 'x'])
  })

  test('a TSV paste from Sheets keeps three columns', () => {
    const paste =
      'Question\tStage\tPage\nhow do I text from Gmail\tTOFU\t/gmail-to-sms/\nis it safe\tBOFU\t\n'
    expect(parseRows(paste, { candidates: ['\t'] })).toEqual([
      ['Question', 'Stage', 'Page'],
      ['how do I text from Gmail', 'TOFU', '/gmail-to-sms/'],
      ['is it safe', 'BOFU', '']
    ])
  })
})

describe('decodeText', () => {
  test('UTF-8 with and without BOM', () => {
    expect(decodeText(new TextEncoder().encode('\uFEFFcafé'))).toBe('café')
    expect(decodeText(new TextEncoder().encode('naïve'))).toBe('naïve')
  })

  test('UTF-16 LE from Excel "Unicode text"', () => {
    const body = Buffer.from('a\tb', 'utf16le')
    expect(decodeText(new Uint8Array([0xff, 0xfe, ...body]))).toBe('a\tb')
  })

  test('falls back to Windows-1252 for an old Excel CSV', () => {
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
  })
})
