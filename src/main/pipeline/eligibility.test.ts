import { describe, expect, test } from 'vitest'
import { readEligibility } from './eligibility'

const TEXT = '<p>Send text alerts to staff from the email tools they already use every day.</p>'

function page(head: string, body = TEXT): string {
  return `<!doctype html><html><head><title>Alerts</title>${head}</head><body>${body}</body></html>`
}

function codes(html: string, headers?: Record<string, string>): string[] {
  return readEligibility(html, headers).issues.map((issue) => `${issue.code}@${issue.where}`)
}

describe('readEligibility: robots meta tags', () => {
  test('a plain page has no issues', () => {
    expect(codes(page('<meta name="description" content="noindex in a description">'))).toEqual([])
  })

  test('robots and googlebot meta tags are both read, in any case', () => {
    expect(codes(page('<meta name="ROBOTS" content="NoIndex, follow">'))).toEqual(['noindex@meta'])
    expect(codes(page('<meta name="googlebot" content="nosnippet">'))).toEqual(['nosnippet@meta'])
  })

  test('none counts as noindex and keeps its own wording', () => {
    expect(readEligibility(page('<meta name="robots" content="none">')).issues).toEqual([
      { code: 'noindex', where: 'meta', detail: 'none' }
    ])
  })

  test('other crawlers’ meta tags do not count', () => {
    expect(codes(page('<meta name="bingbot" content="noindex, nosnippet">'))).toEqual([])
  })

  test('max-snippet: 0 and small values are issues, -1 and large ones are not; the smallest wins', () => {
    expect(readEligibility(page('<meta name="robots" content="max-snippet:0">')).issues).toEqual([
      { code: 'max_snippet', where: 'meta', detail: 'max-snippet:0' }
    ])
    expect(codes(page('<meta name="robots" content="max-snippet:-1">'))).toEqual([])
    expect(codes(page('<meta name="robots" content="max-snippet:50">'))).toEqual([])
    expect(codes(page('<meta name="robots" content="max-snippet:abc">'))).toEqual([])
    const both = page(
      '<meta name="robots" content="max-snippet:40"><meta name="googlebot" content="max-snippet : 12">'
    )
    expect(readEligibility(both).issues).toEqual([
      { code: 'max_snippet', where: 'meta', detail: 'max-snippet:12' }
    ])
  })

  test('each problem is listed once, first place found', () => {
    const html = page(
      '<meta name="robots" content="noindex"><meta name="googlebot" content="none">'
    )
    expect(codes(html, { 'X-Robots-Tag': 'noindex' })).toEqual(['noindex@meta'])
  })
})

describe('readEligibility: X-Robots-Tag', () => {
  test('a bare directive applies to every crawler, header name in any case', () => {
    expect(codes(page(''), { 'X-Robots-Tag': 'noindex, nofollow' })).toEqual(['noindex@header'])
  })

  test('a googlebot group applies, and its following tokens stay in it', () => {
    expect(codes(page(''), { 'x-robots-tag': 'googlebot: nofollow, nosnippet' })).toEqual([
      'nosnippet@header'
    ])
  })

  test('another crawler’s group is skipped until a googlebot group starts', () => {
    expect(codes(page(''), { 'x-robots-tag': 'otherbot: noindex, nosnippet' })).toEqual([])
    expect(
      codes(page(''), { 'x-robots-tag': 'otherbot: noindex, googlebot: max-snippet:10' })
    ).toEqual(['max_snippet@header'])
  })

  test('max-snippet and unavailable_after are directives, not crawler names', () => {
    expect(codes(page(''), { 'x-robots-tag': 'max-snippet:5' })).toEqual(['max_snippet@header'])
    expect(
      codes(page(''), {
        'x-robots-tag': 'unavailable_after: Friday, 25-Jun-10 15:00:00 PST, noindex'
      })
    ).toEqual(['noindex@header'])
  })
})

describe('readEligibility: data-nosnippet', () => {
  test('a small marked part is fine; most of the text marked is an issue', () => {
    const small = `${TEXT}${TEXT}<span data-nosnippet>Legal.</span>`
    expect(codes(page('', small))).toEqual([])
    const most = `<div data-nosnippet>${TEXT}${TEXT}</div><p>Short.</p>`
    const issues = readEligibility(page('', most)).issues
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'data_nosnippet', where: 'html' })
    expect(issues[0]?.detail).toMatch(/^data-nosnippet on \d+% of the text$/)
  })

  test('a nested element of the same name does not end the marked one early', () => {
    const nested = `<div data-nosnippet><div>${TEXT}</div>${TEXT}${TEXT}</div><p>Tail.</p>`
    expect(codes(page('', nested))).toEqual(['data_nosnippet@html'])
  })

  test('text in the head, scripts and styles does not count', () => {
    const body = `<div data-nosnippet>${TEXT}</div><script>${'x'.repeat(5000)}</script>${TEXT}${TEXT}`
    expect(codes(page('', body))).toEqual([])
  })

  test('data-nosnippet on an empty element hides nothing', () => {
    expect(codes(page('', `<img data-nosnippet src="a.png">${TEXT}`))).toEqual([])
  })

  test('an unclosed marked element runs to the end of the page', () => {
    expect(codes(`<body><p>Hi.</p><div data-nosnippet>${TEXT}`)).toEqual(['data_nosnippet@html'])
  })
})

describe('readEligibility: hostile input', () => {
  test('broken HTML and empty input do not throw', () => {
    expect(codes('')).toEqual([])
    expect(codes('<meta name="robots" content="noindex')).toEqual([])
    expect(codes('<<<>>> <meta name=robots content=noindex>')).toEqual(['noindex@meta'])
  })

  test('a very large page with many tags is read quickly', () => {
    const html = `<body>${'<div data-nosnippet><span>a</span>'.repeat(50_000)}</body>`
    const started = Date.now()
    readEligibility(html)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
