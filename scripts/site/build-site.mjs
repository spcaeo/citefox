#!/usr/bin/env node
// Builds the public site in site/ (GitHub Pages) from Docs/help/*.md and
// scripts/site/content.mjs. No framework: plain HTML pages with their own title,
// description, canonical, share tags and JSON-LD, plus sitemap.xml and robots.txt.
//
//   node scripts/site/build-site.mjs          write site/
//   node scripts/site/build-site.mjs --check  fail if site/ is out of date
//
// Screenshots: files in media/ (hero.png, summary.png, ...) are copied to
// site/media/ (git-ignored) and shown on the home page; a missing one is left out.
// The deploy workflow runs this script, so the live site always has them.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE_URL } from './config.mjs'
import { comparePage } from './compare.mjs'
import { parseFrontMatter, renderMarkdown } from './markdown.mjs'
import { docOrder, docPage, docsIndex, glossary, home, notFound } from './pages.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '..', '..')

/** The screenshots the home page can show, made under media/. */
export const MEDIA = [
  'hero.png',
  'summary.png',
  'question.png',
  'competitors.png',
  'fixes.png',
  'reports-home.png',
  'report-visibility.png',
  'demo.mp4',
  'demo-silent.mp4',
  'demo-poster.png'
]

/** Width and height of a PNG or GIF, from its header. */
export function imageSize(buffer) {
  if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  return null
}

export function findMedia(root = REPO_ROOT) {
  const media = {}
  for (const name of MEDIA) {
    const file = join(root, 'media', name)
    if (!existsSync(file)) continue
    if (name.endsWith('.mp4')) media[name] = { file }
    else {
      const size = imageSize(readFileSync(file))
      if (size) media[name] = { file, ...size }
    }
  }
  return media
}

export function readDocs(root = REPO_ROOT) {
  const dir = join(root, 'Docs', 'help')
  const docs = {}
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()) {
    const { meta, body } = parseFrontMatter(readFileSync(join(dir, name), 'utf8'))
    const id = meta.id || name.replace(/\.md$/, '')
    docs[id] = { meta: { ...meta, id }, rendered: renderMarkdown(body) }
  }
  const missing = docOrder().filter((id) => !docs[id])
  if (missing.length) throw new Error(`Docs/help is missing: ${missing.join(', ')}`)
  const unlisted = Object.keys(docs).filter((id) => !docOrder().includes(id))
  if (unlisted.length)
    throw new Error(
      `Add these help topics to DOC_GROUPS in scripts/site/content.mjs: ${unlisted.join(', ')}`
    )
  return docs
}

/** Every generated file as `{ file, content }`, paths relative to site/. */
export function buildSite(root = REPO_ROOT) {
  const media = findMedia(root)
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const docs = readDocs(root)
  const pages = [
    home({ media, version }),
    docsIndex({ docs }),
    ...docOrder().map((id) => docPage({ docs, id })),
    glossary(),
    comparePage({ readme: readFileSync(join(root, 'README.md'), 'utf8') }),
    notFound()
  ]
  const indexed = pages.filter((p) => p.file !== '404.html')
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexed.map((p) => `  <url><loc>${SITE_URL}${p.path}</loc></url>`).join('\n')}
</urlset>
`
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}sitemap.xml
`
  return {
    media,
    files: [
      ...pages.map((p) => ({ file: p.file, content: p.html })),
      { file: 'sitemap.xml', content: sitemap },
      { file: 'robots.txt', content: robots }
    ]
  }
}

function main() {
  const check = process.argv.includes('--check')
  const site = join(REPO_ROOT, 'site')
  const { files, media } = buildSite()
  const stale = []
  for (const { file, content } of files) {
    const target = join(site, file)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current === content) continue
    if (check) stale.push(file)
    else {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
  }
  if (check) {
    if (stale.length) {
      console.error(`site/ is out of date (run npm run site:build): ${stale.join(', ')}`)
      process.exit(1)
    }
    console.log(`site/ is up to date (${files.length} files)`)
    return
  }
  for (const [name, info] of Object.entries(media)) {
    mkdirSync(join(site, 'media'), { recursive: true })
    copyFileSync(info.file, join(site, 'media', name))
  }
  const missing = MEDIA.filter((name) => !media[name])
  console.log(`Wrote ${files.length} files to site/ for ${SITE_URL}`)
  if (missing.length) console.log(`Not in media yet (left out): ${missing.join(', ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
