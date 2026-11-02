import { describe, expect, test } from 'vitest'
import { resolveTargetPage, sameTargetPage, targetPageKey, targetPagePath } from './target-page'

describe('resolveTargetPage', () => {
  test('puts a path on the own domain', () => {
    expect(resolveTargetPage('/pricing/', 'textbolt.com')).toBe('https://textbolt.com/pricing')
    expect(resolveTargetPage('pricing', 'www.textbolt.com')).toBe('https://textbolt.com/pricing')
    expect(resolveTargetPage(' /blog/a-guide?x=1#top ', 'textbolt.com')).toBe(
      'https://textbolt.com/blog/a-guide'
    )
    expect(resolveTargetPage('/', 'textbolt.com')).toBe('https://textbolt.com/')
  })

  test('keeps a full URL on the own site, with or without a scheme', () => {
    expect(resolveTargetPage('http://www.textbolt.com/Pricing/#plans', 'textbolt.com')).toBe(
      'https://www.textbolt.com/Pricing'
    )
    expect(resolveTargetPage('textbolt.com/pricing', 'textbolt.com')).toBe(
      'https://textbolt.com/pricing'
    )
    expect(resolveTargetPage('help.textbolt.com/docs', 'textbolt.com')).toBe(
      'https://help.textbolt.com/docs'
    )
    expect(resolveTargetPage('pricing.html', 'textbolt.com')).toBe(
      'https://textbolt.com/pricing.html'
    )
  })

  test('refuses another site, an empty value and a non-web address', () => {
    expect(resolveTargetPage('https://simpletexting.com/pricing', 'textbolt.com')).toBeNull()
    expect(resolveTargetPage('simpletexting.com/pricing', 'textbolt.com')).toBeNull()
    expect(resolveTargetPage('help.textbolt.com/docs', 'textbolt.com', false)).toBeNull()
    expect(resolveTargetPage('   ', 'textbolt.com')).toBeNull()
    expect(resolveTargetPage('ftp://textbolt.com/file', 'textbolt.com')).toBeNull()
    expect(resolveTargetPage('/pricing', '')).toBeNull()
  })
})

describe('matching', () => {
  test('ignores the scheme, www, case, a trailing slash, the query and the fragment', () => {
    expect(targetPageKey('http://www.TextBolt.com/Pricing/?a=1#x')).toBe('textbolt.com/pricing')
    expect(targetPageKey('textbolt.com/pricing/')).toBe('textbolt.com/pricing')
    expect(sameTargetPage('https://textbolt.com/pricing', 'textbolt.com/pricing/?ref=aio')).toBe(
      true
    )
    expect(sameTargetPage('https://textbolt.com/', 'https://www.textbolt.com')).toBe(true)
  })

  test('tells pages, hosts and missing values apart', () => {
    expect(sameTargetPage('https://textbolt.com/pricing', 'https://textbolt.com/features')).toBe(
      false
    )
    expect(
      sameTargetPage('https://textbolt.com/pricing', 'https://help.textbolt.com/pricing')
    ).toBe(false)
    expect(sameTargetPage(null, 'https://textbolt.com/pricing')).toBe(false)
    expect(sameTargetPage('https://textbolt.com/pricing', null)).toBe(false)
  })

  test('shows the path', () => {
    expect(targetPagePath('https://textbolt.com/pricing')).toBe('/pricing')
    expect(targetPagePath('https://textbolt.com/')).toBe('/')
    expect(targetPagePath('not a url')).toBe('not a url')
  })
})
