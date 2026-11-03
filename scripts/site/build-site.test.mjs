// Checks the public site (site/) and the README for search basics: every page has
// a unique title and description, one H1, a canonical, share tags, alt texts,
// JSON-LD that parses, headings in order, and internal links that resolve.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { buildSite, MEDIA, REPO_ROOT } from './build-site.mjs'
import { ABOUT_US, AFFILIATE_DISCLOSURE, SITE_URL } from './config.mjs'
import { FAQ } from './content.mjs'

const SITE = join(REPO_ROOT, 'site')
const { files } = buildSite()
const pages = files.filter((f) => f.file.endsWith('.html'))
const window = new Window()
const parse = (html) => new window.DOMParser().parseFromString(html, 'text/html')
const docs = Object.fromEntries(pages.map((p) => [p.file, parse(p.content)]))

/** Names of the services CiteFox uses behind the scenes; never in marketing copy. */
// Claude Code and Codex may be named (owner, 2026-11-02: users run CiteFox's AI on those plans).
const PROVIDERS = /\b(cloro|serp ?api|jina|anthropic|claude(?! code))\b/i
/** "open source" is only allowed as "not open source" and in the FAQ question "Is CiteFox open source?". */
const openSource = (text) =>
  /open[- ]source/i.test(text.replace(/not open source|Is CiteFox open source\?/gi, ''))

describe('site/ is built from its sources', () => {
  it('matches npm run site:build', () => {
    const stale = files.filter(({ file, content }) => {
      const path = join(SITE, file)
      return !existsSync(path) || readFileSync(path, 'utf8') !== content
    })
    expect(stale.map((f) => f.file)).toEqual([])
  })

  it('gives every page its own title and description', () => {
    const all = Object.values(docs)
    const titles = all.map((d) => d.querySelector('title').textContent)
    const descriptions = all.map((d) =>
      d.querySelector('meta[name="description"]').getAttribute('content')
    )
    expect(new Set(titles).size).toBe(all.length)
    expect(new Set(descriptions).size).toBe(all.length)
  })

  it('lists every indexable page in the sitemap, and robots.txt points to it', () => {
    const sitemap = files.find((f) => f.file === 'sitemap.xml').content
    for (const [file, doc] of Object.entries(docs)) {
      if (file === '404.html') continue
      const canonical = doc.querySelector('link[rel="canonical"]').getAttribute('href')
      expect(sitemap).toContain(`<loc>${canonical}</loc>`)
    }
    expect(files.find((f) => f.file === 'robots.txt').content).toContain(
      `Sitemap: ${SITE_URL}sitemap.xml`
    )
  })
})

