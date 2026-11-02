import { describe, expect, test } from 'vitest'
import { decodePageBytes, isReadablePageContentType } from './charset'

function latin1(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'latin1'))
}

describe('page charset decoding', () => {
  test('uses the Content-Type charset', () => {
    const bytes = latin1('<p>café ½</p>')
    expect(decodePageBytes(bytes, 'text/html; charset=windows-1252')).toBe('<p>café ½</p>')
    expect(decodePageBytes(bytes, 'text/html; charset="ISO-8859-1"')).toBe('<p>café ½</p>')
  })

  test('falls back to <meta charset> and http-equiv when the header has none', () => {
    const meta = latin1('<html><head><meta charset="windows-1252"></head><body>naïve</body>')
    expect(decodePageBytes(meta, 'text/html')).toContain('naïve')
    const equiv = latin1(
      '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>über</p>'
    )
    expect(decodePageBytes(equiv, null)).toContain('über')
    const sjis = Uint8Array.from([
      ...Buffer.from('<meta charset="shift_jis"><p>', 'latin1'),
      0x93,
      0xfa,
      0x96,
      0x7b,
      ...Buffer.from('</p>', 'latin1')
    ])
    expect(decodePageBytes(sjis, 'text/html')).toContain('日本')
  })

  test('honours a BOM, defaults to UTF-8, and survives an unknown label', () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from('<p>✓</p>', 'utf8')])
    expect(decodePageBytes(bom, 'text/html; charset=windows-1252')).toBe('<p>✓</p>')
    expect(decodePageBytes(Uint8Array.from(Buffer.from('<p>✓</p>', 'utf8')), null)).toBe('<p>✓</p>')
    expect(
      decodePageBytes(Uint8Array.from(Buffer.from('<p>ok</p>')), 'text/html; charset=x-made-up')
    ).toBe('<p>ok</p>')
  })
})

describe('readable page content types', () => {
  test.each([
    null,
    '',
    'text/html',
    'text/html; charset=utf-8',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
    'text/plain'
  ])('accepts %s', (value) => {
    expect(isReadablePageContentType(value)).toBe(true)
  })

  test.each([
    'application/pdf',
    'image/png',
    'application/octet-stream',
    'video/mp4',
    'application/json'
  ])('rejects %s', (value) => {
    expect(isReadablePageContentType(value)).toBe(false)
  })
})
