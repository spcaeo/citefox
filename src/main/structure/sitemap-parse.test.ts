import { gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { decodeSitemapBody, parseSitemapXml, SitemapParseError } from './sitemap-parse'

const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'

function urlset(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${NS}>${body}</urlset>`
}

describe('parseSitemapXml', () => {
  test('reads a urlset with loc and lastmod', () => {
    const parsed = parseSitemapXml(
      urlset(`
        <url><loc>https://textbolt.com/blog/a/</loc><lastmod>2026-10-01</lastmod></url>
        <url>
          <loc>
            https://textbolt.com/blog/b/
          </loc>
          <changefreq>weekly</changefreq>
        </url>`)
    )
    expect(parsed).toEqual({
      kind: 'urlset',
      urls: [
        { loc: 'https://textbolt.com/blog/a/', lastmod: '2026-10-01' },
        { loc: 'https://textbolt.com/blog/b/', lastmod: null }
      ],
      truncated: false
    })
  })

  test('reads a sitemap index', () => {
    const parsed = parseSitemapXml(
      `<sitemapindex ${NS}><sitemap><loc>https://textbolt.com/post-sitemap.xml</loc>` +
        `<lastmod>2026-10-19T09:00:00+00:00</lastmod></sitemap></sitemapindex>`
    )
    expect(parsed).toEqual({
      kind: 'index',
      sitemaps: [
        { loc: 'https://textbolt.com/post-sitemap.xml', lastmod: '2026-10-19T09:00:00+00:00' }
      ],
      truncated: false
    })
  })

  test('accepts namespace prefixes, mixed case, attributes, BOM, comments and DOCTYPE', () => {
    const text =
      '﻿<?xml version="1.0"?><!DOCTYPE urlset><!-- a <url> comment -->' +
      `<ns0:URLSET xmlns:ns0="x" data-x="a>b"><ns0:Url><ns0:LOC>https://textbolt.com/x/</ns0:LOC>` +
      '<?pi data?></ns0:Url></ns0:URLSET>'
    const parsed = parseSitemapXml(text)
    expect(parsed.kind).toBe('urlset')
    if (parsed.kind === 'urlset')
      expect(parsed.urls).toEqual([{ loc: 'https://textbolt.com/x/', lastmod: null }])
  })

  test('decodes predefined entities and CDATA, leaves unknown entities literal', () => {
    const parsed = parseSitemapXml(
      urlset(
        '<url><loc>https://textbolt.com/?a=1&amp;b=2&#x26;c=&#51;</loc></url>' +
          '<url><loc><![CDATA[https://textbolt.com/?q=<x>&y]]></loc></url>' +
          '<url><loc>https://textbolt.com/&nbsp;</loc></url>'
      )
    )
    if (parsed.kind !== 'urlset') throw new Error('expected urlset')
    expect(parsed.urls.map((entry) => entry.loc)).toEqual([
      'https://textbolt.com/?a=1&b=2&c=3',
      'https://textbolt.com/?q=<x>&y',
      'https://textbolt.com/&nbsp;'
    ])
  })

  test('ignores image and video loc children and drops a bad lastmod', () => {
    const parsed = parseSitemapXml(
      urlset(
        '<url><loc>https://textbolt.com/a/</loc><image:image><image:loc>https://cdn.x/i.png</image:loc></image:image>' +
          '<video:video><video:content_loc>https://cdn.x/v.mp4</video:content_loc></video:video>' +
          '<lastmod>yesterday</lastmod></url>'
      )
    )
    if (parsed.kind !== 'urlset') throw new Error('expected urlset')
    expect(parsed.urls).toEqual([{ loc: 'https://textbolt.com/a/', lastmod: null }])
  })

  test('refuses entity declarations (billion laughs and external entities)', () => {
    const laughs =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>' +
      `<urlset ${NS}><url><loc>&lol2;</loc></url></urlset>`
    expect(() => parseSitemapXml(laughs)).toThrow(SitemapParseError)
    const external =
      '<!DOCTYPE urlset [<!entity xxe SYSTEM "file:///etc/passwd">]>' +
      `<urlset ${NS}><url><loc>&xxe;</loc></url></urlset>`
    expect(() => parseSitemapXml(external)).toThrow(/entities/)
  })

  test('rejects an HTML page, an empty string, and an unknown root', () => {
    expect(() => parseSitemapXml('<!DOCTYPE html><html><body>Hi</body></html>')).toThrow(
      'This file is not a sitemap.'
    )
    expect(() => parseSitemapXml('')).toThrow('This file is not a sitemap.')
    expect(() => parseSitemapXml('just text')).toThrow('This file is not a sitemap.')
    expect(() => parseSitemapXml('<rss><channel/></rss>')).toThrow(SitemapParseError)
  })

  test('keeps completed entries of a cut-off document', () => {
    const text = urlset(
      '<url><loc>https://textbolt.com/a/</loc></url><url><loc>https://textbolt.com/b/</loc></url>'
    ).slice(0, -40)
    const parsed = parseSitemapXml(text)
    if (parsed.kind !== 'urlset') throw new Error('expected urlset')
    expect(parsed.urls).toEqual([{ loc: 'https://textbolt.com/a/', lastmod: null }])
    expect(parseSitemapXml(`<urlset ${NS}><url><loc>https://textbolt.com/a/</lo`)).toEqual({
      kind: 'urlset',
      urls: [],
      truncated: false
    })
  })

  test('tolerates malformed and stray tags', () => {
    const parsed = parseSitemapXml(
      urlset(
        '</stray><url><loc>https://textbolt.com/a/</loc><foo></url>< <url><loc>https://textbolt.com/b/</loc></url>'
      )
    )
    if (parsed.kind !== 'urlset') throw new Error('expected urlset')
    expect(parsed.urls.map((entry) => entry.loc)).toEqual([
      'https://textbolt.com/a/',
      'https://textbolt.com/b/'
    ])
  })

  test('stops at the URL cap and marks the result truncated', () => {
    const body = Array.from(
      { length: 60_000 },
      (_, index) => `<url><loc>https://textbolt.com/p/${index}/</loc></url>`
    ).join('')
    const parsed = parseSitemapXml(urlset(body))
    if (parsed.kind !== 'urlset') throw new Error('expected urlset')
    expect(parsed.urls).toHaveLength(50_000)
    expect(parsed.truncated).toBe(true)
    const small = parseSitemapXml(urlset(body.slice(0, 2000)), { maxUrls: 3 })
    expect(small.truncated).toBe(true)
  })

  test('caps child sitemaps in an index', () => {
    const body = Array.from(
      { length: 5 },
      (_, index) => `<sitemap><loc>https://textbolt.com/s${index}.xml</loc></sitemap>`
    ).join('')
    const parsed = parseSitemapXml(`<sitemapindex>${body}</sitemapindex>`, { maxChildSitemaps: 2 })
    expect(parsed).toMatchObject({ kind: 'index', truncated: true })
    if (parsed.kind === 'index') expect(parsed.sitemaps).toHaveLength(2)
  })

  test('refuses text over the byte cap', () => {
    expect(() => parseSitemapXml(urlset('x'.repeat(200)), { maxBytes: 100 })).toThrow(
      'The sitemap is too large to read.'
    )
  })

  test('drops a huge loc without slowing down', () => {
    const started = Date.now()
    const parsed = parseSitemapXml(
      urlset(`<url><loc>https://textbolt.com/${'a'.repeat(5_000_000)}</loc></url>`)
    )
    if (parsed.kind !== 'urlset') throw new Error('expected urlset')
    expect(parsed.urls).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('refuses deeply nested elements', () => {
    const deep = `<urlset>${'<a>'.repeat(10_000)}`
    expect(() => parseSitemapXml(deep)).toThrow('The sitemap is nested too deeply.')
  })

  test('stays linear on pathological input', () => {
    const inputs = [
      `<urlset>${'<'.repeat(5_000_000)}`,
      `<urlset>${'<a b="'.repeat(1_000_000)}`,
      `<urlset>${'<!--'.repeat(1_000_000)}`,
      `<urlset>${'<![CDATA['.repeat(500_000)}`,
      `<urlset><url><loc>${'&amp;&#x41;&bogus;'.repeat(300_000)}</loc></url></urlset>`
    ]
    for (const input of inputs) {
      const started = Date.now()
      try {
        parseSitemapXml(input)
      } catch (error) {
        expect(error).toBeInstanceOf(SitemapParseError)
      }
      expect(Date.now() - started).toBeLessThan(1000)
    }
  })
})

describe('decodeSitemapBody', () => {
  test('returns the text body when the bytes are not gzip', () => {
    expect(
      decodeSitemapBody({ body: '<urlset/>', bytes: new TextEncoder().encode('<urlset/>') })
    ).toBe('<urlset/>')
    expect(decodeSitemapBody({ body: 'plain' })).toBe('plain')
  })

  test('gunzips a compressed sitemap', () => {
    const xml = urlset('<url><loc>https://textbolt.com/a/</loc></url>')
    const bytes = new Uint8Array(gzipSync(Buffer.from(xml)))
    expect(decodeSitemapBody({ body: 'garbled', bytes })).toBe(xml)
  })

  test('stops a gzip bomb at the output cap', () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(50 * 1024 * 1024)))
    expect(() => decodeSitemapBody({ body: '', bytes: bomb }, 1024 * 1024)).toThrow(
      'The compressed sitemap is too large.'
    )
  })

  test('reports a broken gzip body', () => {
    const broken = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02])
    expect(() => decodeSitemapBody({ body: '', bytes: broken })).toThrow(
      'The compressed sitemap could not be decompressed.'
    )
  })
})