describe.each(Object.keys(docs))('%s', (file) => {
  const doc = docs[file]
  const html = pages.find((p) => p.file === file).content

  it('has lang, a title, a description and one H1', () => {
    expect(doc.documentElement.getAttribute('lang')).toBe('en')
    const title = doc.querySelector('title').textContent
    expect(title.length).toBeGreaterThan(10)
    expect(title.length).toBeLessThanOrEqual(70)
    const description = doc.querySelector('meta[name="description"]').getAttribute('content')
    expect(description.length).toBeGreaterThanOrEqual(50)
    expect(description.length).toBeLessThanOrEqual(170)
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
  })

  it('has a canonical (or noindex), Open Graph and Twitter tags', () => {
    const canonical = doc.querySelector('link[rel="canonical"]')
    if (file === '404.html')
      expect(doc.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex')
    else expect(canonical.getAttribute('href').startsWith(SITE_URL)).toBe(true)
    for (const name of ['og:title', 'og:description', 'og:image', 'og:url'])
      expect(doc.querySelector(`meta[property="${name}"]`)?.getAttribute('content')).toBeTruthy()
    expect(doc.querySelector('meta[name="twitter:card"]').getAttribute('content')).toBe(
      'summary_large_image'
    )
  })

  it('gives every image an alt text', () => {
    for (const img of doc.querySelectorAll('img')) expect(img.hasAttribute('alt')).toBe(true)
  })

  it('has JSON-LD that parses', () => {
    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) =>
      JSON.parse(s.textContent)
    )
    const types = blocks.map((b) => b['@type'])
    if (file === 'index.html') {
      expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'FAQPage']))
      const app = blocks.find((b) => b['@type'] === 'SoftwareApplication')
      expect(app.offers.price).toBe('0')
      expect(app.publisher.name).toBe('Space-O Technologies')
      expect(app).not.toHaveProperty('aggregateRating')
    }
    if (file.startsWith('docs/') || file.startsWith('glossary/'))
      expect(types).toContain('BreadcrumbList')
    for (const b of blocks) expect(b['@context']).toBe('https://schema.org')
  })

  it('keeps headings in order', () => {
    let last = 0
    for (const h of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const level = Number(h.tagName[1])
      expect(level - last, `${h.tagName} "${h.textContent}" after h${last}`).toBeLessThanOrEqual(1)
      last = level
    }
  })

  it('links only to pages and anchors that exist', () => {
    if (file === '404.html') return
    for (const a of doc.querySelectorAll('a[href], link[href], script[src], img[src]')) {
      const target = a.getAttribute('href') ?? a.getAttribute('src')
      if (/^(https?:|mailto:)/.test(target)) continue
      const [path, hash] = target.split('#')
      let resolved = file
      if (path) {
        // URL paths: always '/', whatever the computer's own separator is.
        resolved = posix.normalize(posix.join(posix.dirname(file), path))
        if (path.endsWith('/') || resolved === '.') resolved = posix.join(resolved, 'index.html')
      }
      if (resolved.startsWith('media/')) continue // screenshots, copied at build time
      // The live demo and the sample reports: made by npm run demo:build / samples:build.
      if (resolved.startsWith('demo/') || /^samples\/[^/]+\/index\.html$/.test(resolved)) continue
      const exists = docs[resolved] || existsSync(join(SITE, resolved))
      expect(exists, `${file}: ${target}`).toBeTruthy()
      if (hash && docs[resolved])
        expect(docs[resolved].getElementById(hash), `${file}: ${target}`).toBeTruthy()
    }
  })

  it('shows the affiliate disclosure in the footer', () => {
    expect(doc.querySelector('footer .disclosure')?.textContent).toBe(AFFILIATE_DISCLOSURE)
  })

  it('names no behind-the-scenes provider and never says open source', () => {
    const text = doc.body.textContent + doc.head.innerHTML
    expect(text).not.toMatch(PROVIDERS)
    expect(openSource(html)).toBe(false)
  })
})

describe('about us', () => {
  it('says the same words on the site and in the app', async () => {
    const app = await import('../../src/shared/project-links.ts')
    expect(app.ABOUT_US).toBe(ABOUT_US)
    expect(docs['index.html'].querySelector('#about')?.textContent).toContain(ABOUT_US)
  })
})

describe('Docs/HELP.md', () => {
  const { help } = buildSite()
  it('is up to date (run npm run site:build)', () => {
    expect(readFileSync(join(REPO_ROOT, help.file), 'utf8')).toBe(help.content)
  })
  it('links every help topic to a file that exists', () => {
    const links = [...help.content.matchAll(/\]\((help\/[^)]+\.md)\)/g)].map((m) => m[1])
    const topics = readdirSync(join(REPO_ROOT, 'Docs', 'help')).filter((n) => n.endsWith('.md'))
    // Every topic once, plus the "Start with Getting started" line.
    expect(links.length).toBe(topics.length + 1)
    for (const link of links) expect(existsSync(join(REPO_ROOT, 'Docs', link)), link).toBe(true)
  })
})

describe('README.md', () => {
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8')
  const top = readme.split(/^## Build from source/m)[0]

  it('ends with the same affiliate disclosure as the site footer', () => {
    expect(readme.slice(readme.lastIndexOf('\n## '))).toContain(
      `<sub>${AFFILIATE_DISCLOSURE}</sub>`
    )
  })

  it('asks the same FAQ questions as the site', () => {
    for (const { q } of FAQ) expect(readme).toContain(`### ${q}`)
  })

  it('keeps provider names out of the top half and never says open source', () => {
    expect(top).not.toMatch(PROVIDERS)
    expect(openSource(readme)).toBe(false)
  })

  it('uses only the screenshots the media builder makes', () => {
    const used = [...readme.matchAll(/(?<![\w/])media\/([\w.-]+)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect([...MEDIA, 'demo.gif']).toContain(name)
  })
})
