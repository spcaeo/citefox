import { describe, expect, test } from 'vitest'
import {
  bareDomain,
  folderSegments,
  isMoneyPage,
  isOwnDomainUrl,
  normalizePageUrl,
  parseImportText,
  slugTitle,
  topFolderOf,
  validateImportEntries
} from './url-rules'

describe('normalizePageUrl', () => {
  test('keeps http and https, lower-cases the host, strips the fragment', () => {
    expect(normalizePageUrl('  https://TextBolt.com/Blog/A/?x=1#top ')).toBe(
      'https://textbolt.com/Blog/A/?x=1'
    )
    expect(normalizePageUrl('http://textbolt.com')).toBe('http://textbolt.com/')
  })

  test('rejects other schemes, credentials, spaces, control characters, and long URLs', () => {
    expect(normalizePageUrl('ftp://textbolt.com/')).toBeNull()
    expect(normalizePageUrl('javascript:alert(1)')).toBeNull()
    expect(normalizePageUrl('https://a:b@textbolt.com/')).toBeNull()
    expect(normalizePageUrl('https://textbolt.com/a b/')).toBeNull()
    expect(normalizePageUrl('https://textbolt.com/a\u0000/')).toBeNull()
    expect(normalizePageUrl(`https://textbolt.com/${'a'.repeat(2000)}`)).toBeNull()
    expect(normalizePageUrl('textbolt.com/blog/')).toBeNull()
    expect(normalizePageUrl('')).toBeNull()
  })
})

describe('isOwnDomainUrl', () => {
  test('treats www as the same site and other subdomains only when included', () => {
    expect(isOwnDomainUrl('https://www.textbolt.com/a/', 'TextBolt.com', false)).toBe(true)
    expect(isOwnDomainUrl('https://textbolt.com/a/', 'https://www.textbolt.com/', false)).toBe(true)
    expect(isOwnDomainUrl('https://help.textbolt.com/a/', 'textbolt.com', false)).toBe(false)
    expect(isOwnDomainUrl('https://help.textbolt.com/a/', 'textbolt.com', true)).toBe(true)
    expect(isOwnDomainUrl('https://nottextbolt.com/', 'textbolt.com', true)).toBe(false)
    expect(isOwnDomainUrl('https://textbolt.com.evil.io/', 'textbolt.com', true)).toBe(false)
    expect(isOwnDomainUrl('not a url', 'textbolt.com', true)).toBe(false)
  })

  test('reads a bare domain from several spellings', () => {
    expect(bareDomain('https://WWW.TextBolt.com:443/path')).toBe('textbolt.com')
    expect(bareDomain('textbolt.com.')).toBe('textbolt.com')
  })
})

describe('folders', () => {
  test('directory segments without the slug', () => {
    expect(folderSegments('https://textbolt.com/blog/foo/')).toEqual(['blog'])
    expect(folderSegments('https://textbolt.com/industries/healthcare/dentists/')).toEqual([
      'industries',
      'healthcare'
    ])
    expect(folderSegments('https://textbolt.com/pricing/')).toEqual([])
    expect(folderSegments('https://textbolt.com/')).toEqual([])
    expect(folderSegments('nope')).toEqual([])
  })

  test('top folder', () => {
    expect(topFolderOf('https://textbolt.com/blog/foo/')).toBe('/blog/')
    expect(topFolderOf('https://textbolt.com/use-cases/healthcare/x/')).toBe('/use-cases/')
    expect(topFolderOf('https://textbolt.com/pricing/')).toBe('/')
  })
})

describe('isMoneyPage', () => {
  test.each([
    ['https://textbolt.com/pricing/', true],
    ['https://textbolt.com/features/bulk-sms/', true],
    ['https://textbolt.com/compare/simpletexting/', true],
    ['https://textbolt.com/alternatives/twilio-alternatives/', true],
    ['https://textbolt.com/blog/textbolt-vs-twilio/', true],
    ['https://textbolt.com/blog/best-simpletexting-alternatives/', true],
    ['https://textbolt.com/blog/sms-pricing-explained/', true],
    ['https://textbolt.com/blog/email-to-sms/', false],
    ['https://textbolt.com/about/', false]
  ])('%s → %s', (url, expected) => {
    expect(isMoneyPage(url)).toBe(expected)
  })
})

