// The comparison landing page (site/compare/), built from the README's
// "How CiteFox compares" section so the two never disagree. The full matrix,
// with a source for every cell, stays in Docs/COMPARISON.md on GitHub.
import { REPO_URL } from './config.mjs'
import { DIFFERENT } from './content.mjs'
import { absolute, breadcrumbData, breadcrumbs, faqData, page } from './layout.mjs'
import { escapeHtml as e, inline, renderMarkdown } from './markdown.mjs'

export const COMPARE_HEADING = '## How CiteFox compares'

/** Questions people search for when they compare AI visibility tools. Plain text. */
export const COMPARE_FAQ = [
  {
    q: 'What is the difference between CiteFox and Profound?',
    a: 'Profound is a hosted platform for large brands, with up to 9 engines on its Enterprise plan, prompt volumes, AI crawler analytics, an API and agents. CiteFox is a free desktop app: your data stays on your computer, it checks whether the page you want cited is the one cited, and it gives each logged fix a 14-day verdict.'
  },
  {
    q: 'Is CiteFox a free alternative to Peec AI or Otterly.AI?',
    a: 'CiteFox is free to download and use; checks run on your own API keys or credits, with the cost shown before each check, and your data stays on your computer. Peec AI starts at $95 a month and Otterly.AI at $29 a month (list prices on 2026-11-02), both as hosted dashboards with daily runs, which CiteFox does not have today.'
  },
  {
    q: 'Which AI visibility tool tracks the most engines?',
    a: 'Promptwatch, Scrunch, AthenaHQ and the Enterprise plans of Profound and Peec AI track more engines than CiteFox, which tracks six: Google AI Overviews, Google AI Mode, ChatGPT, Perplexity, Gemini and Copilot.'
  },
  {
    q: 'Where do these facts come from?',
    a: 'Every fact about another tool comes from that vendor’s own website, pricing page or docs, checked on 2026-11-02. The full matrix in Docs/COMPARISON.md on GitHub links a source for every cell; a fact that could not be confirmed is marked with a question mark.'
  }
]

/** The README section's Markdown, without its own heading. */
export function compareSection(readme) {
  const start = readme.indexOf(`${COMPARE_HEADING}\n`)
  if (start < 0) throw new Error(`README.md has no "${COMPARE_HEADING}" section`)
  const rest = readme.slice(start + COMPARE_HEADING.length + 1)
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

/** A Markdown pipe table to HTML; the first column is the row heading. */
function table(lines, link) {
  const [head, , ...rows] = lines.map(cells)
  const th = head.map((c) => `<th scope="col">${inline(c, link) || 'Feature'}</th>`)
  // A row whose other cells are all empty is a group heading ("Pricing & control").
  const body = rows.map(([label, ...rest]) =>
    rest.every((c) => c === '')
      ? `<tr class="group"><th scope="colgroup" colspan="${rest.length + 1}">${inline(label, link)}</th></tr>`
      : `<tr><th scope="row">${inline(label, link)}</th>${rest.map((c) => `<td>${inline(c, link)}</td>`).join('')}</tr>`
  )
  return `<div class="table-wrap"><table class="compare-table"><thead><tr>${th.join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`
}

/** Section Markdown to HTML: the table rendered here, the rest by renderMarkdown (### becomes h2). */
export function renderSection(markdown) {
  const link = (href) =>
    /^(https?:|mailto:)/.test(href) || href.startsWith('#') ? href : `${REPO_URL}/blob/main/${href}`
  const lines = markdown.split(/\r?\n/)
  const first = lines.findIndex((l) => l.trim().startsWith('|'))
  if (first < 0) return renderMarkdown(markdown, { shift: -1, link }).html
  let last = first
  while (last < lines.length && lines[last].trim().startsWith('|')) last += 1
  const before = renderMarkdown(lines.slice(0, first).join('\n'), { shift: -1, link }).html
  const after = renderMarkdown(lines.slice(last).join('\n'), { shift: -1, link }).html
  return [before, table(lines.slice(first, last), link), after].join('\n')
}

export function comparePage({ readme }) {
  const root = '../'
  const path = 'compare/'
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Compare', path }
  ]
  const section = renderSection(compareSection(readme))
  const body = `    <main id="main" class="wrap doc compare">
      ${breadcrumbs(trail, root)}
      <h1>CiteFox vs Profound, Peec AI, Otterly.AI and other AI visibility tools</h1>
      <p class="lead left">Looking for a free, local alternative to Profound, Peec AI, Otterly.AI or Semrush’s AI toolkit? Here is an honest, sourced comparison: what each tool tracks, what it costs to start, and where each one leads. CiteFox is not affiliated with any of these companies.</p>
      <section aria-labelledby="why-title">
        <h2 id="why-title">Why teams pick CiteFox</h2>
        <ul class="cards three">
${DIFFERENT.map((x) => `          <li class="mini"><h3>${e(x.title)}</h3><p>${e(x.text)}</p></li>`).join('\n')}
        </ul>
      </section>
${section
  .split('\n')
  .map((l) => `      ${l}`)
  .join('\n')}
      <section aria-labelledby="compare-faq">
        <h2 id="compare-faq">Common questions</h2>
${COMPARE_FAQ.map((x) => `        <div class="qa"><h3>${e(x.q)}</h3><p>${e(x.a)}</p></div>`).join('\n')}
      </section>
      <p><a class="button" href="../#download">Download CiteFox</a> <a href="${REPO_URL}/blob/main/Docs/COMPARISON.md" target="_blank" rel="noopener">Full matrix with sources</a></p>
    </main>`
  const article = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'CiteFox vs Profound, Peec AI, Otterly.AI and other AI visibility tools',
    url: absolute(path),
    dateModified: '2026-11-02'
  }
  return {
    path,
    file: 'compare/index.html',
    html: page({
      path,
      root,
      title: 'Free Alternative to Profound, Peec AI, Otterly.AI | CiteFox',
      description:
        'A free, local alternative to Profound, Peec AI and Otterly.AI, compared honestly with them, Scrunch, AthenaHQ, Semrush and Ahrefs, from each vendor’s own pages.',
      body,
      data: [
        breadcrumbData(trail),
        article,
        faqData(COMPARE_FAQ.map(({ q, a }) => ({ question: q, answer: a })))
      ],
      current: 'compare'
    })
  }
}
