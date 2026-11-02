import { describe, expect, test } from 'vitest'
import { hostMatchesDomain, normalizeUrl } from './url'

describe('normalizeUrl (FR-6.1)', () => {
  test('strips www, tracking params, the fragment, and a trailing slash', () => {
    expect(normalizeUrl('HTTPS://WWW.TextBolt.com/pricing/?utm_source=aio&b=2&a=1#top')).toBe(
      'https://textbolt.com/pricing?a=1&b=2'
    )
    expect(normalizeUrl('https://textbolt.com/')).toBe('https://textbolt.com/')
  })

  test('matches http and https of the same page', () => {
    expect(normalizeUrl('http://textbolt.com/pricing')).toBe(
      normalizeUrl('https://textbolt.com/pricing')
    )
    expect(normalizeUrl('http://www.textbolt.com/pricing/')).toBe('https://textbolt.com/pricing')
    expect(normalizeUrl('http://textbolt.com:80/pricing')).toBe('https://textbolt.com/pricing')
  })

  test('drops Google result and ad-click parameters', () => {
    expect(
      normalizeUrl(
        'https://textbolt.com/blog/alerts/?srsltid=AfmBOoq&ved=2ahUKE&sa=X&usg=AOv&ei=abc&gclid=1&gbraid=2&utm_medium=x#:~:text=alerts'
      )
    ).toBe('https://textbolt.com/blog/alerts')
    expect(normalizeUrl('https://textbolt.com/search?q=alerts&srsltid=1')).toBe(
      'https://textbolt.com/search?q=alerts'
    )
  })

  test('unwraps a Google redirect to the page it points to', () => {
    const target = encodeURIComponent('http://www.textbolt.com/blog/alerts/?utm_source=google')
    expect(normalizeUrl(`https://www.google.com/url?sa=t&q=${target}&ved=abc`)).toBe(
      'https://textbolt.com/blog/alerts'
    )
    expect(normalizeUrl(`https://www.google.co.uk/url?url=${target}`)).toBe(
      'https://textbolt.com/blog/alerts'
    )
    expect(normalizeUrl('https://www.google.com/search?q=alerts')).toBe(
      'https://google.com/search?q=alerts'
    )
  })

  test('rejects values that are not web URLs', () => {
    expect(normalizeUrl('not a url')).toBeNull()
    expect(normalizeUrl('ftp://textbolt.com/file')).toBeNull()
  })
})

describe('hostMatchesDomain', () => {
  test('matches subdomains only when they count', () => {
    expect(hostMatchesDomain('help.textbolt.com', 'textbolt.com', true)).toBe(true)
    expect(hostMatchesDomain('help.textbolt.com', 'www.textbolt.com', true)).toBe(true)
    expect(hostMatchesDomain('help.textbolt.com', 'textbolt.com', false)).toBe(false)
    expect(hostMatchesDomain('nottextbolt.com', 'textbolt.com', true)).toBe(false)
  })
})