describe('slugTitle', () => {
  test('turns a slug into words', () => {
    expect(slugTitle('https://textbolt.com/blog/10dlc-registration-guide/')).toBe(
      '10dlc registration guide'
    )
    expect(slugTitle('https://textbolt.com/help/send_a_text.html')).toBe('send a text')
    expect(slugTitle('https://textbolt.com/blog/caf%C3%A9-sms/')).toBe('café sms')
    expect(slugTitle('https://textbolt.com/')).toBe('textbolt.com')
  })
})

describe('parseImportText', () => {
  test('lines: skips blanks and comments, keeps line numbers', () => {
    const text = 'https://textbolt.com/a/\n\n# note\r\n  https://textbolt.com/b/  \r'
    expect(parseImportText(text, 'lines')).toEqual({
      entries: [
        { line: 1, value: 'https://textbolt.com/a/' },
        { line: 4, value: 'https://textbolt.com/b/' }
      ],
      error: null
    })
  })

  test('csv: url column, quotes, doubled quotes, CRLF, BOM, multi-line cells', () => {
    const text =
      '﻿title,URL ,notes\r\n' +
      '"Hello, world",https://textbolt.com/a/,"say ""hi"""\r\n' +
      '"Two\nlines",https://textbolt.com/b/,x\r\n' +
      ',,\r\n' +
      'No url here,,y\n' +
      'Last,"https://textbolt.com/c/",z'
    expect(parseImportText(text, 'csv')).toEqual({
      entries: [
        { line: 2, value: 'https://textbolt.com/a/' },
        { line: 3, value: 'https://textbolt.com/b/' },
        { line: 7, value: 'https://textbolt.com/c/' }
      ],
      error: null
    })
  })

  test('csv: a label column rides along with each address (W3I-C2)', () => {
    expect(
      parseImportText(
        'url,label\nhttps://textbolt.com/a/,Alpha\n"https://textbolt.com/b/",\n',
        'csv'
      ).entries
    ).toEqual([
      { line: 2, value: 'https://textbolt.com/a/', label: 'Alpha' },
      { line: 3, value: 'https://textbolt.com/b/' }
    ])
  })

  test('csv: semicolon delimiter when the header has no comma', () => {
    expect(parseImportText('name;url\nA;https://textbolt.com/a/', 'csv').entries).toEqual([
      { line: 2, value: 'https://textbolt.com/a/' }
    ])
  })

  test('csv: needs a url column', () => {
    expect(parseImportText('name,title\nx,y', 'csv')).toEqual({
      entries: [],
      error: 'No column of web addresses was found. Name it url, or match the columns.'
    })
    expect(parseImportText('', 'csv').error).toBe(
      'No column of web addresses was found. Name it url, or match the columns.'
    )
  })

  test('stops at the row cap and says so', () => {
    const text = Array.from({ length: 12 }, (_, index) => `https://textbolt.com/${index}/`).join(
      '\n'
    )
    const parsed = parseImportText(text, 'lines', 10)
    expect(parsed.entries).toHaveLength(10)
    expect(parsed.error).toBe('Only the first 10 URLs were read.')
  })
})

describe('validateImportEntries', () => {
  test('accepts own-domain URLs, rejects others, counts duplicates', () => {
    const result = validateImportEntries(
      [
        { line: 1, value: 'https://textbolt.com/a/' },
        { line: 2, value: 'https://www.textbolt.com/b/#x' },
        { line: 3, value: 'https://twilio.com/x/' },
        { line: 4, value: 'not a url' },
        { line: 5, value: 'https://textbolt.com/a/' },
        { line: 6, value: 'https://help.textbolt.com/c/' }
      ],
      'TextBolt.com',
      false
    )
    expect(result).toEqual({
      accepted: [
        { line: 1, url: 'https://textbolt.com/a/' },
        { line: 2, url: 'https://www.textbolt.com/b/' }
      ],
      rejected: [
        { line: 3, value: 'https://twilio.com/x/', reason: 'Not on textbolt.com' },
        { line: 4, value: 'not a url', reason: 'Not a web address' },
        { line: 6, value: 'https://help.textbolt.com/c/', reason: 'Not on textbolt.com' }
      ],
      duplicates: 1
    })
  })
})
