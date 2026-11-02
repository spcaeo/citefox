import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { extractHtml, extractMarkdown } from './extract'
import { normalizeBody } from './hash'

const POST =
  'Most teams already get alert emails from their scheduling software. This guide shows how to turn those emails into text messages for field staff, step by step, without a developer.'

describe('extractHtml main content', () => {
  test('reads the article with the H1, not a related-post card that comes first', () => {
    const html = `<html><head><title>Text alerts</title></head><body>
      <aside><article class="card"><h3>Related: SMS pricing</h3><p>Short teaser.</p></article></aside>
      <article class="post"><h1>How to Set Up Text Alerts</h1><p>${POST}</p></article>
      <footer>Footer links</footer></body></html>`
    const page = extractHtml(html)
    expect(page.h1).toBe('How to Set Up Text Alerts')
    expect(page.bodyText).toContain(POST)
    expect(page.bodyText.includes('Short teaser')).toBe(false)
    expect(page.bodyText.includes('Footer links')).toBe(false)
  })

  test('without an H1 inside an article, reads the article with the most text', () => {
    const html = `<body><h1>Title outside</h1>
      <article><p>Tiny card.</p></article>
      <article><p>${POST}</p><article><p>Nested quote stays with its parent.</p></article></article>
      </body>`
    const page = extractHtml(html)
    expect(page.bodyText).toContain(POST)
    expect(page.bodyText).toContain('Nested quote stays with its parent.')
    expect(page.bodyText.includes('Tiny card')).toBe(false)
  })

  test('prefers main, drops scripts, styles, and comments, and keeps head fields', () => {
    const html = `<html><head>
      <title>Alerts &amp; texts</title>
      <meta content="Turn emails into texts" name="description">
      <meta property="article:modified_time" content="2026-10-16T09:00:00Z">
      <link href="https://example.com/a" rel="canonical">
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Do staff need an app?","acceptedAnswer":{"@type":"Answer","text":"No."}}]}</script>
      </head><body><article><p>Card</p></article>
      <main><h1>Alerts</h1><!-- <p>hidden</p> --><script>var s = "<h2>not a heading</h2>"</script>
      <style>p{}</style><h2>Step one</h2><p>${POST}</p><table></table></main></body></html>`
    const page = extractHtml(html)
    expect(page.title).toBe('Alerts & texts')
    expect(page.metaDescription).toBe('Turn emails into texts')
    expect(page.canonical).toBe('https://example.com/a')
    expect(page.modifiedAt).toBe('2026-10-16T09:00:00Z')
    expect(page.faqs).toEqual([{ question: 'Do staff need an app?', answer: 'No.', typo: null }])
    expect(page.outline).toEqual([{ level: 'h2', text: 'Step one', table: false }])
    expect(page.tableCount).toBe(1)
    expect(page.bodyText).toBe(`Alerts Step one ${POST}`)
  })

  test('falls back to JSON-LD dateModified for the last-modified date', () => {
    const html = `<head><script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","dateModified":"2026-10-16T08:00:00-05:00"}]}</script></head><body><p>${POST}</p></body>`
    expect(extractHtml(html).modifiedAt).toBe('2026-10-16T08:00:00-05:00')
  })
})

describe('hostile input', () => {
  const cases: Record<string, string> = {
    'unclosed JSON-LD script tags': '<script type="application/ld+json" '.repeat(4000),
    'unclosed meta tags': '<meta name="a" '.repeat(6000),
    'unclosed headings': '<h1 a'.repeat(20_000),
    'bare angle brackets': '<'.repeat(100_000),
    'unclosed articles': '<article>'.repeat(20_000),
    'unclosed comments': '<!--'.repeat(20_000),
    'quoted attribute runs': '<a title="'.repeat(20_000)
  }
  for (const [name, junk] of Object.entries(cases)) {
    test(`finishes fast on ${name}`, () => {
      const started = performance.now()
      try {
        extractHtml(`<p>${POST}</p>${junk}`)
      } catch {
        // An empty body is a typed error. Only the time matters here.
      }
      expect(performance.now() - started).toBeLessThan(500)
    })
  }

  test('normalizes a long run of spaces and a long markdown heading fast', () => {
    const started = performance.now()
    expect(normalizeBody(`a${' '.repeat(200_000)}b`)).toBe('a b')
    expect(normalizeBody('a \t\nb  \n\n\n\nc  ')).toBe('a\nb\n\nc')
    const page = extractMarkdown(`# a${' '.repeat(200_000)}b\n\n${POST}\n${'|'.repeat(50_000)} x`)
    expect(page.h1?.startsWith('a')).toBe(true)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('FAQ answers from HTML (live run: 12 questions, every answer empty)', () => {
  const details = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/textbolt-faq-details.html'),
    'utf8'
  )

  test('reads <details>/<summary> accordions: question from the summary, answer from the rest', () => {
    const page = extractHtml(details)
    expect(page.faqs.map((faq) => faq.question)).toEqual([
      'What is the difference between text alerts and SMS marketing campaigns?',
      'Can a business set up text alerts without writing any code?',
      'Where do replies to a text alert go once someone responds?'
    ])
    for (const faq of page.faqs) expect(faq.answer.length).toBeGreaterThan(100)
    expect(page.faqs[1]?.answer).toMatch(/^Yes, a business can set up text alerts without any code/)
    expect(page.faqs[1]?.answer).toMatch(/takes about 30 minutes\.$/)
    // A question-shaped heading in the body is not an FAQ.
    expect(page.faqs.some((faq) => faq.question.includes('Whole Team'))).toBe(false)
  })

  test('reads a heading and the content after it inside the FAQ section', () => {
    const html = `<main><h1>Text alerts</h1><p>${POST}</p>
      <h3>Is this a body question?</h3><p>Not an FAQ.</p>
      <h2>FAQ</h2>
      <h3>Do staff need an app?</h3><p>No. Staff get a normal text.</p><ul><li>Any phone works.</li></ul>
      <h3>Can staff reply?</h3><div><p>Yes, replies come back to your email.</p></div>
      <h2>Next steps</h2><p>Start a trial.</p></main>`
    expect(extractHtml(html).faqs).toEqual([
      {
        question: 'Do staff need an app?',
        answer: 'No. Staff get a normal text. Any phone works.',
        typo: null
      },
      { question: 'Can staff reply?', answer: 'Yes, replies come back to your email.', typo: null }
    ])
  })

  test('prefers FAQPage JSON-LD and strips HTML from its answers', () => {
    const html = `<head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Is there a free trial?","acceptedAnswer":{"@type":"Answer","text":"<p>Yes, <strong>14 days</strong> &amp; no card.</p>"}}]}]}</script></head>${details}`
    expect(extractHtml(html).faqs).toEqual([
      { question: 'Is there a free trial?', answer: 'Yes, 14 days & no card.', typo: null }
    ])
  })
})
